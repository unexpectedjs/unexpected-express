/*global setImmediate:true*/

if (typeof setImmediate === 'undefined') {
    setImmediate = process.nextTick;
}

var BufferedStream = require('bufferedstream'),
    URL = require('url'),
    http = require('http'),
    _ = require('underscore'),
    messy = require('messy'),
    formatHeaderName = messy.formatHeaderName;

function lowerCaseHeaderNames(obj) {
    var resultObj = {};
    Object.keys(obj || {}).forEach(function (headerName) {
        resultObj[headerName.toLowerCase()] = obj[headerName];
    });
    return resultObj;
}

function isTextualContentType(contentType) {
    if (typeof contentType === 'string') {
        contentType = contentType.toLowerCase().trim().replace(/\s*;.*$/, '');
        return (
            /^text\//.test(contentType) ||
            /^application\/(json|javascript)$/.test(contentType) ||
            /^application\/xml/.test(contentType) ||
            /\+xml$/.test(contentType)
        );
    }
    return false;
}

function bufferCanBeInterpretedAsUtf8(buffer) {
    // Hack: Since Buffer.prototype.toString('utf-8') is very forgiving, convert the buffer to a string
    // with percent-encoded octets, then see if decodeURIComponent accepts it.
    try {
        decodeURIComponent(Array.prototype.map.call(buffer, function (octet) {
            return '%' + (octet < 16 ? '0' : '') + octet.toString(16);
        }).join(''));
    } catch (e) {
        return false;
    }
    return true;
}

module.exports = function (expect) {
    expect.addType({
        equal: function (httpRequest1, httpRequest2) {
            return httpRequest1.equal(httpRequest2);
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
                .text(httpRequest.protocol, 'cyan')
                .nl();

            inspect(output, httpRequest.headers);
            return output;
        }
    }).addType({
        equal: function (httpResponse1, httpResponse2) {
            return httpResponse1.equal(httpResponse2);
        },
        identify: function (obj) {
            return obj instanceof messy.HttpResponse;
        },
        inspect: function (output, httpResponse, inspect) {
            output
                .text(httpResponse.protocol, 'blue')
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

        var requestProperties = typeof value.request === 'string' ? {url: value.request} : _.extend({}, value.request);
        if (typeof requestProperties.url === 'string') {
            var matchMethod = requestProperties.url.match(/^([A-Z]+) ([\s\S]*)$/);
            if (matchMethod) {
                requestProperties.method = requestProperties.method || matchMethod[1];
                requestProperties.url = matchMethod[2];
            }
        }

        requestProperties.method = requestProperties.method || 'GET';

        requestProperties.headers = _.extend({}, requestProperties.headers); // Make a shallow copy so it's OK to add to it

        var expectedResponseProperties;

        if (typeof value.response === 'number') {
            expectedResponseProperties = {statusCode: value.response};
        } else if (typeof value.response === 'string' || Buffer.isBuffer(value.response)) {
            expectedResponseProperties = {body: value.response};
        } else {
            expectedResponseProperties = _.extend({}, value.response);
        }
        requestProperties.headers = lowerCaseHeaderNames(requestProperties.headers);

        if (/^https?:\/\//.test(requestProperties.url)) {
            var urlObj = URL.parse(requestProperties.url);
            if (typeof requestProperties.headers.host === 'undefined') {
                requestProperties.headers.host = urlObj.host;
            }
            if (urlObj.protocol === 'https:' && typeof requestProperties.https === 'undefined') {
                requestProperties.https = true;
            }
            requestProperties.url = urlObj.path;
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
                    requestProperties.headers['content-type'] = requestProperties.headers['content-type'] || 'multipart/form-data; boundary=' + requestStream.getBoundary();
                    // form-data pauses its streams by default for some reason:
                    setImmediate(function () {
                        requestStream.resume();
                    });
                }
                requestProperties.headers['transfer-encoding'] = requestProperties.headers['transfer-encoding'] || 'chunked';
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
                    url: req.url,
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

                if (responseBodyChunks.length > 0) {
                    responseProperties.body = Buffer.concat(responseBodyChunks.map(function (bufferOrString) {
                        if (!Buffer.isBuffer(bufferOrString)) {
                            return new Buffer(String(bufferOrString), 'utf-8');
                        } else {
                            return bufferOrString;
                        }
                    }));
                    if ((typeof expectedResponseProperties.body === 'string' || (typeof expectedResponseProperties.body === 'object' && !Buffer.isBuffer(expectedResponseProperties.body))) || (typeof expectedResponseProperties.body === 'undefined' && bufferCanBeInterpretedAsUtf8(responseProperties.body) && isTextualContentType(res._headers['content-type']))) {
                        try {
                            responseProperties.body = responseProperties.body.toString('utf-8');
                        } catch (e) {
                            // The body cannot be intepreted as utf-8, keep it as a Buffer instance
                        }
                    }
                    if (/^application\/json\b/i.test(res._headers['content-type']) && typeof responseProperties.body === 'string' && (typeof expectedResponseProperties.body === 'undefined' || (typeof expectedResponseProperties.body === 'object' && !Buffer.isBuffer(expectedResponseProperties.body)))) {
                        responseProperties.body = JSON.parse(responseProperties.body);
                    } else if (Buffer.isBuffer(expectedResponseProperties.body) && (!responseProperties.body || typeof responseProperties.body === 'string')) {
                        responseProperties.body = new Buffer(responseProperties.body, 'utf-8');
                    }
                } else if (Buffer.isBuffer(expectedResponseProperties.body) && expectedResponseProperties.body.length === 0) {
                    responseProperties.body = new Buffer([]);
                } else if (expectedResponseProperties.body === '') {
                    responseProperties.body = '';
                }

                var httpResponse = new messy.HttpResponse(res._header || undefined);
                httpResponse.body = responseProperties.body;

                var headersMatch = true;
                if (typeof expectedResponseProperties.headers !== 'undefined') {
                    var expectedResponseHeaders = new messy.Headers(expectedResponseProperties.headers),
                        headersThatMustNotBePresent = expectedResponseProperties.headers && typeof expectedResponseProperties.headers === 'object' && Object.keys(expectedResponseProperties.headers).filter(function (headerName) {
                            return typeof expectedResponseProperties.headers[headerName] === 'undefined';
                        });
                    delete expectedResponseProperties.headers;
                    if (expectedResponseHeaders.getNames().some(function (headerName) {
                        return !httpResponse.hasHeader(headerName, expectedResponseProperties.headers[headerName]);
                    })) {
                        headersMatch = false;
                    } else if (headersThatMustNotBePresent.some(function (headerName) {
                        return httpResponse.hasHeader(headerName);
                    })) {
                        headersMatch = false;
                    }
                }

                var bodyMatches = !('body' in expectedResponseProperties) || expect.equal(responseProperties.body, expectedResponseProperties.body);
                delete expectedResponseProperties.body;
                expect(responseProperties, 'to have properties', expectedResponseProperties);
                if (!headersMatch || !bodyMatches) {
                    console.log(expect.inspect(httpResponse, expect.output.clone()).toString('ansi'));
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
