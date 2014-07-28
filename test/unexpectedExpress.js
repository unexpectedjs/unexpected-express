var unexpectedExpress = require('../lib/unexpectedExpress'),
    unexpected = require('unexpected'),
    bodyParser = require('body-parser'),
    BufferedStream = require('bufferedstream'),
    FormData = require('form-data'),
    passError = require('passerror'),
    express = require('express');

describe('unexpectedExpress', function () {
    var expect = unexpected.clone().installPlugin(unexpectedExpress)
        .addAssertion('to be a readable stream that outputs', function (expect, subject, value, done) {
            expect(done, 'to be a function');
            var chunks = [];
            subject.on('data', function (chunk) {
                chunks.push(chunk);
            }).on('end', function () {
                var output = Buffer.concat(chunks),
                    valueIsRegExp = Object.prototype.toString.call(value) === '[object RegExp]';
                if (typeof value === 'string' || valueIsRegExp) {
                    output = output.toString('utf-8');
                }
                if (valueIsRegExp) {
                    expect(output, 'to match', value);
                } else {
                    expect(output, 'to equal', value);
                }
                if (typeof done === 'function') {
                    done();
                }
            }).on('error', done);
        });

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

    it('should consider a non-existent response body equal to an empty Buffer', function (done) {
        expect(express().use(function (req, res, next) {
            res.end();
        }), 'to be middleware that processes', {
            response: new Buffer([])
        }, done);
    });

    it('should consider a non-existent response body equal to an empty string', function (done) {
        expect(express().use(function (req, res, next) {
            res.end();
        }), 'to be middleware that processes', {
            response: ''
        }, done);
    });

    it('should make a request body provided as an object appear as application/json parsed in req.body when using the bodyParser middleware', function (done) {
        expect(express().use(bodyParser()).use(function (req, res, next) {
            expect(req.header('Content-Type'), 'to equal', 'application/json');
            expect(req.body, 'to equal', {
                foo: {
                    bar: 'quux'
                }
            });
            res.send(200);
        }), 'to be middleware that processes', {
            request: {
                body: {
                    foo: {
                        bar: 'quux'
                    }
                }
            },
            response: 200
        }, done);
    });

    it('should make a request body provided as a FormData instance appear as multipart/form-data', function (done) {
        var formData = new FormData();
        expect(express().use(bodyParser()).use(function (req, res, next) {
            var contentTypeRegExp = /^multipart\/form-data; boundary=([\-\d]+)$/,
                contentType = req.header('Content-Type');

            expect(contentType, 'to match', contentTypeRegExp);

            var boundary = contentType.match(contentTypeRegExp)[1];

            expect(
                req,
                'to be a readable stream that outputs',
                '--' + boundary + '\r\n' +
                'Content-Disposition: form-data; name="foo"\r\n' +
                '\r\n' +
                'bar\r\n' +
                '--' + boundary + '\r\n' +
                'Content-Disposition: form-data; name="quux"\r\n' +
                '\r\n' +
                'æøå☺\r\n' +
                '--' + boundary + '--',
                passError(next, function () {
                    res.send(200);
                })
            );
        }), 'to be middleware that processes', {
            request: {
                body: formData
            },
            response: 200
        }, done);

        formData.append('foo', 'bar');
        formData.append('quux', 'æøå☺');
        formData.resume();
    });

    it('should mock the ip so that the req.ip getter installed by Express retrieves the correct value', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.ip, 'to equal', '127.0.0.1');
            res.send(200);
        }), 'to be middleware that processes', {
            request: '/foo/',
            response: 200
        }, done);
    });

    it('should allow mocking a specific ip', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.ip, 'to equal', '99.88.77.66');
            res.send(200);
        }), 'to be middleware that processes', {
            request: {remoteAddress: '99.88.77.66'},
            response: 200
        }, done);
    });

    it('should allow mocking a specific ip using the alias ip', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.ip, 'to equal', '99.88.77.66');
            res.send(200);
        }), 'to be middleware that processes', {
            request: {ip: '99.88.77.66'},
            response: 200
        }, done);
    });

    it('should populate the Host header if an absolute url is specified', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.get('Host'), 'to equal', 'www.example.com:5432');
            expect(req.url, 'to equal', '/foo/bar/?hey=there');
            expect(req.originalUrl, 'to equal', '/foo/bar/?hey=there');
            res.send(200);
        }), 'to be middleware that processes', {
            request: 'http://www.example.com:5432/foo/bar/?hey=there',
            response: 200
        }, done);
    });

    it('should not overwrite an explicit Host header when an absolute url is specified', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.get('Host'), 'to equal', 'blabla.com');
            res.send(200);
        }), 'to be middleware that processes', {
            request: {
                headers: {
                    Host: 'blabla.com'
                },
                url: 'http://www.example.com:5432/foo/bar/?hey=there'
            },
            response: 200
        }, done);
    });

    it('should mock an https request if an absolute url with a scheme of https is specified', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.secure, 'to be truthy');
            res.send(200);
        }), 'to be middleware that processes', {
            request: 'https://www.example.com:5432/foo/bar/',
            response: 200
        }, done);
    });
});
