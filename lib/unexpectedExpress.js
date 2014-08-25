/*global setImmediate:true*/

if (typeof setImmediate === 'undefined') {
    setImmediate = process.nextTick;
}

var BufferedStream = require('bufferedstream'),
    URL = require('url'),
    http = require('http'),
    _ = require('underscore'),
    messy = require('messy'),
    metadataPropertyNames = ['strictAsync', 'errorPassedToNext', 'isDestroyed', 'nextCalled'];

module.exports = function (expect) {
    expect.installPlugin(require('unexpected-messy'));

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
                method: requestProperties.method,
                url: requestProperties.url || '/',
                protocolName: 'HTTP',
                protocolVersion: requestProperties.httpVersion || '1.1',
                headers: requestProperties.headers,
                body: requestProperties.body
            });
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

        if (typeof httpRequest.body !== 'undefined') {
            if (httpRequest.body.pipe) {
                requestStream = httpRequest.body;
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
                var requestBodyChunks = [];
                requestStream.on('data', function (chunk) {
                    if (!Buffer.isBuffer(chunk)) {
                        chunk = new Buffer(chunk, 'utf-8');
                    }
                    requestBodyChunks.push(chunk);
                    req.emit('data', chunk);
                }).on('end', function () {
                    httpRequest.body = Buffer.concat(requestBodyChunks);
                    req.emit('end');
                }).on('error', function (err) {
                    req.emit('error', err);
                });
            } else {
                if (typeof httpRequest.body === 'object' && !Buffer.isBuffer(httpRequest.body)) {
                    if (!httpRequest.headers.has('Content-Type')) {
                        httpRequest.headers.set('Content-Type', 'application/json');
                    }
                    httpRequest.body = JSON.stringify(httpRequest.body);
                }

                if (!Buffer.isBuffer(httpRequest.body)) {
                    httpRequest.body = new Buffer(String(httpRequest.body), 'utf-8');
                }
                if (!httpRequest.headers.has('Content-Length') && !httpRequest.headers.has('Transfer-Encoding')) {
                    httpRequest.headers.set('Content-Length', String(httpRequest.body.length));
                }
                requestStream = new BufferedStream();
                setImmediate(function () {
                    req.emit('data', httpRequest.body);
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
        req.httpVersion = httpRequest.protocolVersion;
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
            var err = null,
                context = {
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
                },
                expectedMetadata = _.extend(
                    {},
                    _.pick(expectedResponseProperties, metadataPropertyNames),
                    _.pick(value, metadataPropertyNames)
                );

            // Apparently setImmediate (or throwing an exception) is not an option here. If we don't call done, errors won't make it into mocha.
            try {
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

                expect(context.metadata, 'to satisfy', expectedMetadata);

                try {
                    expect(httpResponse, 'to satisfy', expectedResponseProperties);
                } catch (e) {
                    var expectedResponseHeaders = httpResponse.headers.clone();
                    _.extend(expectedResponseHeaders.valuesByName, new messy.Headers(expectedResponseProperties.headers).valuesByName);
                    Object.keys(expectedResponseProperties.headers).forEach(function (headerName) {
                        if (typeof expectedResponseProperties.headers[headerName] === 'undefined') {
                            expectedResponseHeaders.remove(headerName);
                        }
                    });

                    var expectedHttpResponse = context.expectedHttpResponse = new messy.HttpResponse({
                        statusLine: _.defaults(_.pick(expectedResponseProperties, messy.StatusLine.propertyNames), httpResponse.statusLine),
                        headers: expectedResponseHeaders,
                        body: expectedResponseProperties.body
                    });
                    expect.fail(function (output) {
                        httpRequest.upgradeBody();
                        output.append(expect.inspect(httpRequest)).nl();
                        if (httpResponse.statusLine.satisfies(expectedHttpResponse.statusLine)) {
                            output.append(expect.inspect(httpResponse.statusLine));
                        } else {
                            output.append(expect.diff(httpResponse.statusLine.toString(), expectedHttpResponse.statusLine.toString()).diff);
                        }
                        output.nl();
                        if (httpResponse.headers.equals(expectedHttpResponse.headers)) {
                            output.append(expect.inspect(httpResponse.headers));
                        } else {
                            output.append(expect.diff(
                                httpResponse.headers.toString().replace(/\r\n$/, '').split(/\r\n/).sort().join('\n'),
                                expectedHttpResponse.headers.toString().replace(/\r\n$/, '').split(/\r\n/).sort().join('\n')
                            ).diff);
                            output.nl();
                        }
                        if (!('body' in expectedResponseProperties) || httpResponse.satisfies({body: expectedHttpResponse.body})) {
                            if (typeof httpResponse.body !== 'undefined') {
                                httpResponse.upgradeBody();
                                output.nl();
                                if (typeof httpResponse.body === 'string') {
                                    var contentType = httpResponse.headers.get('Content-Type');
                                    if (contentType) {
                                        var language = contentType.replace(/\s*;.*$/, ''); // Strip charset etc.
                                        output.code(httpResponse.body, language);
                                    } else {
                                        output.text(httpResponse.body);
                                    }
                                } else {
                                    // Buffer instance or parsed JSON
                                    output.append(expect.inspect(httpResponse.body));
                                }
                            }
                        } else {
                            output.append(expect.diff(httpResponse.body, expectedHttpResponse.body).diff);
                        }
                        return output;
                   });
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
