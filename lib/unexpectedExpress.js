/*global setImmediate:true, setTimeout*/

if (typeof setImmediate === 'undefined') {
    setImmediate = process.nextTick;
}

var BufferedStream = require('bufferedstream'),
    URL = require('url'),
    http = require('http'),
    stream = require('stream'),
    _ = require('underscore'),
    FormData = require('form-data'),
    messy = require('messy'),
    metadataPropertyNames = ['strictAsync', 'errorPassedToNext', 'isDestroyed', 'nextCalled'];

module.exports = {
    name: 'unexpected-express',
    installInto: function (expect) {
        expect.installPlugin(require('unexpected-messy'));

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

        expect.addAssertion('IncomingMessage', 'to have url satisfying', function (expect, subject, value) {
            this.errorMode = 'nested';
            expect(subject.url, 'to satisfy', value);
        });

        expect.addAssertion('function', 'to yield exchange', function (expect, subject, value, unsupportedDone) {
            var that = this;

            if (!subject.handle || !subject.set) {
                // This check is from the lib/application file in express @ 4.10.2.
                // If we get inside here, we have something that is not an express app
                // https://github.com/strongloop/express/blob/661435256384165bb656cb7b6046b4138ca24c9e/lib/application.js#L186
                subject = require('express')().use(subject);
                this.subject = expect.output.clone().text('express middleware');
            } else {
                this.subject = expect.output.clone().text('express app');
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
            if (requestProperties.formData) {
                if (requestBody) {
                    throw new Error('unexpected-express: The "body" and "formData" options are not supported together');
                }
                requestBody = new FormData();
                Object.keys(requestProperties.formData).forEach(function (name) {
                    var value = requestProperties.formData[name],
                        options;
                    if (typeof value === 'object') {
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

            var expectedResponseProperties;

            if (typeof value.response === 'number') {
                expectedResponseProperties = {statusCode: value.response};
            } else if (typeof value.response === 'string' || Buffer.isBuffer(value.response)) {
                expectedResponseProperties = {body: value.response};
            } else {
                expectedResponseProperties = _.extend({}, value.response);
            }
            delete value.response;

            var expectedMetadata = _.extend(
                    {},
                    _.pick(expectedResponseProperties, metadataPropertyNames),
                    _.pick(value, metadataPropertyNames)
                );
            expectedResponseProperties = _.omit(expectedResponseProperties, metadataPropertyNames);

            var missingResponseProperties = Object.keys(expectedResponseProperties).filter(function (key) {
                return messy.HttpResponse.propertyNames.indexOf(key) === -1 && metadataPropertyNames.indexOf(key) === -1 && key !== 'url' && key !== 'locals';
            });
            if (missingResponseProperties.length > 0) {
                throw new Error('Property "' + missingResponseProperties[0] + '" does not exist on the response object.');
            }

            var responseProperties = {},
                requestStream,
                req;

            if (typeof requestBody !== 'undefined') {
                httpRequest.headers.set('Transfer-Encoding', 'chunked');
                if (requestBody.pipe) {
                    requestStream = requestBody;
                    if (requestStream.constructor && requestStream.constructor.name === 'FormData') {
                        if (!httpRequest.headers.has('Content-Type')) {
                            httpRequest.headers.set('Content-Type', 'multipart/form-data; boundary=' + requestStream.getBoundary());
                            // form-data pauses its streams by default for some reason:
                            setImmediate(function () {
                                requestStream.resume();
                            });
                        }
                    }
                    var requestBodyChunks = [];
                    requestStream.on('data', function (chunk) {
                        if (!Buffer.isBuffer(chunk)) {
                            chunk = new Buffer(chunk, 'utf-8');
                        }
                        requestBodyChunks.push(chunk);
                        req.emit('data', chunk);
                    }).on('end', function () {
                        updateHttpRequestBody(Buffer.concat(requestBodyChunks));
                        req.emit('end');
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
                    requestStream = new BufferedStream();
                    setImmediate(function emitRequestBodyOnceThereIsAListener() {
                        if (req.listeners('data').length > 0 || req.listeners('end').length > 0) {
                            req.emit('data', httpRequest.unchunkedBody);
                            req.emit('end');
                        } else {
                            setTimeout(emitRequestBodyOnceThereIsAListener, 10);
                        }
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
            req.httpVersion = httpRequest.protocolVersion;
            if (requestProperties.flowMode) {
                delete requestProperties.flowMode;
                req.resume();
            }
            var matchProtocolVersion = String(httpRequest.protocolVersion).match(/^(\d+)(?:\.(\d+))$/);
            if (matchProtocolVersion) {
                req.httpVersionMajor = parseInt(matchProtocolVersion[1], 10);
                req.httpVersionMinor = matchProtocolVersion[2] ? parseInt(matchProtocolVersion[2], 10) : 0;
            }
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
                _.extend(context, {
                    req: req,
                    res: res,
                    httpRequest: httpRequest,
                    metadata: {
                        strictAsync: isAsync,
                        errorPassedToNext: false,
                        isDestroyed: isDestroyed,
                        nextCalled: nextCalls.length > 0
                    }
                });

                if (errorPassedToNext && errorPassedToNext.statusCode) {
                    res.writeHead(errorPassedToNext.statusCode);
                }

                var httpResponse = context.httpResponse = new messy.HttpResponse(
                    rawResponseChunks.length > 0 ? Buffer.concat(rawResponseChunks) : res._header || undefined
                );
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
                return expect(context.metadata, 'to satisfy', expectedMetadata);
            }).then(function () {
                if (expectedResponseProperties.locals) {
                    var expectedLocals = expectedResponseProperties.locals;
                    delete expectedResponseProperties.locals;
                    return expect({ res: { locals: res.locals } }, 'to satisfy', { res: { locals: expectedLocals } });
                }
            }).then(function () {
                if (expectedResponseProperties.url) {
                    var expectedUrl = expectedResponseProperties.url;
                    delete expectedResponseProperties.url;
                    that.errorMode = 'diff';
                    return expect(req, 'to have url satisfying', expectedUrl);
                }
            }).then(function () {
                that.errorMode = 'default';
                return expect(new messy.HttpExchange({
                    request: context.httpRequest,
                    response: context.httpResponse
                }), 'to satisfy', {response: expectedResponseProperties});
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
