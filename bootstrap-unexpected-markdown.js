/*global unexpected:true, express:true*/
unexpected = require('unexpected');
express = require('express');
unexpected.output.preferredWidth = 80;
unexpected.installPlugin(require('./lib/unexpectedExpress'));

require('sinon').useFakeTimers(1457823364125, 'Date');
