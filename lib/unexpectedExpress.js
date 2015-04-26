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
            // capture the current stack
            var stack;
            try {
                throw new Error('<message>');
            } catch (e) {
                stack = e.stack;
            }

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

            return expect.promise(function (resolve, reject) {
                var context = {},
                    nextCalled = false;

                value = _.extend({}, value);
                var requestProperties = typeof value.request === 'string' ? {url: value.request} : _.extend({}, value.request),
                    httpRequest = new messy.HttpRequest({
                        method: requestProperties.method,
                        url: requestProperties.url || '/',
                        protocolName: 'HTTP',
                        protocolVersion: requestProperties.httpVersion || '1.1',
                        headers: requestProperties.headers
                    });
                httpRequest._body = requestProperties.body;
                delete value.request;
                delete requestProperties.method;
                delete requestProperties.url;
                delete requestProperties.httpVersion;
                delete requestProperties.headers;
                delete requestProperties.body;
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
                    if (httpRequest._body) {
                        throw new Error('unexpected-express: The "body" and "formData" options are not supported together');
                    }
                    httpRequest._body = new FormData();
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
                        httpRequest._body.append(name, value, options);
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

                var responseProperties = {},
                    requestStream,
                    req;

                if (typeof httpRequest._body !== 'undefined') {
                    httpRequest.headers.set('Transfer-Encoding', 'chunked');
                    if (httpRequest._body.pipe) {
                        requestStream = httpRequest._body;
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
                            httpRequest._body = Buffer.concat(requestBodyChunks);
                            req.emit('end');
                        }).on('error', function (err) {
                            req.emit('error', err);
                        });
                    } else {
                        if (typeof httpRequest._body === 'object' && !Buffer.isBuffer(httpRequest._body)) {
                            if (!httpRequest.headers.has('Content-Type')) {
                                httpRequest.headers.set('Content-Type', 'application/json');
                            }
                            httpRequest._body = JSON.stringify(httpRequest._body);
                        }

                        if (!Buffer.isBuffer(httpRequest._body)) {
                            httpRequest._body = new Buffer(String(httpRequest._body), 'utf-8');
                        }
                        if (!httpRequest.headers.has('Content-Length') && !httpRequest.headers.has('Transfer-Encoding')) {
                            httpRequest.headers.set('Content-Length', String(httpRequest._body.length));
                        }
                        requestStream = new BufferedStream();
                        setImmediate(function emitRequestBodyOnceThereIsAListener() {
                            if (req.listeners('data').length > 0 || req.listeners('end').length > 0) {
                                req.emit('data', httpRequest._body);
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

                var next = function (err, _req, _res, _next) {
                    if (nextCalled) {
                        throw new Error('next called more than once');
                    }
                    nextCalled = true;
                    if (typeof err === 'number') {
                        var statusCode = err;
                        err = new Error('' + statusCode);
                        err.statusCode = statusCode;
                    }
                    res.statusCode = err && (err.statusCode || err.status) || 404;
                    doTheAssertions(err);
                };

                var isDestroyed = false,
                    isAsync = false;

                setImmediate(function () {
                    isAsync = true;
                });
                var doTheAssertions = function (errorPassedToNext) {
                    var expectedMetadata = _.extend(
                            {},
                            _.pick(expectedResponseProperties, metadataPropertyNames),
                            _.pick(value, metadataPropertyNames)
                        );
                    expectedResponseProperties = _.omit(expectedResponseProperties, metadataPropertyNames);
                    _.extend(context, {
                        req: req,
                        res: res,
                        next: next,
                        httpRequest: httpRequest,
                        metadata: {
                            strictAsync: isAsync,
                            errorPassedToNext: false,
                            isDestroyed: isDestroyed,
                            nextCalled: nextCalled
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
                            return reject(errorPassedToNext);
                        }
                    }

                    var missingResponseProperties = Object.keys(expectedResponseProperties).filter(function (key) {
                        return !(key in httpResponse) && !(key in httpResponse.statusLine) && metadataPropertyNames.indexOf(key) === -1 && key !== 'rawBody' && key !== 'url' && key !== 'locals';
                    });
                    if (missingResponseProperties.length > 0) {
                        return reject(new Error('Property "' + missingResponseProperties[0] + '" does not exist on the response object.'));
                    }

                    expect.promise(function () {
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
                            request: httpRequest,
                            response: httpResponse
                        }), 'to satisfy', {response: expectedResponseProperties});
                    }).then(function () {
                        resolve();
                    }).caught(function (err) {
                        reject(err);
                    });
                };
                ['write', 'end', 'destroy'].forEach(function (methodName) {
                    var orig = res[methodName];
                    res[methodName] = function (chunk, encoding) {
                        var returnValue = orig.apply(this, arguments);
                        isDestroyed = isDestroyed || methodName === 'destroy';
                        if (methodName === 'end' || methodName === 'destroy') {
                            doTheAssertions();
                        }
                        // Don't attempt to implement backpressure, since we're buffering the entire response anyway.
                        if (methodName !== 'write') {
                            return returnValue;
                        }
                    };
                });
                subject(req, res, next);
            });
        });
    }
};

module.exports.messy = messy;
