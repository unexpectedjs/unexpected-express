/*global setImmediate:true*/

if (typeof setImmediate === 'undefined') {
    setImmediate = process.nextTick;
}

var BufferedStream = require('bufferedstream'),
    URL = require('url'),
    http = require('http'),
    _ = require('underscore'),
    messy = require('messy');

module.exports = function (expect) {
    expect.addType({
        name: 'messy.Headers',
        equal: function (headers1, headers2) {
            return headers1.equal(headers2);
        },
        identify: function (obj) {
            return obj instanceof messy.Headers;
        },
        inspect: function (output, headers, inspect) {
            headers.getNames().forEach(function (headerName) {
                headers.valuesByName[headerName].forEach(function (headerValue) {
                    output
                        .text(messy.formatHeaderName(headerName + ':'), 'gray')
                        .text(' ')
                        .text(headerValue, 'cyan')
                        .nl();
                });
            });
            return output;
        }
    }).addType({
        name: 'messy.HttpRequest',
        identify: function (obj) {
            return obj instanceof messy.HttpRequest;
        },
        equal: function (httpRequest1, httpRequest2) {
            return httpRequest1.equal(httpRequest2);
        },
        inspect: function (output, httpRequest, inspect) {
            output
                .text(httpRequest.method, 'blue')
                .text(' ')
                .text(httpRequest.url, 'gray')
                .text(' ')
                .text(httpRequest.protocolName, 'blue')
                .text('/')
                .text(httpRequest.protocolVersion, 'cyan')
                .nl();

            inspect(output, httpRequest.headers);
            return output;
        }
    }).addType({
        name: 'messy.HttpResponse',
        equal: function (httpResponse1, httpResponse2) {
            return httpResponse1.equal(httpResponse2);
        },
        identify: function (obj) {
            return obj instanceof messy.HttpResponse;
        },
        inspect: function (output, httpResponse, inspect) {
            output
                .text(httpResponse.protocolName, 'blue')
                .text('/')
                .text(httpResponse.protocolVersion, 'cyan')
                .text(' ')
                .text(httpResponse.statusCode, 'cyan')
                .text(' ')
                .text(httpResponse.statusMessage, 'yellow')
                .nl();
            inspect(output, httpResponse.headers);
            return output;
        }
    });

    expect.addAssertion('to be middleware that processes', function (expect, subject, value, _done) {
        this.errorMode = 'nested';
        expect(_done, 'to be a function');

        var doneCalled = false;

        function done() {
            if (!doneCalled) {
                doneCalled = true;
                return _done.apply(this, arguments);
            }
        }

        var requestProperties = typeof value.request === 'string' ? {url: value.request} : _.extend({}, value.request),
            httpRequest = new messy.HttpRequest({
                url: requestProperties.url,
                method: requestProperties.method,
                headers: requestProperties.headers
            });
        delete value.request;
        delete requestProperties.method;
        delete requestProperties.headers;
        delete requestProperties.url;
        if (typeof httpRequest.url === 'string') {
            var matchMethod = httpRequest.url.match(/^([A-Z]+) ([\s\S]*)$/);
            if (matchMethod) {
                httpRequest.method = httpRequest.method || matchMethod[1];
                httpRequest.url = matchMethod[2];
            }
        }
        httpRequest.method = httpRequest.method || 'GET';
        if (/^https?:\/\//.test(httpRequest.url)) {
            var urlObj = URL.parse(httpRequest.url);
            if (!httpRequest.headers.has('Host')) {
                httpRequest.headers.set('Host', urlObj.host);
            }
            if (urlObj.protocol === 'https:' && typeof requestProperties.https === 'undefined') {
                requestProperties.https = true;
            }
            httpRequest.url = urlObj.path;
        }

        var expectedResponseProperties;

        if (typeof value.response === 'number') {
            expectedResponseProperties = {statusCode: value.response};
        } else if (typeof value.response === 'string' || Buffer.isBuffer(value.response)) {
            expectedResponseProperties = {body: value.response};
        } else {
            expectedResponseProperties = _.extend({}, value.response);
        }
        delete value.response;

        var responseProperties = {},
            requestStream,
            body = requestProperties.body,
            req;

        if (typeof body !== 'undefined') {
            delete requestProperties.body;
            if (body.pipe) {
                requestStream = body;
                if (requestStream.constructor && requestStream.constructor.name === 'FormData') {
                    if (!httpRequest.headers.has('Content-Type')) {
                        httpRequest.headers.set('Content-Type', 'multipart/form-data; boundary=' + requestStream.getBoundary());
                        // form-data pauses its streams by default for some reason:
                        setImmediate(function () {
                            requestStream.resume();
                        });
                    }
                }
                if (!httpRequest.headers.has('Transfer-Encoding')) {
                    httpRequest.headers.set('Transfer-Encoding', 'chunked');
                }
                requestStream.on('data', function (chunk) {
                    req.emit('data', new Buffer(chunk, 'utf-8'));
                }).on('end', function () {
                    req.emit('end');
                }).on('error', function (err) {
                    req.emit('error', err);
                });
            } else {
                if (typeof body === 'object' && !Buffer.isBuffer(body)) {
                    if (!httpRequest.headers.has('Content-Type')) {
                        httpRequest.headers.set('Content-Type', 'application/json');
                    }
                    body = JSON.stringify(body);
                }

                if (!Buffer.isBuffer(body)) {
                    body = new Buffer(String(body), 'utf-8');
                }
                if (!httpRequest.headers.has('Content-Length') && !httpRequest.headers.has('Transfer-Encoding')) {
                    httpRequest.headers.set('Content-Length', String(body.length));
                }
                requestStream = new BufferedStream();
                setImmediate(function () {
                    req.emit('data', body);
                    req.emit('end');
                });
            }
        } else {
            requestStream = new BufferedStream();
            requestStream.destroy = function () {
                responseProperties.requestDestroyed = true;
            };
            setImmediate(function () {
                requestStream.emit('end');
                req.emit('end');
            });
        }

        req = new http.IncomingMessage(requestStream);
        req.connection = req.connection || {};
        req.connection.encrypted = !!requestProperties.https;
        delete requestProperties.https;
        req.connection.remoteAddress = requestProperties.remoteAddress || requestProperties.ip || '127.0.0.1';
        delete requestProperties.ip;
        delete requestProperties.remoteAddress;
        req.headers = {};
        httpRequest.headers.getNames().forEach(function (headerName) {
            if (headerName === 'set-cookie') {
                req.headers[headerName] = [].concat(httpRequest.headers.valuesByName[headerName]);
            } else {
                req.headers[headerName] = httpRequest.headers.valuesByName[headerName].join(', ');
            }
        });
        req.method = httpRequest.method;
        req.url = httpRequest.url;
        _.extend(req, requestProperties);

        var res = new http.ServerResponse(req);
        _.extend(res, requestProperties.res); // Allows for specifying eg. res.locals
        res.connection = new BufferedStream();
        res.connection._httpMessage = res;

        var nextCallCount = 0,
            next = function (err, _req, _res, _next) {
                nextCallCount += 1;
                if (typeof err === 'number') {
                    var statusCode = err;
                    err = new Error('' + statusCode);
                    err.statusCode = statusCode;
                }
                res.statusCode = err && (err.statusCode || err.status) || 404;
                doTheAssertions(err);
            };

        var responseBodyChunks = [],
            isDestroyed = false,
            isAsync = false;

        setImmediate(function () {
            isAsync = true;
        });

        function doTheAssertions(errorPassedToNext) {
            var context = {
                req: req,
                res: res,
                next: next,
                httpRequest: httpRequest,
                metadata: {
                    strictAsync: isAsync,
                    errorPassedToNext: false,
                    isDestroyed: isDestroyed,
                    nextCalled: nextCallCount > 0
                }
            };

            // Apparently setImmediate (or throwing an exception) is not an option here. If we don't call done, errors won't make it into mocha.
            var err = null;
            try {
                if (errorPassedToNext) {
                    context.metadata.errorPassedToNext = errorPassedToNext;
                    if (typeof value.errorPassedToNext !== 'undefined') {
                        if (value.errorPassedToNext === true) {
                            context.metadata.errorPassedToNext = true;
                        } else if (typeof value.errorPassedToNext === 'string') {
                            context.metadata.errorPassedToNext = errorPassedToNext.message;
                        } else {
                            context.metadata.errorPassedToNext = errorPassedToNext;
                        }
                    } else {
                        return setImmediate(function () {
                            done(errorPassedToNext);
                        });
                    }
                }
                var httpResponse = context.httpResponse = new messy.HttpResponse(res._header || undefined); // Avoid a parse error if empty string
                httpResponse.statusCode = res.statusCode;
                httpResponse.body = Buffer.concat(responseBodyChunks.map(function (bufferOrString) {
                    if (!Buffer.isBuffer(bufferOrString)) {
                        return new Buffer(String(bufferOrString), 'utf-8');
                    } else {
                        return bufferOrString;
                    }
                }));

                var httpResponseMatches = httpResponse.satisfies(expectedResponseProperties),
                    headersMatch = httpResponseMatches || httpResponse.headers.satisfy(expectedResponseProperties.headers),
                    bodyMatches = httpResponseMatches || !('body' in expectedResponseProperties) || httpResponse.satisfies({body: expectedResponseProperties.body});

                expect(context.metadata, 'to have properties', value);

                //delete expectedResponseProperties.body;
                // expect(responseProperties, 'to have properties', expectedResponseProperties);
                if (!headersMatch || !bodyMatches) {
                    // console.log(expect.inspect(httpResponse, expect.output.clone()).toString('ansi'));
                }
            } catch (assertionError) {
                err = assertionError;
            }
            setImmediate(function () {
                done(err, context);
            });
        }
        ['write', 'end', 'destroy'].forEach(function (methodName) {
            var orig = res[methodName];
            res[methodName] = function (chunk, encoding) {
                var returnValue = orig.apply(this, arguments);
                if (methodName !== 'destroy') {
                    if (encoding && !/^utf-?8$/i.test(encoding)) {
                        throw new Error('encoding parameter not supported except for "utf-8": ' + encoding);
                    }
                    if (chunk) {
                        responseBodyChunks.push(chunk);
                    }
                }
                if (methodName === 'end' || methodName === 'destroy') {
                    isDestroyed = methodName === 'destroy';
                    doTheAssertions();
                }
                return returnValue;
            };
        });
        subject(req, res, next);
    });
};
