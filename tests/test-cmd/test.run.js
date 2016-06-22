/* @flow */
import path from 'path';
import {EventEmitter} from 'events';
import deepcopy from 'deepcopy';
import {describe, it} from 'mocha';
import {assert} from 'chai';
import sinon from 'sinon';

import {onlyInstancesOf, WebExtError, RemoteTempInstallNotSupported}
  from '../../src/errors';
import run, {
  defaultFirefoxClient, defaultWatcherCreator, defaultReloadStrategy,
  ExtensionRunner,
} from '../../src/cmd/run';
import * as firefox from '../../src/firefox';
import {RemoteFirefox} from '../../src/firefox/remote';
import {TCPConnectError, fakeFirefoxClient, makeSureItFails, fake, fixturePath}
  from '../helpers';
import {createLogger} from '../../src/util/logger';
import {basicManifest} from '../test-util/test.manifest';

const log = createLogger(__filename);


describe('run', () => {

  function prepareRun() {
    const sourceDir = fixturePath('minimal-web-ext');
    let argv = {
      artifactsDir: path.join(sourceDir, 'web-ext-artifacts'),
      sourceDir,
      noReload: true,
    };
    let options = {
      firefox: getFakeFirefox(),
      firefoxClient: sinon.spy(() => {
        return Promise.resolve(fake(RemoteFirefox.prototype, {
          installTemporaryAddon: () => Promise.resolve(),
        }));
      }),
      reloadStrategy: sinon.spy(() => {
        log.debug('fake: reloadStrategy()');
      }),
    };

    return {
      argv, options,
      run: (customArgv={}, customOpt={}) => run(
        {...argv, ...customArgv},
        {...options, ...customOpt}
      ),
    };
  }

  function getFakeFirefox(implementations={}) {
    let profile = {}; // empty object just to avoid errors.
    let allImplementations = {
      createProfile: () => Promise.resolve(profile),
      copyProfile: () => Promise.resolve(profile),
      installExtension: () => Promise.resolve(),
      run: () => Promise.resolve(),
      ...implementations,
    };
    return fake(firefox, allImplementations);
  }

  it('installs and runs the extension', () => {

    let profile = {};

    const cmd = prepareRun();
    const {firefox} = cmd.options;
    const firefoxClient = fake(RemoteFirefox.prototype, {
      installTemporaryAddon: () => Promise.resolve(),
    });

    return cmd.run({}, {
      firefoxClient: sinon.spy(() => {
        return Promise.resolve(firefoxClient);
      }),
    }).then(() => {
      const install = firefoxClient.installTemporaryAddon;
      assert.equal(install.called, true);
      assert.equal(install.firstCall.args[0], cmd.argv.sourceDir);

      assert.equal(firefox.run.called, true);
      assert.deepEqual(firefox.run.firstCall.args[0], profile);
    });
  });

  it('suggests --install-to-profile when remote install not supported', () => {
    const cmd = prepareRun();
    const firefoxClient = fake(RemoteFirefox.prototype, {
      // Simulate an older Firefox that will throw this error.
      installTemporaryAddon:
        () => Promise.reject(new RemoteTempInstallNotSupported('')),
    });

    return cmd.run(
      {}, {firefoxClient: () => Promise.resolve(firefoxClient)})
      .then(makeSureItFails())
      .catch(onlyInstancesOf(WebExtError, (error) => {
        assert.equal(firefoxClient.installTemporaryAddon.called, true);
        assert.match(error.message, /use --install-to-profile/);
      }));
  });

  it('passes a custom Firefox binary when specified', () => {
    const firefoxBinary = '/pretend/path/to/Firefox/firefox-bin';
    const cmd = prepareRun();
    const {firefox} = cmd.options;

    return cmd.run({firefoxBinary}).then(() => {
      assert.equal(firefox.run.called, true);
      assert.equal(firefox.run.firstCall.args[1].firefoxBinary,
                   firefoxBinary);
    });
  });

  it('passes a custom Firefox profile when specified', () => {
    const firefoxProfile = '/pretend/path/to/firefox/profile';
    const cmd = prepareRun();
    const {firefox} = cmd.options;

    return cmd.run({firefoxProfile}).then(() => {
      assert.equal(firefox.createProfile.called, false);
      assert.equal(firefox.copyProfile.called, true);
      assert.equal(firefox.copyProfile.firstCall.args[0],
                   firefoxProfile);
    });
  });

  it('can install directly to the profile', () => {
    const cmd = prepareRun();
    const firefoxClient = fake(RemoteFirefox.prototype, {
      installTemporaryAddon: () => Promise.resolve(),
    });
    const fakeProfile = {};
    const firefox = getFakeFirefox({
      copyProfile: () => fakeProfile,
    });

    return cmd.run({installToProfile: true}, {
      firefox,
      firefoxClient: sinon.spy(() => Promise.resolve(firefoxClient)),
    }).then(() => {
      assert.equal(firefox.installExtension.called, true);
      assert.equal(firefoxClient.installTemporaryAddon.called, false);

      const install = firefox.installExtension.firstCall.args[0];
      assert.equal(install.manifestData.applications.gecko.id,
                   'minimal-example@web-ext-test-suite');
      assert.deepEqual(install.profile, fakeProfile);

      assert.equal(install.asShadowInstall, true);
      assert.match(install.sourceDir, /fixtures\/minimal-web-ext$/);
    });
  });

  it('can watch and reload the extension', () => {
    const cmd = prepareRun();
    const {sourceDir, artifactsDir} = cmd.argv;
    const {reloadStrategy} = cmd.options;

    return cmd.run({noReload: false}).then(() => {
      assert.equal(reloadStrategy.called, true);
      const args = reloadStrategy.firstCall.args[0];
      assert.equal(args.sourceDir, sourceDir);
      assert.equal(args.artifactsDir, artifactsDir);
      assert.typeOf(args.createRunner, 'function');
    });
  });

  it('allows you to opt out of extension reloading', () => {
    const cmd = prepareRun();
    const {reloadStrategy} = cmd.options;

    return cmd.run({noReload: true}).then(() => {
      assert.equal(reloadStrategy.called, false);
    });
  });

  describe('defaultWatcherCreator', () => {

    function prepare() {
      const config = {
        profile: {},
        client: fake(RemoteFirefox.prototype, {
          reloadAddon: () => Promise.resolve(),
        }),
        sourceDir: '/path/to/extension/source/',
        artifactsDir: '/path/to/web-ext-artifacts',
        createRunner:
          () => Promise.resolve(fake(ExtensionRunner.prototype)),
        onSourceChange: sinon.spy(() => {}),
      };
      return {
        config,
        createWatcher: (customConfig={}) => {
          return defaultWatcherCreator({...config, ...customConfig});
        },
      };
    }

    it('configures a source watcher', () => {
      const {config, createWatcher} = prepare();
      createWatcher();
      assert.equal(config.onSourceChange.called, true);
      const callArgs = config.onSourceChange.firstCall.args[0];
      assert.equal(callArgs.sourceDir, config.sourceDir);
      assert.equal(callArgs.artifactsDir, config.artifactsDir);
      assert.typeOf(callArgs.onChange, 'function');
    });

    it('returns a watcher', () => {
      const watcher = {};
      const onSourceChange = sinon.spy(() => watcher);
      const createdWatcher = prepare().createWatcher({onSourceChange});
      assert.equal(createdWatcher, watcher);
    });

    it('reloads the extension', () => {
      const {config, createWatcher} = prepare();

      const runner = fake(ExtensionRunner.prototype);
      runner.manifestData = deepcopy(basicManifest);
      createWatcher({createRunner: () => Promise.resolve(runner)});

      const callArgs = config.onSourceChange.firstCall.args[0];
      assert.typeOf(callArgs.onChange, 'function');
      // Simulate executing the handler when a source file changes.
      return callArgs.onChange()
        .then(() => {
          assert.equal(config.client.reloadAddon.called, true);
          const reloadArgs = config.client.reloadAddon.firstCall.args;
          assert.equal(reloadArgs[0], 'basic-manifest@web-ext-test-suite');
        });
    });

    it('throws errors from source change handler', () => {
      const runner = fake(ExtensionRunner.prototype);
      runner.manifestData = deepcopy(basicManifest);

      const {createWatcher, config} = prepare();
      config.client.reloadAddon = () => Promise.reject(new Error('an error'));
      createWatcher({createRunner: () => Promise.resolve(runner)});

      assert.equal(config.onSourceChange.called, true);
      // Simulate executing the handler when a source file changes.
      return config.onSourceChange.firstCall.args[0].onChange()
        .then(makeSureItFails())
        .catch((error) => {
          assert.equal(error.message, 'an error');
        });
    });

  });

  describe('defaultReloadStrategy', () => {

    function prepare() {
      const client = new RemoteFirefox(fakeFirefoxClient());
      const watcher = {
        close: sinon.spy(() => {}),
      };
      const args = {
        client,
        firefox: new EventEmitter(),
        profile: {},
        sourceDir: '/path/to/extension/source',
        artifactsDir: '/path/to/web-ext-artifacts/',
        createRunner: sinon.spy(
          () => Promise.resolve(fake(ExtensionRunner.prototype))),
      };
      const options = {
        createWatcher: sinon.spy(() => watcher),
      };
      return {
        ...args,
        ...options,
        client,
        watcher,
        reloadStrategy: (argOverride={}, optOverride={}) => {
          return defaultReloadStrategy(
            {...args, ...argOverride},
            {...options, ...optOverride});
        },
      };
    }

    it('cleans up connections when firefox closes', () => {
      const {firefox, client, watcher, reloadStrategy} = prepare();
      reloadStrategy();
      firefox.emit('close');
      assert.equal(client.client.disconnect.called, true);
      assert.equal(watcher.close.called, true);
    });

    it('configures a watcher', () => {
      const {createWatcher, reloadStrategy, ...sentArgs} = prepare();
      reloadStrategy();
      assert.equal(createWatcher.called, true);
      const receivedArgs = createWatcher.firstCall.args[0];
      assert.equal(receivedArgs.client, sentArgs.client);
      assert.equal(receivedArgs.sourceDir, sentArgs.sourceDir);
      assert.equal(receivedArgs.artifactsDir, sentArgs.artifactsDir);
      assert.equal(receivedArgs.createRunner, sentArgs.createRunner);
    });

  });

  describe('firefoxClient', () => {

    function firefoxClient(opt = {}) {
      return defaultFirefoxClient({maxRetries: 0, retryInterval: 1, ...opt});
    }

    it('retries after a connection error', () => {
      const client = new RemoteFirefox(fakeFirefoxClient());
      var tryCount = 0;
      const connectToFirefox = sinon.spy(() => new Promise(
        (resolve, reject) => {
          tryCount ++;
          if (tryCount === 1) {
            reject(new TCPConnectError('first connection fails'));
          } else {
            // The second connection succeeds.
            resolve(client);
          }
        }));

      return firefoxClient({connectToFirefox, maxRetries: 3})
        .then(() => {
          assert.equal(connectToFirefox.callCount, 2);
        });
    });

    it('only retries connection errors', () => {
      const connectToFirefox = sinon.spy(
        () => Promise.reject(new Error('not a connection error')));

      return firefoxClient({connectToFirefox, maxRetries: 2})
        .then(makeSureItFails())
        .catch((error) => {
          assert.equal(connectToFirefox.callCount, 1);
          assert.equal(error.message, 'not a connection error');
        });
    });

    it('gives up connecting after too many retries', () => {
      const connectToFirefox = sinon.spy(
        () => Promise.reject(new TCPConnectError('failure')));

      return firefoxClient({connectToFirefox, maxRetries: 2})
        .then(makeSureItFails())
        .catch((error) => {
          assert.equal(connectToFirefox.callCount, 3);
          assert.equal(error.message, 'failure');
        });
    });

  });

});
