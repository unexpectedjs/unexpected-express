/*global setImmediate:true*/

if (typeof setImmediate === 'undefined') {
    setImmediate = process.nextTick;
}

var BufferedStream = require('bufferedstream'),
    URL = require('url'),
    http = require('http'),
    _ = require('underscore'),
    messy = require('messy');

function lowerCaseHeaderNames(obj) {
    var resultObj = {};
    Object.keys(obj || {}).forEach(function (headerName) {
        resultObj[headerName.toLowerCase()] = obj[headerName];
    });
    return resultObj;
}

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
                .text(httpRequest.protocolName, 'blue')
                .text('/')
                .text(httpRequest.protocolVersion, 'cyan')
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
                        requestProperties.headers.set('Content-Type', 'multipart/form-data; boundary=' + requestStream.getBoundary());
                        // form-data pauses its streams by default for some reason:
                        setImmediate(function () {
                            requestStream.resume();
                        });
                    }
                }
                if (!httpRequest.headers.has('Transfer-Encoding') && !httpRequest.headers.has('TE')) {
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
                    requestProperties.headers['content-type'] = requestProperties.headers['content-type'] || 'application/json';
                    body = JSON.stringify(body);
                }

                if (!Buffer.isBuffer(body)) {
                    body = new Buffer(String(body), 'utf-8');
                }
                if (!('content-length' in requestProperties.headers) && !('transfer-encoding' in requestProperties.headers)) {
                    requestProperties.headers['content-length'] = String(body.length);
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
            // FIXME: Multiple?
            req.headers[headerName] = httpRequest.headers.get(headerName);
        });
        req.method = httpRequest.method;
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

        var context = {req: req, res: res, next: next};

        function doTheAssertions(errorPassedToNext) {
            // Apparently setImmediate (or throwing an exception) is not an option here. If we don't call done, errors won't make it into mocha.
            var err = null;
            try {
                var responseProperties = context.responseProperties = {
                    strictAsync: isAsync,
                    errorPassedToNext: false,
                    statusCode: res.statusCode,
                    isDestroyed: isDestroyed,
                    nextCalled: nextCallCount > 0
                };

                if (errorPassedToNext) {
                    responseProperties.errorPassedToNext = errorPassedToNext;
                    if (typeof expectedResponseProperties.errorPassedToNext !== 'undefined') {
                        if (expectedResponseProperties.errorPassedToNext === true) {
                            responseProperties.errorPassedToNext = true;
                        } else if (typeof expectedResponseProperties.errorPassedToNext === 'string') {
                            responseProperties.errorPassedToNext = errorPassedToNext.message;
                        } else {
                            responseProperties.errorPassedToNext = errorPassedToNext;
                        }
                    } else {
                        return setImmediate(function () {
                            done(errorPassedToNext);
                        });
                    }
                }

                responseProperties.body = Buffer.concat(responseBodyChunks.map(function (bufferOrString) {
                    if (!Buffer.isBuffer(bufferOrString)) {
                        return new Buffer(String(bufferOrString), 'utf-8');
                    } else {
                        return bufferOrString;
                    }
                }));

                var httpResponse = new messy.HttpResponse(res._header || undefined); // Avoid a parse error if empty string
                httpResponse.body = responseProperties.body;

                var httpResponseMatches = httpResponse.satisfies(expectedResponseProperties),
                    headersMatch = httpResponseMatches || httpResponse.headers.satisfy(expectedResponseProperties.headers),
                    bodyMatches = httpResponseMatches || !('body' in expectedResponseProperties) || httpResponse.satisfies({body: expectedResponseProperties.body});

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
