/*global describe, it, setImmediate:true*/

if (typeof setImmediate === 'undefined') {
    setImmediate = process.nextTick;
}
var unexpectedExpress = require('../lib/unexpectedExpress'),
    unexpectedMessy = require('unexpected-messy'),
    unexpected = require('unexpected'),
    bodyParser = require('body-parser'),
    BufferedStream = require('bufferedstream'),
    FormData = require('form-data'),
    passError = require('passerror'),
    express = require('express');

describe('unexpectedExpress', function () {
    var expect = unexpected.clone()
        .installPlugin(unexpectedExpress)
        .addAssertion('to be a readable stream that outputs', function (expect, subject, value, done) {
            expect(done, 'to be a function');
            this.errorMode = 'bubble'; // Make sure we get a diff if the emitted output mismatches
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
        })
        .addType({
            name: 'magicpen',
            identify: function (obj) {
                return obj && obj.isMagicPen;
            },
            inspect: function (pen, depth, output) {
                return output.append(pen);
            },
            equal: function (a, b) {
                return a.toString() === b.toString() &&
                    a.toString('ansi') === b.toString('ansi') &&
                    a.toString('html') === b.toString('html');
            }
        })
        .addAssertion('Error', 'to have message', function (expect, subject, value) {
            // Copied from https://github.com/sindresorhus/ansi-regex
            var ansiRegex = /(?:(?:\u001b\[)|\u009b)(?:(?:[0-9]{1,3})?(?:(?:;[0-9]{0,3})*)?[A-M|f-m])|\u001b[A-M]/g;
            expect(subject.output.toString(), 'to equal', value);
            expect(subject.message.replace(ansiRegex, ''), 'to equal', '\n' + value);
        });


    expect.output.installPlugin(require('magicpen-prism'));

    it('should populate req.headers with repeated headers like node.js', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.headers, 'to have properties', {
                'content-type': 'text/html',
                'set-cookie': ['foo=bar', 'baz=quux'],
                'cache-control': 'public, no-cache'
            });
            next();
        }), 'to yield exchange', {
            request: {
                headers: {
                    'Content-Type': 'text/html',
                    'Set-Cookie': ['foo=bar', 'baz=quux'],
                    'Cache-Control': ['public', 'no-cache']
                }
            },
            response: 404
        }, done);
    });

    it('should add parameters from the query option to the url', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.url, 'to equal', '/foo?bar=hey%C3%A6%C3%B8%C3%A5&baz=blah&baz=yeah');
            res.status(200).end();
        }), 'to yield exchange', {
            request: {
                url: '/foo',
                query: {
                    bar: 'heyæøå',
                    baz: ['blah', 'yeah']
                }
            },
            response: 200
        }, done);
    });

    it('should preserve an existing query string when adding parameters from the query option to the url', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.url, 'to equal', '/foo?hey=there&bar=hey');
            res.status(200).end();
        }), 'to yield exchange', {
            request: {
                url: '/foo?hey=there',
                query: {
                    bar: 'hey'
                }
            },
            response: 200
        }, done);
    });

    it('should support a query string given as a string', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.url, 'to equal', '/foo?foo=bar%F8');
            res.status(200).end();
        }), 'to yield exchange', {
            request: {
                url: '/foo',
                query: 'foo=bar%F8'
            },
            response: 200
        }, done);
    });

    it('should default to GET when no method is provided', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.method, 'to equal', 'GET');
            next();
        }), 'to yield exchange', {response: 404}, done);
    });

    it('should default to / when no url is provided', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.url, 'to equal', '/');
            next();
        }), 'to yield exchange', {response: 404}, done);
    });

    it('should set up req.httpVersion etc. correctly', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.httpVersion, 'to equal', '1.1');
            expect(req.httpVersionMajor, 'to equal', 1);
            expect(req.httpVersionMinor, 'to equal', 1);
            next();
        }), 'to yield exchange', {response: 404}, done);
    });

    it('should allow overriding the HTTP version', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.httpVersion, 'to equal', '2.0');
            expect(req.httpVersionMajor, 'to equal', 2);
            expect(req.httpVersionMinor, 'to equal', 0);
            next();
        }), 'to yield exchange', {
            request: {
                httpVersion: '2.0'
            },
            response: 404
        }, done);
    });

    it('should interpret request given as a string as the request url', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.method, 'to equal', 'GET');
            expect(req.url, 'to equal', '/foo/bar/');
            next();
        }), 'to yield exchange', {request: '/foo/bar/', response: 404}, done);
    });

    it('should interpret response given as a string as the expected response body', function (done) {
        expect(express().use(function (req, res, next) {
            res.send('foobar');
        }), 'to yield exchange', {request: '/foo/bar/', response: 'foobar'}, done);
    });

    it('should interpret response given as a Buffer as the expected response body', function (done) {
        expect(express().use(function (req, res, next) {
            res.send('foobar');
        }), 'to yield exchange', {request: '/foo/bar/', response: new Buffer('foobar', 'utf-8')}, done);
    });

    it('supports the request body to be specified as a string', function (done) {
        expect(express().use(bodyParser.urlencoded()).use(function (req, res, next) {
            res.send('Hello ' + req.param('foo') + ' and ' + req.param('baz'));
        }), 'to yield exchange', {
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
        }), 'to yield exchange', {
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
        }), 'to yield exchange', {
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
        }), 'to yield exchange', {
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
        }), 'to yield exchange', {
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

    it('provides a req object that emits end even though a request body is not specified', function (done) {
        expect(express().use(bodyParser.urlencoded()).use(function (req, res, next) {
            req.on('end', function () {
                res.status(200).end();
            });
        }), 'to yield exchange', {
            request: 'PUT /',
            response: 200
        }, done);
    });

    it('should make req.protocol return "https" when request:{https:true} is specified', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.protocol, 'to equal', 'https');
            res.status(200).end();
        }), 'to yield exchange', {
            request: {https: true},
            response: 200
        }, done);
    });

    it('should make req.path return the path of the requested url', function (done) {
        expect(function (req, res, next) {
            expect(req.path, 'to equal', '/foo');
            next();
        }, 'to yield exchange', {
            request: 'GET /foo?bar=baz'
        }, done);
    });

    it('should allow calls to status from res when testing a middleware directly', function (done) {
        expect(function (req, res, next) {
            res.status(200).end();
        }, 'to yield exchange', {
            request: 'GET /',
            response: 200
        }, done);
    });

    describe('when an error with a statusCode property is passed to next', function () {

        it('should treat it the same way as an HTTP response with that as the status code', function (done) {
            expect(express().use(function (req, res, next) {
                var err = new Error('foobar');
                err.statusCode = 412;
                next(err);
            }), 'to yield exchange', {
                request: 'GET /',
                response: 412
            }, done);
        });

        it('should not mess with headers that were already set', function (done) {
            expect(express().use(function (req, res, next) {
                res.setHeader('Foo', 'bar');
                var err = new Error('foobar');
                err.statusCode = 412;
                next(err);
            }), 'to yield exchange', {
                request: 'GET /',
                response: {
                    statusCode: 412,
                    headers: {
                        Foo: 'bar'
                    }
                }
            }, done);
        });
    });

    it('should allow an error to be thrown in the middleware when errorPassedToNext is true', function (done) {
        expect(express().use(function (req, res, next) {
            throw new Error('foobar');
        }), 'to yield exchange', {
            errorPassedToNext: true
        }, done);
    });

    it('should allow an error to be passed to next when errorPassedToNext is true', function (done) {
        expect(express().use(function (req, res, next) {
            next(new Error('foobar'));
        }), 'to yield exchange', {
            errorPassedToNext: true
        }, done);
    });

    it('should set errorPassedToNext to false when there is no error', function (done) {
        expect(express().use(function (req, res, next) {
            res.status(200).end();
        }), 'to yield exchange', {
            errorPassedToNext: false
        }, done);
    });

    it('should match against the error message when errorPassedToNext is a string', function (done) {
        expect(express().use(function (req, res, next) {
            next(new Error('foo bar quux'));
        }), 'to yield exchange', {
            errorPassedToNext: 'foo bar quux'
        }, done);
    });

    it('should match against the error message errorPassedToNext is an Error', function (done) {
        expect(express().use(function (req, res, next) {
            next(new Error('foo'));
        }), 'to yield exchange', {
            errorPassedToNext: new Error('foo')
        }, done);
    });

    it('should fail when matching Error instances with different messages', function (done) {
        expect(express().use(function (req, res, next) {
            next(new Error('foo'));
        }), 'to yield exchange', {
            errorPassedToNext: new Error('bar')
        }, function (err) {
            expect(err, 'to be an', Error);
            done();
        });
    });

    it('should match a non-boolean, non-string errorPassedToNext against the actual error', function (done) {
        expect(express().use(function (req, res, next) {
            next(new Error('foo bar quux'));
        }), 'to yield exchange', {
            errorPassedToNext: 'foo bar quux'
        }, done);
    });

    it('should support a numerical status code passed to next', function (done) {
        expect(express().use(function (req, res, next) {
            next(404);
        }), 'to yield exchange', {
            errorPassedToNext: true,
            response: {
                statusCode: 404
            }
        }, done);
    });

    it('should consider a non-existent response body equal to an empty Buffer', function (done) {
        expect(express().use(function (req, res, next) {
            res.end();
        }), 'to yield exchange', {
            response: new Buffer([])
        }, done);
    });

    it('should consider a non-existent response body equal to an empty string', function (done) {
        expect(express().use(function (req, res, next) {
            res.end();
        }), 'to yield exchange', {
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
            res.status(200).end();
        }), 'to yield exchange', {
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
                    res.status(200).end();
                })
            );
        }), 'to yield exchange', {
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
            res.status(200).end();
        }), 'to yield exchange', {
            request: '/foo/',
            response: 200
        }, done);
    });

    it('should allow mocking a specific ip', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.ip, 'to equal', '99.88.77.66');
            res.status(200).end();
        }), 'to yield exchange', {
            request: {remoteAddress: '99.88.77.66'},
            response: 200
        }, done);
    });

    it('should allow mocking a specific ip using the alias ip', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.ip, 'to equal', '99.88.77.66');
            res.status(200).end();
        }), 'to yield exchange', {
            request: {ip: '99.88.77.66'},
            response: 200
        }, done);
    });

    it('should populate the Host header if an absolute url is specified', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.get('Host'), 'to equal', 'www.example.com:5432');
            expect(req.url, 'to equal', '/foo/bar/?hey=there');
            expect(req.originalUrl, 'to equal', '/foo/bar/?hey=there');
            res.status(200).end();
        }), 'to yield exchange', {
            request: 'http://www.example.com:5432/foo/bar/?hey=there',
            response: 200
        }, done);
    });

    it('should populate the method if one is defined before the url', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.method, 'to equal', 'DELETE');
            expect(req.url, 'to equal', '/foo/bar/');
            res.status(200).end();
        }), 'to yield exchange', {
            request: 'DELETE /foo/bar/',
            response: 200
        }, done);
    });

    it('should not overwrite an explicit Host header when an absolute url is specified', function (done) {
        expect(express().use(function (req, res, next) {
            expect(req.get('Host'), 'to equal', 'blabla.com');
            res.status(200).end();
        }), 'to yield exchange', {
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
            res.status(200).end();
        }), 'to yield exchange', {
            request: 'https://www.example.com:5432/foo/bar/',
            response: 200
        }, done);
    });

    it('should allow matching on the (rewritten) url in the response object', function (done) {
        expect(express().use(function (req, res, next) {
            req.url = '/bar';
            res.status(200).end();
        }), 'to yield exchange', {
            request: '/foo',
            response: {
                url: '/bar',
                statusCode: 200
            }
        }, done);
    });

    it('should assert the absence of a header by specifying it as undefined', function (done) {
        expect(express().use(function (req, res, next) {
            res.setHeader('X-Foo', 'bar');
            res.status(200).end();
        }), 'to yield exchange', {
            request: '/foo',
            response: {
                headers: {
                    'X-Foo': undefined
                }
            }
        }, function (err) {
            expect(err, 'to be an', Error);
            done();
        });
    });

    it('should assert the absence of a header by specifying it as undefined, even when using a different casing', function (done) {
        expect(express().use(function (req, res, next) {
            res.setHeader('X-Foo', 'bar');
            res.status(200).end();
        }), 'to yield exchange', {
            request: '/foo',
            response: {
                headers: {
                    'x-fOO': undefined
                }
            }
        }, function (err) {
            expect(err, 'to be an', Error);
            done();
        });
    });

    it('should throw an error when a nonexistent property is added on the response object', function (done) {
        expect(function (req, res, next) { next(); }, 'to yield exchange', {
            request: '/foo',
            response: {
                fooBar: 'quux'
            }
        }, function (err) {
            expect(err, 'to be an', Error);
            expect(err, 'to satisfy', {
                message: /Property "fooBar" does not exist on the response object/
            });
            done();
        });
    });

    it('should extend the req object with any additional properties set on the request object', function (done) {
        expect(function (req, res, next) {
            expect(req, 'to have property', 'fooBar', 'quuuux');
            next();
        }, 'to yield exchange', {
            request: {
                fooBar: 'quuuux'
            }
        }, done);
    });

    it('should allow using locals on the response object', function (done) {
        expect(function (req, res, next) {
            res.locals.foo = 'bar';
            next();
        }, 'to yield exchange', {
            request: 'GET /',
            response: {
                locals: {
                    foo: 'bar'
                }
            }
        }, done);
    });

    it('should allow using locals on the response object', function (done) {
        expect(function (req, res, next) {
            res.locals.foo = 'baz';
            next();
        }, 'to yield exchange', {
            request: 'GET /',
            response: {
                locals: {
                    foo: 'bar'
                }
            }
        }, function (err) {
            expect(err, 'to be an', Error);
            done();
        });
    });

    it('should allow using locals on the request object', function (done) {
        expect(function (req, res, next) {
            expect(res.locals.foo, 'to equal', 'bar');
            next();
        }, 'to yield exchange', {
            request: {
                res: {
                    locals: {
                        foo: 'bar'
                    }
                }
            }
        }, done);
    });

    describe('with the response provided as a Buffer', function () {
        it('should upgrade it to a string when matched against a string', function (done) {
            expect(express().use(function (req, res, next) {
                res.setHeader('Content-Type', 'text/plain');
                res.send(new Buffer('blah', 'utf-8'));
            }), 'to yield exchange', {
                request: '/foo',
                response: {
                    body: 'blah',
                    statusCode: 200
                }
            }, passError(done, function (context) {
                expect(context.httpResponse.body, 'to be a string');
                done();
            }));
        });

        it('should upgrade it to a string when matched against a string, even when served as a non-textual Content-Type', function (done) {
            expect(express().use(function (req, res, next) {
                res.setHeader('Content-Type', 'image/png');
                res.send(new Buffer('PNG...', 'utf-8'));
            }), 'to yield exchange', {
                request: '/foo',
                response: {
                    body: 'PNG...',
                    statusCode: 200
                }
            }, passError(done, function (context) {
                expect(context.httpResponse.body, 'to be a string');
                done();
            }));
        });

        it('should upgrade it to a string when not matched against and served with a textual Content-Type', function (done) {
            expect(express().use(function (req, res, next) {
                res.setHeader('Content-Type', 'text/plain');
                res.send(new Buffer('blah', 'utf-8'));
            }), 'to yield exchange', {
                request: '/foo',
                response: 200
            }, passError(done, function (context) {
                expect(context.httpResponse.body, 'to be a string');
                done();
            }));
        });

        it('should not upgrade it to a string when not matched against and served with a non-textual Content-Type', function (done) {
            expect(express().use(function (req, res, next) {
                res.setHeader('Content-Type', 'image/png');
                res.send(new Buffer('PNG....', 'utf-8'));
            }), 'to yield exchange', {
                request: '/foo',
                response: 200
            }, passError(done, function (context) {
                expect(context.httpResponse.body, 'to be a', Buffer);
                done();
            }));
        });

        describe('and a Content-Type of application/json', function () {
            it('should keep it as a Buffer when matched against a Buffer', function (done) {
                expect(express().use(function (req, res, next) {
                    res.setHeader('Content-Type', 'application/json');
                    res.send(new Buffer(JSON.stringify({foo: '123'}), 'utf-8'));
                }), 'to yield exchange', {
                    request: '/foo',
                    response: {
                        body: new Buffer(JSON.stringify({foo: '123'})),
                        statusCode: 200
                    }
                }, passError(done, function (context) {
                    expect(context.httpResponse.body, 'to be a', Buffer);
                    done();
                }));
            });

            it('should upgrade it to an object when matched against an object', function (done) {
                expect(express().use(function (req, res, next) {
                    res.setHeader('Content-Type', 'application/json');
                    res.send(new Buffer('{"foo": 123}', 'utf-8'));
                }), 'to yield exchange', {
                    request: '/foo',
                    response: {
                        body: {
                            foo: 123
                        }
                    }
                }, passError(done, function (context) {
                    expect(context.httpResponse.body, 'to equal', {foo: 123});
                    done();
                }));
            });

            it('should upgrade it to an object when not matched against', function (done) {
                expect(express().use(function (req, res, next) {
                    res.setHeader('Content-Type', 'application/json');
                    res.send(new Buffer('{"foo": 123}', 'utf-8'));
                }), 'to yield exchange', {
                    request: '/foo',
                    response: 200
                }, passError(done, function (context) {
                    expect(context.httpResponse.body, 'to equal', {foo: 123});
                    done();
                }));
            });

            it('should keep it as a Buffer if it cannot be interpreted as utf-8', function (done) {
                expect(express().use(function (req, res, next) {
                    res.setHeader('Content-Type', 'text/plain');
                    res.send(new Buffer([0xf8]));
                }), 'to yield exchange', {
                    request: '/foo',
                    response: 200
                }, passError(done, function (context) {
                    expect(context.httpResponse.body, 'to be a', Buffer);
                    done();
                }));
            });
        });
    });

    describe('with the response provided as a string', function () {
        it('should downgrade it to a Buffer when matched against a Buffer', function (done) {
            expect(express().use(function (req, res, next) {
                res.setHeader('Content-Type', 'text/plain');
                res.send('blah');
            }), 'to yield exchange', {
                request: '/foo',
                response: {
                    body: new Buffer('blah', 'utf-8'),
                    statusCode: 200
                }
            }, passError(done, function (context) {
                expect(context.httpResponse.body, 'to be a', Buffer);
                done();
            }));
        });

        it('should keep it as a string when not matched against', function (done) {
            expect(express().use(function (req, res, next) {
                res.setHeader('Content-Type', 'text/plain');
                res.send('blah');
            }), 'to yield exchange', {
                request: '/foo',
                response: 200
            }, passError(done, function (context) {
                expect(context.httpResponse.body, 'to be a string');
                done();
            }));
        });

        describe('and a Content-Type of application/json', function () {
            it('should keep it as a string when matched against a string', function (done) {
                expect(express().use(function (req, res, next) {
                    res.setHeader('Content-Type', 'application/json');
                    res.send('{"foo": 123}');
                }), 'to yield exchange', {
                    request: '/foo',
                    response: {
                        body: '{"foo": 123}',
                        statusCode: 200
                    }
                }, passError(done, function (context) {
                    expect(context.httpResponse.body, 'to equal', '{"foo": 123}');
                    done();
                }));
            });

            it('should upgrade it to an object when matched against an object', function (done) {
                expect(express().use(function (req, res, next) {
                    res.setHeader('Content-Type', 'application/json');
                    res.send('{"foo": 123}');
                }), 'to yield exchange', {
                    request: '/foo',
                    response: {
                        body: {
                            foo: 123
                        }
                    }
                }, passError(done, function (context) {
                    expect(context.httpResponse.body, 'to equal', {foo: 123});
                    done();
                }));
            });

            it('should upgrade it to an object when not matched against', function (done) {
                expect(express().use(function (req, res, next) {
                    res.setHeader('Content-Type', 'application/json');
                    res.send('{"foo": 123}');
                }), 'to yield exchange', {
                    request: '/foo',
                    response: 200
                }, passError(done, function (context) {
                    expect(context.httpResponse.body, 'to equal', {foo: 123});
                    done();
                }));
            });
        });
    });

    it('should show an error if the request does not match any route', function (done) {
        expect(express().get('/foo', function (req, res) {
            res.status(200).end();
        }), 'to yield exchange', {
            request: '/',
            response: 200
        }, function (err, response) {
            expect(err, 'to have message',
                'GET / HTTP/1.1\n' +
                '\n' +
                '404 // should be 200'
            );
            done();
        });
    });

    it('should produce the correct diff when the expected headers do not match', function (done) {
        expect(express().use(function (req, res, next) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('ETag', '"abc123"');
            res.setHeader('Date', 'Sat, 30 Aug 2014 23:41:13 GMT');
            res.send({foo: 123});
        }), 'to yield exchange', {
            request: '/',
            response: {
                headers: {
                    ETag: '"foo456"'
                }
            }
        }, function (err) {
            expect(err, 'to have message',
                'GET / HTTP/1.1\n' +
                '\n' +
                'HTTP/1.1 200 OK\n' +
                'X-Powered-By: Express\n' +
                'Content-Type: application/json\n' +
                'ETag: "abc123" // should equal "foo456"\n' +
                'Date: Sat, 30 Aug 2014 23:41:13 GMT\n' +
                'Content-Length: 11\n' +
                'Connection: keep-alive\n' +
                '\n' +
                '{ foo: 123 }'
            );
            done();
        });
    });

    it('can be used inside a custom assertion', function (done) {
        var middleware = function (req, res, next) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('ETag', '"abc123"');
            res.setHeader('Date', 'Sat, 30 Aug 2014 23:41:13 GMT');
            res.send({foo: 123});
        };
        expect = expect.clone()
            .addAssertion('to yield a response of', function (expect, subject, value, next) {
                expect(express().use(middleware), 'to yield exchange', {
                    request: subject,
                    response: value
                }, next);
            });

        expect('/', 'to yield a response of', {
            headers: {
                ETag: '"foo456"'
            }
        }, function (err) {
            expect(err, 'to have message',
                'GET / HTTP/1.1\n' +
                '\n' +
                'HTTP/1.1 200 OK\n' +
                'X-Powered-By: Express\n' +
                'Content-Type: application/json\n' +
                'ETag: "abc123" // should equal "foo456"\n' +
                'Date: Sat, 30 Aug 2014 23:41:13 GMT\n' +
                'Content-Length: 11\n' +
                'Connection: keep-alive\n' +
                '\n' +
                '{ foo: 123 }'
            );
            done();
        });
    });

    it('should fail if the middleware calls the next method more than once', function (done) {
        expect(function (req, res, next) {
            next();
            next();
        }, 'to yield exchange', {
            request: {},
            response: {}
        }, function (err) {
            expect(err, 'to equal', new Error('done/next called more than once'));
            done();
        });
    });

    it('should fail if the middleware calls the next method, continues with the next middleware and calls next again', function (done) {
        var app = express();
        app.use(function (req, res, next) {
            next();
            next(new Error('wat'));
        });
        app.get(/.*/, function (req, res) {
            res.send('Send some data');
        });

        expect(app, 'to yield exchange', {
            request: {},
            response: {}
        }, function (err) {
            expect(err, 'to equal', new Error('done/next called more than once'));
            done();
        });
    });
});
