/*global describe, it, setImmediate:true, setTimeout*/

if (typeof setImmediate === 'undefined') {
    setImmediate = process.nextTick;
}
var unexpected = require('unexpected'),
    bodyParser = require('body-parser'),
    BufferedStream = require('bufferedstream'),
    FormData = require('form-data'),
    express = require('express'),
    fs = require('fs'),
    mockFs = require('mock-fs');

describe('unexpectedExpress', function () {
    var expect = unexpected.clone()
        .installPlugin(require('unexpected-stream'))
        .installPlugin(require('../lib/unexpectedExpress'))
        .addAssertion('when delayed a little bit', function (expect, subject) {
            var that = this;
            return expect.promise(function (run) {
                setTimeout(run(function () {
                    return that.shift(expect, subject, 0);
                }), 1);
            });
        });

    expect.output.preferredWidth = 80;

    expect.output.installPlugin(require('magicpen-prism'));

    it('should fail if an unsupported top-level option is specified', function () {
        return expect(function () {
            return expect(express().use(function (req, res, next) {
                res.status(200).end();
            }), 'to yield exchange satisfying', {
                fooBar: 123,
                request: {
                    url: '/foo'
                },
                response: 200
            });
        }, 'to throw', /Property "fooBar" does not exist/);
    });

    it('should populate req.headers with repeated headers like node.js', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.headers, 'to have properties', {
                'content-type': 'text/html',
                'set-cookie': ['foo=bar', 'baz=quux'],
                'cache-control': 'public, no-cache'
            });
            next();
        }), 'to yield exchange satisfying', {
            request: {
                headers: {
                    'Content-Type': 'text/html',
                    'Set-Cookie': ['foo=bar', 'baz=quux'],
                    'Cache-Control': ['public', 'no-cache']
                }
            },
            response: 404
        });
    });

    it('should add parameters from the query option to the url', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.url, 'to equal', '/foo?bar=hey%C3%A6%C3%B8%C3%A5&baz=blah');
            res.status(200).end();
        }), 'to yield exchange satisfying', {
            request: {
                url: '/foo',
                query: {
                    bar: 'heyæøå',
                    baz: 'blah'
                }
            },
            response: 200
        });
    });

    it('should support serializing nested objects', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.url, 'to equal', '/foo?bar%5Bquux%5D=123');
            res.status(200).end();
        }), 'to yield exchange satisfying', {
            request: {
                url: '/foo',
                query: {
                    bar: {
                        quux: 123
                    }
                }
            },
            response: 200
        });
    });

    it('should add a leading slash to the request url if not present', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.url, 'to equal', '/foo');
            res.status(200).end();
        }), 'to yield exchange satisfying', {
            request: 'foo',
            response: 200
        });
    });

    it('should preserve an existing query string when adding parameters from the query option to the url', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.url, 'to equal', '/foo?hey=there&bar=hey');
            res.status(200).end();
        }), 'to yield exchange satisfying', {
            request: {
                url: '/foo?hey=there',
                query: {
                    bar: 'hey'
                }
            },
            response: 200
        });
    });

    it('should support a query string given as a string', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.url, 'to equal', '/foo?foo=bar%F8');
            res.status(200).end();
        }), 'to yield exchange satisfying', {
            request: {
                url: '/foo',
                query: 'foo=bar%F8'
            },
            response: 200
        });
    });

    it('should default to GET when no method is provided', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.method, 'to equal', 'GET');
            next();
        }), 'to yield exchange satisfying', {response: 404});
    });

    it('should default to / when no url is provided', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.url, 'to equal', '/');
            next();
        }), 'to yield exchange satisfying', {response: 404});
    });

    it('should set up req.httpVersion etc. correctly', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.httpVersion, 'to equal', '1.1');
            expect(req.httpVersionMajor, 'to equal', 1);
            expect(req.httpVersionMinor, 'to equal', 1);
            next();
        }), 'to yield exchange satisfying', {response: 404});
    });

    it('should not break when req.setTimeout is called', function () {
        return expect(express().use(function (req, res, next) {
            req.setTimeout(10);
            res.status(200).end();
        }), 'to yield exchange satisfying', {
            request: 'GET /',
            response: 200
        });
    });

    it('should allow overriding the HTTP version', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.httpVersion, 'to equal', '2.0');
            expect(req.httpVersionMajor, 'to equal', 2);
            expect(req.httpVersionMinor, 'to equal', 0);
            next();
        }), 'to yield exchange satisfying', {
            request: {
                httpVersion: '2.0'
            },
            response: 404
        });
    });

    it('should interpret request given as a string as the request url', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.method, 'to equal', 'GET');
            expect(req.url, 'to equal', '/foo/bar/');
            next();
        }), 'to yield exchange satisfying', {request: '/foo/bar/', response: 404});
    });

    it('should interpret response given as a string as the expected response body', function () {
        return expect(express().use(function (req, res, next) {
            res.send('foobar');
        }), 'to yield exchange satisfying', {request: '/foo/bar/', response: 'foobar'});
    });

    it('should interpret response given as a Buffer as the expected response body', function () {
        return expect(express().use(function (req, res, next) {
            res.header('Content-Type', 'application/octet-stream');
            res.send(new Buffer([1, 2]));
        }), 'to yield exchange satisfying', {request: '/foo/bar/', response: new Buffer([1, 2])});
    });

    describe('when matching the raw body', function () {
        it('should succeed', function () {
            return expect(express().use(function (req, res, next) {
                res.send('foobar');
            }), 'to yield exchange satisfying', {
                request: '/foo/bar/',
                response: {
                    rawBody: new Buffer('foobar', 'utf-8')
                }
            });
        });

        it('should fail with a diff', function () {
            return expect(
                expect(express().use(function (req, res, next) {
                    setImmediate(function () {
                        res.send('foobar');
                    });
                }), 'to yield exchange satisfying', {
                    request: '/foo/bar/',
                    response: {
                        rawBody: new Buffer('barfoo', 'utf-8')
                    }
                }),
                'when rejected',
                'to have message',
                'expected express app to yield exchange satisfying\n' +
                    '{\n' +
                    "  request: '/foo/bar/',\n" +
                    '  response: { rawBody: Buffer([0x62, 0x61, 0x72, 0x66, 0x6F, 0x6F]) }\n'  +
                    '}\n' +
                    '\n' +
                    'GET /foo/bar/ HTTP/1.1\n' +
                    '\n' +
                    'HTTP/1.1 200 OK\n' +
                    'X-Powered-By: Express\n' +
                    'Content-Type: text/html; charset=utf-8\n' +
                    'Content-Length: 6\n' +
                    'ETag: W/"6-iEPX+SQWIR3p67lj/0zigSWTKHg"\n' +
                    'Date: Sat, 12 Mar 2016 22:56:04 GMT\n' +
                    'Connection: keep-alive\n' +
                    '\n' +
                    'foobar\n' +
                    '// should have raw body satisfying Buffer([0x62, 0x61, 0x72, 0x66, 0x6F, 0x6F])\n' +
                    '// -66 6F 6F 62 61 72                                │foobar│\n' +
                    '// +62 61 72 66 6F 6F                                │barfoo│'
            );
        });
    });

    it('supports the request body to be specified as a string', function () {
        return expect(express().use(bodyParser.urlencoded()).use(function (req, res, next) {
            res.send('Hello ' + req.param('foo') + ' and ' + req.param('baz'));
        }), 'to yield exchange satisfying', {
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
        });
    });

    it('supports the request body to be specified as a Buffer', function () {
        return expect(express().use(bodyParser.urlencoded()).use(function (req, res, next) {
            res.send('Hello ' + req.param('foo') + ' and ' + req.param('baz'));
        }), 'to yield exchange satisfying', {
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
        });
    });

    it('supports the request body to be specified as a stream that emits strings', function () {
        var requestBodyStream = new BufferedStream();
        setImmediate(function () {
            requestBodyStream.end('foo=bar&baz=quux');
        });
        requestBodyStream.resume();
        return expect(express().use(bodyParser.urlencoded()).use(function (req, res, next) {
            res.send('Hello ' + req.param('foo') + ' and ' + req.param('baz'));
        }), 'to yield exchange satisfying', {
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
        });
    });

    it('supports the request body to be specified as a stream that emits Buffers', function () {
        var requestBodyStream = new BufferedStream();
        setImmediate(function () {
            requestBodyStream.end(new Buffer('foo=bar&baz=quux', 'utf-8'));
        });
        requestBodyStream.resume();
        return expect(express().use(bodyParser.urlencoded()).use(function (req, res, next) {
            res.send('Hello ' + req.param('foo') + ' and ' + req.param('baz'));
        }), 'to yield exchange satisfying', {
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
        });
    });

    it('supports the unchunked request body to be specified', function () {
        return expect(express().use(bodyParser.json()).use(function (req, res, next) {
            expect(req.body, 'to equal', {foo: 123});
            res.send(200);
        }), 'to yield exchange satisfying', {
            request: {
                headers: {
                    'Content-Type': 'application/json'
                },
                unchunkedBody: new Buffer(JSON.stringify({foo: 123}), 'utf-8')
            },
            response: 200
        });
    });

    it('supports the raw request body to be specified', function () {
        return expect(express().use(bodyParser.json()).use(function (req, res, next) {
            expect(req.body, 'to equal', {foo: 123});
            res.send(200);
        }), 'to yield exchange satisfying', {
            request: {
                headers: {
                    'Content-Type': 'application/json'
                },
                rawBody: new Buffer(JSON.stringify({foo: 123}), 'utf-8')
            },
            response: 200
        });
    });

    it('supports the request body to be specified as an object (JSON)', function () {
        var requestBodyStream = new BufferedStream();
        setImmediate(function () {
            requestBodyStream.end(new Buffer('foo=bar&baz=quux', 'utf-8'));
        });
        return expect(express().use(bodyParser.json()).use(function (req, res, next) {
            res.send('Hello ' + req.param('foo') + ' and ' + req.param('baz'));
        }), 'to yield exchange satisfying', {
            request: {
                body: {foo: 'bar', baz: 'quux'}
            },
            response: {
                statusCode: 200,
                body: 'Hello bar and quux'
            }
        });
    });

    it('provides a req object that emits end even though a request body is not specified', function () {
        return expect(express().use(function (req, res, next) {
            req.on('end', function () {
                res.status(200).end();
            });
            req.resume();
        }), 'to yield exchange satisfying', {
            request: 'PUT /',
            response: 200
        });
    });

    it('sets requestDestroyed', function () {
        return expect(express().use(function (req, res, next) {
            req.connection.destroy();
            res.end();
        }), 'to yield exchange satisfying', {
            request: 'PUT /',
            response: {
                requestDestroyed: true
            }
        });
    });

    it('should make req.protocol return "https" when request:{https:true} is specified', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.protocol, 'to equal', 'https');
            res.status(200).end();
        }), 'to yield exchange satisfying', {
            request: {https: true},
            response: 200
        });
    });

    it('should make req.path return the path of the requested url', function () {
        return expect(function (req, res, next) {
            expect(req.path, 'to equal', '/foo');
            next();
        }, 'to yield exchange satisfying', {
            request: 'GET /foo?bar=baz'
        });
    });

    it('should allow calls to status from res when testing a middleware directly', function () {
        return expect(function (req, res, next) {
            res.status(200).end();
        }, 'to yield exchange satisfying', {
            request: 'GET /',
            response: 200
        });
    });

    describe('when an error with a statusCode property is passed to next', function () {
        it('should treat it the same way as an HTTP response with that as the status code', function () {
            return expect(express().use(function (req, res, next) {
                var err = new Error('foobar');
                err.statusCode = 412;
                next(err);
            }), 'to yield exchange satisfying', {
                request: 'GET /',
                response: 412
            });
        });

        it('should not mess with headers that were already set', function () {
            return expect(express().use(function (req, res, next) {
                res.setHeader('Foo', 'bar');
                var err = new Error('foobar');
                err.statusCode = 412;
                next(err);
            }), 'to yield exchange satisfying', {
                request: 'GET /',
                response: {
                    statusCode: 412,
                    headers: {
                        Foo: 'bar'
                    }
                }
            });
        });

        it('should not attempt to write headers if they have already been flushed', function () {
            var app = express();
            var err = new Error('foo');
            err.statusCode = 502;
            app.use(function (req, res, next) {
                res.status(200);
                res.write('Data');
                next(err);
            });

            return expect(function () {
                expect(app, 'to yield exchange satisfying', {
                    response: {
                        statusCode: 200,
                        errorPassedToNext: err
                    }
                });
            }, 'not to throw'); // not to throw "Can't render headers after they are sent to the client."
        });
    });

    it('should allow an error to be thrown in the middleware when errorPassedToNext is true', function () {
        return expect(express().use(function (req, res, next) {
            throw new Error('foobar');
        }), 'to yield exchange satisfying', {
            response: {
                errorPassedToNext: true
            }
        });
    });

    it('should allow an error to be passed to next when errorPassedToNext is true', function () {
        return expect(express().use(function (req, res, next) {
            next(new Error('foobar'));
        }), 'to yield exchange satisfying', {
            response: {
                errorPassedToNext: true
            }
        });
    });

    it('should set errorPassedToNext to false when there is no error', function () {
        return expect(express().use(function (req, res, next) {
            res.status(200).end();
        }), 'to yield exchange satisfying', {
            response: {
                errorPassedToNext: false
            }
        });
    });

    it('should match against the error message when errorPassedToNext is a string', function () {
        return expect(express().use(function (req, res, next) {
            next(new Error('foo bar quux'));
        }), 'to yield exchange satisfying', {
            response: {
                errorPassedToNext: 'foo bar quux'
            }
        });
    });

    it('should match against the error message errorPassedToNext is an Error', function () {
        return expect(express().use(function (req, res, next) {
            next(new Error('foo'));
        }), 'to yield exchange satisfying', {
            response: {
                errorPassedToNext: new Error('foo')
            }
        });
    });

    it('should fail when matching Error instances with different messages', function () {
        return expect(
            expect(express().use(function (req, res, next) {
                setImmediate(function () {
                    next(new Error('foo'));
                });
            }), 'to yield exchange satisfying', {
                response: {
                    errorPassedToNext: new Error('bar')
                }
            }),
            'to be rejected'
        );
    });

    it('should match a non-boolean, non-string errorPassedToNext against the actual error', function () {
        return expect(express().use(function (req, res, next) {
            next(new Error('foo bar quux'));
        }), 'to yield exchange satisfying', {
            response: {
                errorPassedToNext: 'foo bar quux'
            }
        });
    });

    it('should support a numerical status code passed to next', function () {
        return expect(express().use(function (req, res, next) {
            next(404);
        }), 'to yield exchange satisfying', {
            response: {
                statusCode: 404,
                errorPassedToNext: true
            }
        });
    });

    it('should consider a non-existent response body equal to an empty Buffer', function () {
        return expect(express().use(function (req, res, next) {
            res.end();
        }), 'to yield exchange satisfying', {
            response: { body: new Buffer([]) }
        });
    });

    it('should consider a non-existent response body equal to an empty string', function () {
        return expect(express().use(function (req, res, next) {
            res.setHeader('Content-Type', 'text/plain; charset=UTF-8');
            res.end();
        }), 'to yield exchange satisfying', {
            response: { body: '' }
        });
    });

    it('should make a request body provided as an object appear as application/json parsed in req.body when using the bodyParser middleware', function () {
        return expect(express().use(bodyParser()).use(function (req, res, next) {
            expect(req.header('Content-Type'), 'to equal', 'application/json');
            expect(req.body, 'to equal', {
                foo: {
                    bar: 'quux'
                }
            });
            res.status(200).end();
        }), 'to yield exchange satisfying', {
            request: {
                body: {
                    foo: {
                        bar: 'quux'
                    }
                }
            },
            response: 200
        });
    });

    it('should support sending a application/x-www-form-urlencoded request via form: {...}', function () {
        return expect(express().use(function (req, res, next) {
            expect(
                req,
                'to yield output satisfying',
                'when decoded as', 'utf-8',
                'to equal',
                'foo=bar&hello=world'
            ).then(function () {
                res.status(200).end();
            }).caught(next);
        }), 'to yield exchange satisfying', {
            request: {
                form: {
                    foo: 'bar',
                    hello: 'world'
                }
            }
        });
    });

    it('should support sending a application/x-www-form-urlencoded request via form: "..."', function () {
        return expect(express().use(function (req, res, next) {
            expect(
                req,
                'to yield output satisfying',
                'when decoded as', 'utf-8',
                'to equal',
                'foo=bar&hello=world'
            ).then(function () {
                res.status(200).end();
            }).caught(next);
        }), 'to yield exchange satisfying', {
            request: {
                form: 'foo=bar&hello=world'
            }
        });
    });

    it('should support sending a multipart/form-data request via formData: {...}', function () {
        return expect(express().use(function (req, res, next) {
            var contentTypeRegExp = /^multipart\/form-data; boundary=([\-\d]+)$/,
                contentType = req.header('Content-Type');

            expect(contentType, 'to match', contentTypeRegExp);

            var boundary = contentType.match(contentTypeRegExp)[1];

            expect(
                req,
                'to yield output satisfying',
                'when decoded as', 'utf-8',
                'to equal',
                '--' + boundary + '\r\n' +
                'Content-Disposition: form-data; name="abc"\r\n' +
                '\r\n' +
                'def\r\n' +
                '--' + boundary + '\r\n' +
                'Content-Disposition: form-data; name="attachment"; filename="blabla"\r\n' +
                'Content-Type: foo/bar\r\n' +
                '\r\n' +
                '\x00\x01\r\n' +
                '--' + boundary + '\r\n' +
                'Content-Disposition: form-data; name="attachment2"; filename="yay"\r\n' +
                'Content-Type: quux/baz\r\n' +
                '\r\n' +
                '\x02\x03\r\n' +
                '--' + boundary + '--\r\n'
            ).then(function () {
                res.status(200).end();
            }).caught(next);
        }), 'to yield exchange satisfying', {
            request: {
                formData: {
                    abc: 'def',
                    attachment: {
                        value: new Buffer([0x00, 0x01]),
                        contentType: 'foo/bar',
                        filename: 'blabla'
                    },
                    attachment2: {
                        value: new Buffer([0x02, 0x03]),
                        contentType: 'quux/baz',
                        fileName: 'yay'
                    }
                }
            }
        });
    });

    it('should support sending a multipart/form-data request via formData readStreams', function () {
        mockFs({
            'attachment.html': '<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <title>Document</title>\n</head>\n<body>\n    \n</body>\n</html>',
            'attachment.png': new Buffer([8, 6, 7, 5, 3, 0, 9])
        });

        return expect(express().use(function (req, res, next) {
            var contentTypeRegExp = /^multipart\/form-data; boundary=([\-\d]+)$/,
                contentType = req.header('Content-Type');

            expect(contentType, 'to match', contentTypeRegExp);

            var boundary = contentType.match(contentTypeRegExp)[1];

            expect(
                req,
                'to yield output satisfying',
                'when decoded as', 'utf-8',
                'to equal',
                '--' + boundary + '\r\n' +
                'Content-Disposition: form-data; name="html"; filename="attachment.html"\r\n' +
                'Content-Type: text/html\r\n' +
                '\r\n' +
                '<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <title>Document</title>\n</head>\n<body>\n    \n</body>\n</html>\r\n' +
                '--' + boundary + '\r\n' +
                'Content-Disposition: form-data; name="png"; filename="attachment.png"\r\n' +
                'Content-Type: image/png\r\n' +
                '\r\n' +
                '\x08\x06\x07\x05\x03\x00\t\r\n' +
                '--' + boundary + '--\r\n'
            ).then(function () {
                res.status(200).end();
            }).caught(next);
        }), 'to yield exchange satisfying', {
            request: {
                formData: {
                    html: fs.createReadStream('attachment.html'),
                    png: fs.createReadStream('attachment.png')
                }
            }
        })
            .finally(mockFs.restore);
    });

    it('should complain if the body and formData request options occur together', function () {
        expect(function () {
            expect(express().use(function () {}), 'to yield exchange satisfying', {
                request: { body: 'abc', formData: {} },
                response: 200
            });
        }, 'to throw', 'unexpected-express: The "body" and "formData" options are not supported together');
    });

    it('should make a request body provided as a FormData instance appear as multipart/form-data', function () {
        var formData = new FormData();
        formData.append('foo', 'bar');
        formData.append('quux', 'æøå☺');

        return expect(express().use(bodyParser()).use(function (req, res, next) {
            var contentTypeRegExp = /^multipart\/form-data; boundary=([\-\d]+)$/,
                contentType = req.header('Content-Type');

            expect(contentType, 'to match', contentTypeRegExp);

            var boundary = contentType.match(contentTypeRegExp)[1];

            expect(
                req,
                'to yield output satisfying',
                'when decoded as', 'utf-8',
                'to equal',
                '--' + boundary + '\r\n' +
                'Content-Disposition: form-data; name="foo"\r\n' +
                '\r\n' +
                'bar\r\n' +
                '--' + boundary + '\r\n' +
                'Content-Disposition: form-data; name="quux"\r\n' +
                '\r\n' +
                'æøå☺\r\n' +
                '--' + boundary + '--\r\n'
            ).then(function () {
                res.status(200).end();
            }).caught(next);
        }), 'to yield exchange satisfying', {
            request: {
                body: formData
            },
            response: 200
        });
    });

    it('should mock the ip so that the req.ip getter installed by Express retrieves the correct value', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.ip, 'to equal', '127.0.0.1');
            res.status(200).end();
        }), 'to yield exchange satisfying', {
            request: '/foo/',
            response: 200
        });
    });

    it('should allow mocking a specific ip', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.ip, 'to equal', '99.88.77.66');
            res.status(200).end();
        }), 'to yield exchange satisfying', {
            request: {remoteAddress: '99.88.77.66'},
            response: 200
        });
    });

    it('should allow mocking a specific ip using the alias ip', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.ip, 'to equal', '99.88.77.66');
            res.status(200).end();
        }), 'to yield exchange satisfying', {
            request: {ip: '99.88.77.66'},
            response: 200
        });
    });

    it('should populate the Host header if an absolute url is specified', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.get('Host'), 'to equal', 'www.example.com:5432');
            expect(req.url, 'to equal', '/foo/bar/?hey=there');
            expect(req.originalUrl, 'to equal', '/foo/bar/?hey=there');
            res.status(200).end();
        }), 'to yield exchange satisfying', {
            request: 'http://www.example.com:5432/foo/bar/?hey=there',
            response: 200
        });
    });

    it('should populate the method if one is defined before the url', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.method, 'to equal', 'DELETE');
            expect(req.url, 'to equal', '/foo/bar/');
            res.status(200).end();
        }), 'to yield exchange satisfying', {
            request: 'DELETE /foo/bar/',
            response: 200
        });
    });

    it('should not overwrite an explicit Host header when an absolute url is specified', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.get('Host'), 'to equal', 'blabla.com');
            res.status(200).end();
        }), 'to yield exchange satisfying', {
            request: {
                headers: {
                    Host: 'blabla.com'
                },
                url: 'http://www.example.com:5432/foo/bar/?hey=there'
            },
            response: 200
        });
    });

    it('should mock an https request if an absolute url with a scheme of https is specified', function () {
        return expect(express().use(function (req, res, next) {
            expect(req.secure, 'to be truthy');
            res.status(200).end();
        }), 'to yield exchange satisfying', {
            request: 'https://www.example.com:5432/foo/bar/',
            response: 200
        });
    });

    describe('with a response.url for matching the (rewritten) request url', function () {
        it('should succeed', function () {
            return expect(express().use(function (req, res, next) {
                req.url = '/bar';
                res.status(200).end();
            }), 'to yield exchange satisfying', {
                request: '/foo',
                response: {
                    url: '/bar',
                    statusCode: 200
                }
            });
        });

        it('should fail when the assertion fails', function () {
            expect(function () {
                expect(express().use(function (req, res, next) {
                    req.url = '/bar';
                    res.status(200).end();
                }), 'to yield exchange satisfying', {
                    request: '/foo',
                    response: {
                        url: '/barbar',
                        statusCode: 200
                    }
                });
            }, 'to throw', expect.it(function (err) {
                expect(err.getErrorMessage('text').toString(), 'to contain',
                    "// url: expected '/bar' to equal '/barbar'\n" +
                    '//\n' +
                    '// -/bar\n' +
                    '// +/barbar'
                );
            }));
        });
    });

    it('should assert the absence of a header by specifying it as undefined', function () {
        return expect(
            expect(express().use(function (req, res, next) {
                setImmediate(function () {
                    res.setHeader('X-Foo', 'bar');
                    res.status(200).end();
                });
            }), 'to yield exchange satisfying', {
                request: '/foo',
                response: {
                    headers: {
                        'X-Foo': undefined
                    }
                }
            }),
            'to be rejected'
        );
    });

    it('should assert the absence of a header by specifying it as undefined, even when using a different casing', function () {
        return expect(
            expect(express().use(function (req, res, next) {
                setImmediate(function () {
                    res.setHeader('X-Foo', 'bar');
                    res.status(200).end();
                });
            }), 'to yield exchange satisfying', {
                request: '/foo',
                response: {
                    headers: {
                        'x-fOO': undefined
                    }
                }
            }),
            'to be rejected'
        );
    });

    it('should throw an error when a response object is an array', function () {
        expect(function () {
            expect(function (req, res, next) { next(); }, 'to yield exchange', {
                request: '/foo',
                response: []
            });
        }, 'to throw', /unexpected-express: Response object must be a number, string, buffer or object/);
    });

    it('should throw an error when a response object is specified but incomplete', function () {
        expect(function () {
            expect(function (req, res, next) { next(); }, 'to yield exchange', {
                request: '/foo',
                response: {
                    foo: 'quux'
                }
            });
        }, 'to throw', /unexpected-express: Response object specification incomplete/);
    });

    it('should throw an error when a nonexistent property is added on the response object', function () {
        expect(function () {
            expect(function (req, res, next) { next(); }, 'to yield exchange satisfying', {
                request: '/foo',
                response: {
                    body: {
                        baz: 'xuuq'
                    },
                    fooBar: 'quux'
                }
            });
        }, 'to throw', /Property "fooBar" does not exist on the response object/);
    });

    it('should extend the req object with any additional properties set on the request object', function () {
        return expect(function (req, res, next) {
            expect(req, 'to have property', 'fooBar', 'quuuux');
            next();
        }, 'to yield exchange satisfying', {
            request: {
                fooBar: 'quuuux'
            }
        });
    });

    it('should assert the presence of any additional properties set on the response object', function () {
        expect(function () {
            expect(function (req, res, next) {
                res.fooBar = 'quux';
                next();
            }, 'to yield exchange satisfying', {
                request: '/foo',
                response: {
                    statusCode: 200,
                    fooBar: 'quux'
                }
            });
        }, 'to throw', /Property "fooBar" does not exist on the response object/);
    });

    it('should allow using locals on the response object', function () {
        return expect(function (req, res, next) {
            res.locals.foo = 'bar';
            setImmediate(next);
        }, 'to yield exchange satisfying', {
            request: 'GET /',
            response: {
                locals: {
                    foo: 'bar'
                }
            }
        });
    });

    it('should allow using locals on the request object', function () {
        return expect(function (req, res, next) {
            expect(res.locals.foo, 'to equal', 'bar');
            next();
        }, 'to yield exchange satisfying', {
            request: {
                res: {
                    locals: {
                        foo: 'bar'
                    }
                }
            }
        });
    });

    it('should show an error if the request does not match any route', function () {
        expect(function () {
            return expect(express().use(function (req, res, next) {
                next();
            }).get('/foo', function (req, res) {
                res.status(200).end();
            }), 'to yield exchange satisfying', {
                request: '/',
                response: 200
            });
        }, 'to throw',
        "expected express app to yield exchange satisfying { request: '/', response: 200 }\n" +
            '\n' +
            'GET / HTTP/1.1\n' +
            '\n' +
            'HTTP/1.1 404 Not Found // should be 200 OK\n' +
            '                       //\n' +
            '                       // -HTTP/1.1 404 Not Found\n' +
            '                       // +HTTP/1.1 200 OK\n' +
            'X-Powered-By: Express\n' +
            'Date: Sat, 12 Mar 2016 22:56:04 GMT\n' +
            'Connection: keep-alive\n' +
            'Transfer-Encoding: chunked'
        );
    });

    it('should produce the correct diff when the expected headers do not match', function () {
        expect(function () {
            return expect(express().use(function (req, res, next) {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('ETag', '"abc123"');
                res.send({foo: 123});
            }), 'to yield exchange satisfying', {
                request: '/',
                response: {
                    headers: {
                        ETag: '"foo456"'
                    }
                }
            });
        }, 'to throw',
        'expected express app\n' +
            "to yield exchange satisfying { request: '/', response: { headers: { ETag: '\"foo456\"' } } }\n" +
            '\n' +
            'GET / HTTP/1.1\n' +
            '\n' +
            'HTTP/1.1 200 OK\n' +
            'X-Powered-By: Express\n' +
            'Content-Type: application/json; charset=utf-8\n' +
            'ETag: "abc123" // should equal "foo456"\n' +
            '               //\n' +
            '               // -"abc123"\n' +
            '               // +"foo456"\n' +
            'Content-Length: 11\n' +
            'Date: Sat, 12 Mar 2016 22:56:04 GMT\n' +
            'Connection: keep-alive\n' +
            '\n' +
            '{ foo: 123 }'
        );
    });

    it('can be used inside a custom assertion', function () {
        var middleware = function (req, res, next) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('ETag', '"abc123"');
            res.send({foo: 123});
        };
        expect.addAssertion('to yield a response of', function (expect, subject, value) {
            return expect(express().use(middleware), 'to yield exchange satisfying', {
                request: subject,
                response: value
            });
        });

        expect(function () {
            expect('/', 'to yield a response of', {
                headers: {
                    ETag: '"foo456"'
                }
            });
        }, 'to throw',
        "expected '/' to yield a response of { headers: { ETag: '\"foo456\"' } }\n" +
            '\n' +
            'GET / HTTP/1.1\n' +
            '\n' +
            'HTTP/1.1 200 OK\n' +
            'X-Powered-By: Express\n' +
            'Content-Type: application/json; charset=utf-8\n' +
            'ETag: "abc123" // should equal "foo456"\n' +
            '               //\n' +
            '               // -"abc123"\n' +
            '               // +"foo456"\n' +
            'Content-Length: 11\n' +
            'Date: Sat, 12 Mar 2016 22:56:04 GMT\n' +
            'Connection: keep-alive\n' +
            '\n' +
            '{ foo: 123 }'
        );
    });

    it('should fail if the middleware calls the next function more than once', function () {
        return expect(function () {
            return expect(function (req, res, next) {
                next();
                next();
            }, 'to yield exchange satisfying', {
                request: {},
                response: {}
            });
        }, 'to error', 'next called more than once');
    });

    it('should not remove the origin of uncaught exceptions from middleware', function () {
        return expect(function () {
            return expect(express().use(function (req, res, next) {
                JSON.parse('INVALIDJSON');
            }), 'to yield exchange satisfying', {
                request: {},
                response: {}
            });
        }, 'to error', expect.it(function (err) {
            expect(err.stack, 'to contain', 'test/unexpectedExpress.js');
        }));
    });

    it('should not remove the origin of an Error passed asynchronously to next', function () {
        var app = express();
        app.use(function (req, res, next) {
            setImmediate(function () {
                next(new Error('MockError'));
            });
        });

        return expect(
            expect(app, 'to yield exchange satisfying', {
                request: {},
                response: {}
            }),
            'to be rejected with',
            expect.it(function (err) {
                expect(err.stack.split('\n'), 'to satisfy', {
                    1: /test\/unexpectedExpress\.js/
                });
            })
        );
    });

    it('should not remove the origin of an Error passed asynchronously to next', function () {
        var app = express();
        app.use(function (req, res, next) {
            setImmediate(function () {
                next(new Error('MockError'));
            });
        });

        return expect(
            expect(app, 'to yield exchange satisfying', {
                request: {},
                response: {}
            }),
            'to be rejected with',
            expect.it(function (err) {
                expect(err.stack.split('\n'), 'to satisfy', {
                    1: /test\/unexpectedExpress\.js/
                });
            })
        );
    });

    describe('with errorPassedToNext set to an object', function () {
        it('should report if the test failed due to no error being passed to next', function () {
            var app = express();
            app.use(function (req, res, next) {
                setImmediate(function () {
                    next(null);
                });
            });

            return expect(
                expect(app, 'to yield exchange satisfying', {
                    request: {},
                    response: {
                        errorPassedToNext: {
                            foo: 'bar'
                        }
                    }
                }),
                'to be rejected with',
                expect.it('to be an object')
            );
        });

        it('should remove errorPassedToNext from expectedResponseProperties in time', function () {
            var app = express();
            app.use(function (req, res, next) {
                return next({foo: 'bar'});
            });

            return expect(app, 'to yield exchange satisfying', {
                request: {},
                response: {
                    errorPassedToNext: {
                        foo: 'bar'
                    }
                }
            });
        });
    });

    it('should not double the chunk passed to res.end', function () {
        var app = express();
        app.use(function (req, res, next) {
            res.header('Content-Type', 'text/plain');
            res.write('<');
            res.end('>');
        });

        return expect(app, 'to yield exchange satisfying', {
            request: {},
            response: {
                body: '<>'
            }
        });
    });

    it('should work when a single response chunk body is passed to end', function () {
        var app = express();
        app.use(function (req, res, next) {
            res.header('Content-Type', 'text/plain');
            res.end('>');
        });

        return expect(app, 'to yield exchange satisfying', {
            request: {},
            response: {
                body: '>'
            }
        });
    });

    it('should not emit the request body until there is a listener', function () {
        var app = express();
        app.use(function (req, res, next) {
            setTimeout(function () {
                var chunks = [];
                req.on('data', function (chunk) {
                    chunks.push(chunk);
                }).on('end', function () {
                    expect(Buffer.concat(chunks), 'to equal', new Buffer([1, 2, 3, 4]));
                    res.send(200);
                });
            }, 10);
        });

        return expect(app, 'to yield exchange satisfying', {
            request: {
                body: new Buffer([1, 2, 3, 4])
            },
            response: 200
        });
    });

    describe('with a promise-returning assertion inside the satisfy spec', function () {
        it('should succeed', function () {
            return expect(express().use(function (req, res, next) {
                res.send({foo: 123});
            }), 'to yield exchange satisfying', {
                response: {
                    body: expect.it('when delayed a little bit', 'to equal', { foo: 123 })
                }
            });
        });

        it('should fail with a diff', function () {
            return expect(
                expect(express().use(function (req, res, next) {
                    res.send({foo: 123});
                }), 'to yield exchange satisfying', {
                    response: {
                        body: expect.it('when delayed a little bit', 'to equal', { foo: 789 })
                    }
                }),
                'when rejected',
                'to have message',
                'expected express app\n' +
                    "to yield exchange satisfying { response: { body: expect.it('when delayed a little bit', 'to equal', ...) } }\n" +
                    '\n' +
                    'GET / HTTP/1.1\n' +
                    '\n' +
                    'HTTP/1.1 200 OK\n' +
                    'X-Powered-By: Express\n' +
                    'Content-Type: application/json; charset=utf-8\n' +
                    'Content-Length: 11\n' +
                    'ETag: W/"b-MqXQsTMhQKye6DxXrQR7aiQcPhE"\n' +
                    'Date: Sat, 12 Mar 2016 22:56:04 GMT\n' +
                    'Connection: keep-alive\n' +
                    '\n' +
                    'expected { foo: 123 } when delayed a little bit to equal { foo: 789 }\n' +
                    '\n' +
                    '{\n' +
                    '  foo: 123 // should equal 789\n' +
                    '}'
            );
        });
    });

    it('should pick up the response headers despite express sending back a 404 due to no matching route', function () {
        return expect(express().use(function (req, res, next) {
            res.setHeader('Foo', 'bar');
            next();
        }), 'to yield exchange satisfying', {
            response: {
                statusCode: 404,
                headers: {
                    Foo: 'bar'
                }
            }
        }).then(function (context) {
            expect(context.res.headersSent, 'to be true');
        });
    });

    it('should display metadata alongside with the exchange diff', function () {
        return expect(
            expect.promise(function () {
                return expect(express().use(function (req, res, next) {
                    res.locals.foo = 'quux';
                    next();
                }), 'to yield exchange satisfying', {
                    response: {
                        statusCode: 200,
                        headers: {
                            Foo: 'bar'
                        },
                        locals: {
                            foo: 'baz'
                        }
                    }
                });
            }),
            'to be rejected with',
            'expected express app\n' +
                "to yield exchange satisfying { response: { statusCode: 200, headers: { Foo: 'bar' }, locals: { foo: 'baz' } } }\n" +
                '\n' +
                'GET / HTTP/1.1\n' +
                '\n' +
                'HTTP/1.1 404 Not Found // should be 200 OK\n' +
                '                       //\n' +
                '                       // -HTTP/1.1 404 Not Found\n' +
                '                       // +HTTP/1.1 200 OK\n' +
                'X-Powered-By: Express\n' +
                'Date: Sat, 12 Mar 2016 22:56:04 GMT\n' +
                'Connection: keep-alive\n' +
                'Transfer-Encoding: chunked\n' +
                '// missing Foo: bar\n' +
                "// locals: expected { foo: 'quux' } to satisfy { foo: 'baz' }\n" +
                '//\n' +
                '// {\n' +
                "//   foo: 'quux' // should equal 'baz'\n" +
                '//               //\n' +
                '//               // -quux\n' +
                '//               // +baz\n' +
                '// }'
        );
    });

    // This is a regression test for not waiting long enough for the complete
    // response to be written to the socket because it's still corked by the time
    // end is called. Seems like this change of behavior got introduced with 0.12.
    it('should get the complete response body when it is written as a buffer right before a separate end call', function () {
        return expect(express().use(function (req, res, next) {
            res.set('Content-Type', 'text/plain; charset=utf-8');
            res.write(new Buffer([0x62, 0x6F, 0x64, 0x79]));
            res.end();
        }), 'to yield exchange satisfying', {
            request: 'GET /',
            response: {
                body: 'body'
            }
        });
    });
});
