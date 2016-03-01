// Webpack tests entry point. Bundles all the test files
// into a single file.

import 'babel-polyfill';

if (process.env.COVERAGE === 'y') {
  // generate the coverage reports
  after((done) => {
    let istanbul = require('babel-istanbul');
    let collector = new istanbul.Collector();
    let reporter = new istanbul.Reporter();
    let sync = false;

    collector.add(global.__coverage__);

    reporter.addAll([ 'text', 'text-summary', 'lcov' ]);
    reporter.write(collector, sync, function() {
      console.log('All reports generated');
      done();
    });
  });
}

var context = require.context('.', true, /.*?test\..*?.js$/);
context.keys().forEach(context);
