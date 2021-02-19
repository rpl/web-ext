/* @flow */
import {spawn} from 'child_process';
import path from 'path';

import {assert} from 'chai';
import {describe, it, beforeEach, afterEach} from 'mocha';
import {fs} from 'mz';

import {
  minimalAddonPath, fakeServerPath,
  withTempAddonDir, execWebExt, reportCommandErrors,
} from './common';

// Put this as "web-ext-config.js" in the current directory, and replace
// "FAKEAPIKEY" and "FAKEAPISECRET" with the actual values to enable
// "web-ext sign" without passing those values via the CLI parameters.
const GOOD_EXAMPLE_OF_WEB_EXT_CONFIG_JS = `
module.exports = {
  sign: {
    apiKey: "FAKEAPIKEY",
    apiSecret: "FAKEAPISECRET",
  },
};
`;

// Do NOT use this to specify the API key and secret. It won't work.
const BAD_EXAMPLE_OF_WEB_EXT_CONFIG_JS = `
module.exports = {
  // Bad config: those should be under the "sign" key.
  apiKey: "FAKEAPIKEY",
  apiSecret: "FAKEAPISECRET",
};
`;

describe('web-ext sign', () => {
  let fakeServerProcess;

  beforeEach(() => {
    return new Promise((resolve, reject) => {
      fakeServerProcess = spawn(process.execPath, [fakeServerPath]);
      fakeServerProcess.stdout.on('data', resolve);
      fakeServerProcess.stderr.on('data', reject);
    });
  });

  afterEach(() => {
    if (fakeServerProcess) {
      fakeServerProcess.kill();
      fakeServerProcess = null;
    }
  });

  it('should accept: --source-dir SRCDIR --api-url-prefix URL',
     () => withTempAddonDir({addonPath: minimalAddonPath}, (srcDir, tmpDir) => {
       const argv = [
         'sign', '--verbose',
         '--api-url-prefix', 'http://localhost:8989/fake/api/v4',
         '--api-key', 'FAKEAPIKEY', '--api-secret', 'FAKEAPISECRET',
         '--source-dir', srcDir,
       ];
       const cmd = execWebExt(argv, {cwd: tmpDir});

       return cmd.waitForExit.then(({exitCode, stdout, stderr}) => {
         if (exitCode !== 0) {
           reportCommandErrors({
             argv,
             exitCode,
             stdout,
             stderr,
           });
         }
       });
     })
  );

  it('should use config file if required parameters are not in the arguments',
     () => withTempAddonDir({addonPath: minimalAddonPath}, (srcDir, tmpDir) => {
       fs.writeFileSync(
         path.join(tmpDir, 'web-ext-config.js'),
         GOOD_EXAMPLE_OF_WEB_EXT_CONFIG_JS,
       );

       fs.writeFileSync(
         path.join(tmpDir, 'package.json'),
         JSON.stringify({
           webExt: {
             sign: {
               apiUrlPrefix: 'http://localhost:8989/fake/api/v4',
             },
             sourceDir: srcDir,
           },
         })
       );

       const argv = [
         'sign', '--verbose',
       ];
       const cmd = execWebExt(argv, {cwd: tmpDir});

       return cmd.waitForExit.then(({exitCode, stdout, stderr}) => {
         if (exitCode !== 0) {
           reportCommandErrors({
             argv,
             exitCode,
             stdout,
             stderr,
           });
         }
       });
     })
  );

  it('should show an error message if the api-key is not set in the config',
     () => withTempAddonDir({addonPath: minimalAddonPath}, (srcDir, tmpDir) => {
       const configFilePath = path.join(tmpDir, 'web-ext-config.js');
       fs.writeFileSync(configFilePath, BAD_EXAMPLE_OF_WEB_EXT_CONFIG_JS);
       const argv = [
         'sign', '--verbose', '--no-config-discovery', '-c', configFilePath,
       ];
       const cmd = execWebExt(argv, {cwd: tmpDir});

       return cmd.waitForExit.then(({exitCode, stdout}) => {
         assert.notEqual(exitCode, 0);
         assert.match(
           stdout,
           /web-ext-config.js specified an unknown option: "apiKey"/
         );
       });
     })
  );

  it('should show an error message if the api-key cannot be found',
     () => withTempAddonDir({addonPath: minimalAddonPath}, (srcDir, tmpDir) => {
       const argv = [
         'sign', '--verbose', '--no-config-discovery',
       ];
       const cmd = execWebExt(argv, {cwd: tmpDir});

       return cmd.waitForExit.then(({exitCode, stderr}) => {
         assert.notEqual(exitCode, 0);
         assert.match(
           stderr,
           /Missing required arguments: api-key, api-secret/
         );
       });
     })
  );
});
