/*global setImmediate:true*/

if (typeof setImmediate === 'undefined') {
    setImmediate = process.nextTick;
}

var http = require('http'),
    stream = require('stream'),
    _ = require('underscore'),
    FormData = require('form-data'),
    messy = require('messy'),
    metadataPropertyNames = ['strictAsync', 'errorPassedToNext', 'isDestroyed', 'nextCalled', 'locals', 'url', 'requestDestroyed'],
    responsePropertyNames = messy.HttpResponse.propertyNames.concat(metadataPropertyNames);

function hasKeys(x) {
    return Object.keys(x).length > 0;
}

function validateResponseProperties(x) {
    return _.intersection(Object.keys(x), responsePropertyNames).length > 0;
}

module.exports = {
    name: 'unexpected-express',
    version: require('../package.json').version,
    installInto: function (expect) {
        var topLevelExpect = expect;

        expect.use(require('unexpected-messy'));

        expect.addType({
            name: 'IncomingMessage',
            base: 'object',
            identify: function (obj) {
                return obj && obj.constructor && obj.constructor.name === 'IncomingMessage';
            },
            inspect: function (obj, depth, output) {
                output.text(obj.constructor.name, 'jsFunctionName');
            }
        });

        expect.addAssertion([
            '<function> to yield exchange satisfying <any>', // Please prefer this one because it does use 'to satisfy' semantics
            '<function> to yield exchange <any>'
        ], function (expect, subject, value, unsupportedDone) {
            if (!subject.handle || !subject.set) {
                // This check is from the lib/application file in express @ 4.10.2.
                // If we get inside here, we have something that is not an express app
                // https://github.com/strongloop/express/blob/661435256384165bb656cb7b6046b4138ca24c9e/lib/application.js#L186
                subject = require('express')().use(subject);
                this.subjectOutput = function () {
                    this.text('express middleware');
                };
            } else {
                this.subjectOutput = function () {
                    this.text('express app');
                };
            }

            if (unsupportedDone) {
                throw new Error('unexpected-express 6 no longer supports a "done" callback, but returns a promise');
            }

            var context = {},
                nextCalls = [];

            value = _.extend({}, value);
            var requestProperties = typeof value.request === 'string' ? {url: value.request} : _.extend({}, value.request),
                requestBody = requestProperties.body,
                httpRequest = new messy.HttpRequest({
                    method: requestProperties.method,
                    url: requestProperties.url || '/',
                    protocolName: 'HTTP',
                    protocolVersion: requestProperties.httpVersion || '1.1',
                    headers: requestProperties.headers,
                    unchunkedBody: requestProperties.unchunkedBody,
                    rawBody: requestProperties.rawBody
                });

            function updateHttpRequestBody(requestBody) {
                if (Buffer.isBuffer(requestBody)) {
                    httpRequest.unchunkedBody = requestBody;
                } else {
                    // string or non-Buffer object (implies JSON)
                    httpRequest.body = requestBody;
                }
            }

            if (typeof requestBody !== 'undefined') {
                updateHttpRequestBody(requestBody);
            } else if ('unchunkedBody' in requestProperties || 'rawBody' in requestProperties) {
                requestBody = httpRequest.body;
            }

            delete value.request;
            delete requestProperties.method;
            delete requestProperties.url;
            delete requestProperties.httpVersion;
            delete requestProperties.headers;
            delete requestProperties.body;
            delete requestProperties.unchunkedBody;
            delete requestProperties.rawBody;
            httpRequest.method = httpRequest.method || 'GET';
            if (httpRequest.encrypted && typeof requestProperties.https === 'undefined') {
                // Warn if conflicting?
                requestProperties.https = true;
            }
            if (requestProperties.formData) {
                if (requestBody) {
                    throw new Error('unexpected-express: The "body" and "formData" options are not supported together');
                }
                requestBody = new FormData();
                Object.keys(requestProperties.formData).forEach(function (name) {
                    var value = requestProperties.formData[name],
                        options;
                    if (typeof value === 'object' && !Buffer.isBuffer(value)) {
                        options = _.extend({}, value);
                        value = options.value;
                        delete options.value;
                        if (options.fileName) {
                            options.filename = options.fileName;
                            delete options.fileName;
                        }
                    }
                    requestBody.append(name, value, options);
                });

                delete requestProperties.formData;
            }

            if (typeof requestProperties.query !== 'undefined') {
                if (typeof requestProperties.query === 'object' && requestProperties.query) {
                    Object.keys(requestProperties.query).forEach(function (parameterName) {
                        var valueOrValues = requestProperties.query[parameterName];
                        (Array.isArray(valueOrValues) ? valueOrValues : [String(valueOrValues)]).forEach(function (value) {
                            httpRequest.url += (httpRequest.url.indexOf('?') === -1 ? '?' : '&') +
                                encodeURIComponent(parameterName) + '=' + encodeURIComponent(value);
                        });
                    });
                } else {
                    httpRequest.url += (httpRequest.url.indexOf('?') === -1 ? '?' : '&') + String(requestProperties.query);
                }
                delete requestProperties.query;
            }

            var responseProperties = value.response;
            delete value.response;
            var expectedResponseProperties;

            if (typeof responseProperties === 'number') {
                expectedResponseProperties = {statusCode: responseProperties};
            } else if (typeof responseProperties === 'string' || Buffer.isBuffer(responseProperties)) {
                expectedResponseProperties = {body: responseProperties};
            } else if (Array.isArray(responseProperties)) {
                throw new Error('unexpected-express: Response object must be a number, string, buffer or object.');
            } else {
                if (responseProperties && hasKeys(responseProperties) && !validateResponseProperties(responseProperties)) {
                    throw new Error('unexpected-express: Response object specification incomplete.');
                }

                expectedResponseProperties = _.extend({}, responseProperties);
            }

            var expectedMetadata = _.extend(
                    {},
                    _.pick(expectedResponseProperties, metadataPropertyNames),
                    _.pick(value, metadataPropertyNames)
                );
            expectedResponseProperties = _.omit(expectedResponseProperties, metadataPropertyNames);

            var missingResponseProperties = Object.keys(expectedResponseProperties).filter(function (key) {
                return responsePropertyNames.indexOf(key) === -1;
            });
            if (missingResponseProperties.length > 0) {
                throw new Error('Property "' + missingResponseProperties[0] + '" does not exist on the response object.');
            }

            var req = new http.IncomingMessage({
                destroy: function () {
                    requestDestroyed = true;
                }
            });

            if (typeof requestBody !== 'undefined') {
                httpRequest.headers.set('Transfer-Encoding', 'chunked');
                if (requestBody.pipe) {
                    if (requestBody.constructor && requestBody.constructor.name === 'FormData') {
                        if (!httpRequest.headers.has('Content-Type')) {
                            httpRequest.headers.set('Content-Type', 'multipart/form-data; boundary=' + requestBody.getBoundary());
                            // form-data pauses its streams by default for some reason:
                            setImmediate(function () {
                                requestBody.resume();
                            });
                        }
                    }
                    var requestBodyChunks = [];
                    requestBody.on('data', function (chunk) {
                        if (!Buffer.isBuffer(chunk)) {
                            chunk = new Buffer(chunk, 'utf-8');
                        }
                        requestBodyChunks.push(chunk);
                        req.push(chunk);
                    }).on('end', function () {
                        updateHttpRequestBody(Buffer.concat(requestBodyChunks));
                        req.push(null);
                    }).on('error', function (err) {
                        req.emit('error', err);
                    });
                } else {
                    if (typeof requestBody === 'object' && !Buffer.isBuffer(requestBody)) {
                        if (!httpRequest.headers.has('Content-Type')) {
                            httpRequest.headers.set('Content-Type', 'application/json');
                        }
                    }

                    if (!httpRequest.headers.has('Content-Length') && !httpRequest.headers.has('Transfer-Encoding')) {
                        httpRequest.headers.set('Content-Length', String(requestBody.length));
                    }
                    setImmediate(function () {
                        // To work around nodejs v0.10.x issue with old-style streams, see also https://github.com/stream-utils/raw-body/pull/34
                        req.push(httpRequest.unchunkedBody);
                        req.push(null);
                    });
                }
            } else {
                req.push(null);
            }

            // Make req.connection.setTimeout a no-op so that req.setTimeout doesn't break
            // in this mocked state:
            req.connection.setTimeout = function () {};

            req.httpVersion = httpRequest.protocolVersion;
            var matchProtocolVersion = String(httpRequest.protocolVersion).match(/^(\d+)(?:\.(\d+))$/);
            if (matchProtocolVersion) {
                req.httpVersionMajor = parseInt(matchProtocolVersion[1], 10);
                req.httpVersionMinor = matchProtocolVersion[2] ? parseInt(matchProtocolVersion[2], 10) : 0;
            }
            req.connection.encrypted = !!requestProperties.https;
            delete requestProperties.https;
            req.connection.remoteAddress = requestProperties.remoteAddress || requestProperties.ip || '127.0.0.1';
            delete requestProperties.ip;
            delete requestProperties.remoteAddress;
            req.headers = {};
            httpRequest.headers.getNames().forEach(function (headerName) {
                var headerNameLowerCase = headerName.toLowerCase();
                if (headerNameLowerCase === 'set-cookie') {
                    req.headers[headerNameLowerCase] = [].concat(httpRequest.headers.getAll(headerName));
                } else {
                    req.headers[headerNameLowerCase] = httpRequest.headers.getAll(headerName).join(', ');
                }
            });
            req.method = httpRequest.method;
            req.url = httpRequest.requestLine.url;
            _.extend(req, requestProperties);

            var res = new http.ServerResponse(req);
            _.extend(res, requestProperties.res); // Allows for specifying eg. res.locals
            delete requestProperties.res;
            res.locals = res.locals || {};

            var rawResponseChunks = [];
            res.assignSocket(new stream.Writable());
            res.connection._write = function (chunk, encoding, cb) {
                rawResponseChunks.push(chunk);
                cb();
            };
            var isAsync = false,
                isDestroyed = false,
                requestDestroyed = false,
                done = false,
                errorPassedToNext;

            res.connection.destroy = function () {
                isDestroyed = true;
            };

            setImmediate(function () {
                isAsync = true;
            });

            return expect.promise(function (resolve, reject) {
                ['write', 'end', 'destroy'].forEach(function (methodName) {
                    var orig = res[methodName];
                    res[methodName] = function (chunk, encoding) {
                        var returnValue = orig.apply(this, arguments);
                        isDestroyed = isDestroyed || methodName === 'destroy';
                        if (methodName === 'end' || methodName === 'destroy') {
                            resolve();
                        }
                        // Don't attempt to implement backpressure, since we're buffering the entire response anyway.
                        if (methodName !== 'write') {
                            return returnValue;
                        }
                    };
                });
                subject(req, res, function (err, _req, _res, _next) {
                    nextCalls.push(arguments);
                    if (nextCalls.length > 1) {
                        if (done) {
                            if (err) {
                                throw err;
                            } else {
                                throw new Error('next called more than once');
                            }
                        } else {
                            // Will be reported as a failure later
                            return;
                        }
                    }
                    errorPassedToNext = err;
                    if (typeof err === 'number') {
                        var statusCode = err;
                        err = new Error('' + statusCode);
                        err.statusCode = statusCode;
                    }
                    res.statusCode = err && (err.statusCode || err.status) || 404;
                    resolve();
                });
            }).then(function () {
                if (res.connection._writableState.corked > 0) {
                    // Wait for the connection to become uncorked before proceeding
                    var originalUncork = res.connection.uncork;
                    return expect.promise(function (resolve, reject) {
                        res.connection.uncork = function () {
                            var returnValue = originalUncork.apply(this, arguments);
                            if (res.connection._writableState.corked === 0) {
                                resolve();
                            }
                            return returnValue;
                        };
                    });
                }
            }).then(function () {
                _.extend(context, {
                    req: req,
                    res: res,
                    httpRequest: httpRequest,
                    metadata: {
                        strictAsync: isAsync,
                        errorPassedToNext: false,
                        isDestroyed: isDestroyed,
                        requestDestroyed: requestDestroyed,
                        nextCalled: nextCalls.length > 0,
                        locals: res.locals,
                        url: req.url
                    }
                });

                if (errorPassedToNext && errorPassedToNext.statusCode && !res.headersSent) {
                    res.writeHead(errorPassedToNext.statusCode);
                }

                if (!res.headersSent) {
                    // Make sure that the already set headers get flushed:
                    res.writeHead(404);
                }

                var httpResponse = context.httpResponse = new messy.HttpResponse(
                    rawResponseChunks.length > 0 ? Buffer.concat(rawResponseChunks) : res._header
                );
                if (typeof httpResponse.rawBody === 'undefined') {
                    httpResponse.rawBody = new Buffer(0);
                }
                httpResponse.statusCode = httpResponse.statusCode || res.statusCode;

                if (errorPassedToNext) {
                    context.metadata.errorPassedToNext = errorPassedToNext;
                    if (typeof expectedMetadata.errorPassedToNext !== 'undefined') {
                        if (expectedMetadata.errorPassedToNext === true) {
                            context.metadata.errorPassedToNext = true;
                        } else if (typeof expectedMetadata.errorPassedToNext === 'string') {
                            context.metadata.errorPassedToNext = errorPassedToNext.message;
                        } else {
                            context.metadata.errorPassedToNext = errorPassedToNext;
                        }
                    } else if (typeof errorPassedToNext.statusCode === 'number') {
                        // FIXME
                        if (!httpResponse.headers.get('Content-Type')) {
                            httpResponse.headers.set('Content-Type', 'text/plain');
                            httpResponse.body = errorPassedToNext.stack;
                        }
                    } else {
                        throw errorPassedToNext;
                    }
                }

                context.httpExchange = new messy.HttpExchange({
                    request: context.httpRequest,
                    response: context.httpResponse
                });

                var promiseByKey = {
                    httpExchange: expect.promise(function () {
                        return expect(context.httpExchange, 'to satisfy', {response: expectedResponseProperties});
                    }),
                    metadata: {}
                };
                Object.keys(expectedMetadata).forEach(function (key) {
                    promiseByKey.metadata[key] = expect.promise(function () {
                        return topLevelExpect(context.metadata[key], 'to satisfy', expectedMetadata[key]);
                    });
                });
                return expect.promise.settle(promiseByKey).then(function (promises) {
                    if (promises.some(function (promise) { return promise.isRejected(); })) {
                        expect.fail({
                            diff: function (output) {
                                if (promiseByKey.httpExchange.isRejected()) {
                                    output.append(promiseByKey.httpExchange.reason().getDiff(output).diff);
                                } else {
                                    output.appendInspected(context.httpExchange);
                                }
                                Object.keys(promiseByKey.metadata).forEach(function (key) {
                                    if (promiseByKey.metadata[key].isRejected()) {
                                        output.nl().annotationBlock(function () {
                                            this.text(key).text(':').sp().append(promiseByKey.metadata[key].reason().getErrorMessage(output));
                                        });
                                    }
                                });
                                return { diff: output };
                            }
                        });
                    }
                });
            }).then(function () {
                if (nextCalls.length > 1) {
                    throw new Error('next called more than once');
                }
                done = true; // Tell the next function that subsequent calls should cause an exception to be thrown
                return context;
            });
        });
    }
};

module.exports.messy = messy;
