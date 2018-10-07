/* eslint no-unused-vars: "off" */
/*global unexpected:true, express:true*/
unexpected = require('unexpected').clone();
express = require('express');
unexpected.output.preferredWidth = 80;
unexpected.installPlugin(require('./lib/unexpectedExpress'));

require('sinon').useFakeTimers({
    now: 1457823364125,
    toFake: ['Date']
});
