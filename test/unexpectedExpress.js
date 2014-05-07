var unexpectedExpress = require('../lib/unexpectedExpress'),
    unexpected = require('unexpected'),
    bodyParser = require('body-parser'),
    BufferedStream = require('bufferedstream'),
    express = require('express');

describe('unexpectedExpress', function () {
    var expect = unexpected.clone().installPlugin(unexpectedExpress);

    it('should default to GET when no method is provided', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.method, 'to equal', 'GET');
            next();
        }), 'to be middleware that processes', {response: 404}, done);
    });

    it('should interpret request given as a string as the request url', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.method, 'to equal', 'GET');
            expect(req.url, 'to equal', '/foo/bar/');
            next();
        }), 'to be middleware that processes', {request: '/foo/bar/', response: 404}, done);
    });

    it('should interpret response given as a string as the expected response body', function (done) {
        expect(express().use(function (req, res, next) {
            res.send('foobar');
        }), 'to be middleware that processes', {request: '/foo/bar/', response: 'foobar'}, done);
    });

    it('should interpret response given as a Buffer as the expected response body', function (done) {
        expect(express().use(function (req, res, next) {
            res.send('foobar');
        }), 'to be middleware that processes', {request: '/foo/bar/', response: new Buffer('foobar', 'utf-8')}, done);
    });

    it('supports the request body to be specified as a string', function (done) {
        expect(express().use(bodyParser.urlencoded()).use(function (req, res, next) {
            res.send('Hello ' + req.param('foo') + ' and ' + req.param('baz'));
        }), 'to be middleware that processes', {
            request: {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'foo=bar&baz=quux'
            },
            response: {
                statusCode: 200,
                body: 'Hello bar and quux'
            }
        }, done);
    });

    it('supports the request body to be specified as a Buffer', function (done) {
        expect(express().use(bodyParser.urlencoded()).use(function (req, res, next) {
            res.send('Hello ' + req.param('foo') + ' and ' + req.param('baz'));
        }), 'to be middleware that processes', {
            request: {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new Buffer('foo=bar&baz=quux', 'utf-8')
            },
            response: {
                statusCode: 200,
                body: 'Hello bar and quux'
            }
        }, done);
    });

    it('supports the request body to be specified as a stream that emits strings', function (done) {
        var requestBodyStream = new BufferedStream();
        setImmediate(function () {
            requestBodyStream.end('foo=bar&baz=quux');
        });
        expect(express().use(bodyParser.urlencoded()).use(function (req, res, next) {
            res.send('Hello ' + req.param('foo') + ' and ' + req.param('baz'));
        }), 'to be middleware that processes', {
            request: {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: requestBodyStream
            },
            response: {
                statusCode: 200,
                body: 'Hello bar and quux'
            }
        }, done);
    });

    it('supports the request body to be specified as a stream that emits Buffers', function (done) {
        var requestBodyStream = new BufferedStream();
        expect(express().use(bodyParser.urlencoded()).use(function (req, res, next) {
            res.send('Hello ' + req.param('foo') + ' and ' + req.param('baz'));
        }), 'to be middleware that processes', {
            request: {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: requestBodyStream
            },
            response: {
                statusCode: 200,
                body: 'Hello bar and quux'
            }
        }, done);
        setImmediate(function () {
            requestBodyStream.end(new Buffer('foo=bar&baz=quux', 'utf-8'));
        });
    });

    it('supports the request body to be specified as an object (JSON)', function (done) {
        var requestBodyStream = new BufferedStream();
        expect(express().use(bodyParser.json()).use(function (req, res, next) {
            res.send('Hello ' + req.param('foo') + ' and ' + req.param('baz'));
        }), 'to be middleware that processes', {
            request: {
                body: {foo: 'bar', baz: 'quux'}
            },
            response: {
                statusCode: 200,
                body: 'Hello bar and quux'
            }
        }, done);
        setImmediate(function () {
            requestBodyStream.end(new Buffer('foo=bar&baz=quux', 'utf-8'));
        });
    });

    it('should make req.protocol return "https" when request:{https:true} is specified', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.protocol, 'to equal', 'https');
            res.send(200);
        }), 'to be middleware that processes', {
            request: {https: true},
            response: 200
        }, done);
    });

    it('should allow an error to be thrown in the middleware when errorPassedToNext is true', function (done) {
        expect(express().use(function (req, res, next) {
            throw new Error('foobar');
        }), 'to be middleware that processes', {
            response: {
                errorPassedToNext: true
            }
        }, done);
    });

    it('should allow an error to be passed to next when errorPassedToNext is true', function (done) {
        expect(express().use(function (req, res, next) {
            next(new Error('foobar'));
        }), 'to be middleware that processes', {
            response: {
                errorPassedToNext: true
            }
        }, done);
    });

    it('should set errorPassedToNext to false when there is no error', function (done) {
        expect(express().use(function (req, res, next) {
            res.send(200);
        }), 'to be middleware that processes', {
            response: {
                errorPassedToNext: false
            }
        }, done);
    });

    it('should match against the error message when errorPassedToNext is a string', function (done) {
        expect(express().use(function (req, res, next) {
            next(new Error('foo bar quux'));
        }), 'to be middleware that processes', {
            response: {
                errorPassedToNext: 'foo bar quux'
            }
        }, done);
    });

    it('should match against the error message errorPassedToNext is an Error', function (done) {
        expect(express().use(function (req, res, next) {
            next(new Error('foo'));
        }), 'to be middleware that processes', {
            response: {
                errorPassedToNext: new Error('foo')
            }
        }, done);
    });

    it('should fail when matching Error instances with different messages', function (done) {
        expect(express().use(function (req, res, next) {
            next(new Error('foo'));
        }), 'to be middleware that processes', {
            response: {
                errorPassedToNext: new Error('bar')
            }
        }, function (err) {
            expect(err, 'to be an', Error);
            expect(err.message, 'to contain', 'to have properties {errorPassedToNext: [Error: bar]}');
            done();
        });
    });

    it('should match a non-boolean, non-string errorPassedToNext against the actual error', function (done) {
        expect(express().use(function (req, res, next) {
            next(new Error('foo bar quux'));
        }), 'to be middleware that processes', {
            response: {
                errorPassedToNext: 'foo bar quux'
            }
        }, done);
    });

    it('should support a numerical status code passed to next', function (done) {
        expect(express().use(function (req, res, next) {
            next(404);
        }), 'to be middleware that processes', {
            response: {
                statusCode: 404,
                errorPassedToNext: true
            }
        }, done);
    });
});
