var BufferedStream = require('bufferedstream'),
    URL = require('url'),
    http = require('http'),
    _ = require('underscore');

// Convert a header name to its canonical form, eg. "content-length" => "Content-Length".
var headerNameSpecialCases = {
    'content-md5': 'Content-MD5',
    dnt: 'DNT',
    etag: 'ETag',
    p3p: 'P3P',
    te: 'TE',
    'www-authenticate': 'WWW-Authenticate',
    'x-att-deviceid': 'X-ATT-DeviceId',
    'x-cdn': 'X-CDN',
    'x-ua-compatible': 'X-UA-Compatible',
    'x-xss-protection': 'X-XSS-Protection'
};

function formatHeaderName(headerName) {
    var lowerCasedHeaderName = headerName.toLowerCase();
    if (headerNameSpecialCases.hasOwnProperty(lowerCasedHeaderName)) {
        return headerNameSpecialCases[lowerCasedHeaderName];
    } else {
        // Make sure that the first char and all chars following a dash are upper-case:
        return lowerCasedHeaderName.replace(/(^|-)([a-z])/g, function ($0, optionalLeadingDash, ch) {
            return optionalLeadingDash + ch.toUpperCase();
        });
    }
}

function formatHeaderNames(obj) {
    var resultObj = {};
    Object.keys(obj || {}).forEach(function (headerName) {
        resultObj[formatHeaderName(headerName)] = obj[headerName];
    });
    return resultObj;
}

function lowerCaseHeaderNames(obj) {
    var resultObj = {};
    Object.keys(obj || {}).forEach(function (headerName) {
        resultObj[headerName.toLowerCase()] = obj[headerName];
    });
    return resultObj;
}

module.exports = function (expect) {
    return expect.addAssertion('to be middleware that processes', function (expect, subject, value, done) {
        this.errorMode = 'nested';
        expect(done, 'to be a function');
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
            // FIXME: Empty BufferedStream?
            requestStream = {
                destroy: function () {
                    responseProperties.requestDestroyed = true;
                }
            };
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
                var expectedResponseHeaders,
                    responseProperties = context.responseProperties = {
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
                        // Unexpected error, fail
                        return done(errorPassedToNext);
                    }
                }

                if (typeof expectedResponseProperties.headers === 'object') {
                    expectedResponseHeaders = expectedResponseProperties.headers;
                    delete expectedResponseProperties.headers;
                }

                if (responseBodyChunks.length > 0) {
                    responseProperties.body = Buffer.concat(responseBodyChunks.map(function (bufferOrString) {
                        if (!Buffer.isBuffer(bufferOrString)) {
                            return new Buffer(String(bufferOrString), 'utf-8');
                        } else {
                            return bufferOrString;
                        }
                    }));
                    if (typeof expectedResponseProperties.body === 'string') {
                        responseProperties.body = responseProperties.body.toString('utf-8');
                    } else if (Buffer.isBuffer(expectedResponseProperties.body) && typeof responseProperties.body === 'string') {
                        responseProperties.body = new Buffer(responseProperties.body, 'utf-8');
                    } else if (expectedResponseProperties.body && !Buffer.isBuffer(expectedResponseProperties.body) && typeof expectedResponseProperties.body === 'object' && /^application\/json\b/.test(res._headers['content-type'])) {
                        responseProperties.body = JSON.parse(responseProperties.body.toString('utf-8'));
                    }
                } else if (Buffer.isBuffer(expectedResponseProperties.body) && expectedResponseProperties.body.length === 0) {
                    responseProperties.body = new Buffer([]);
                } else if (expectedResponseProperties.body === '') {
                    responseProperties.body = '';
                }
                expect(responseProperties, 'to have properties', expectedResponseProperties);
                if (expectedResponseHeaders) {
                    expect(formatHeaderNames(res._headers), 'to have properties', formatHeaderNames(expectedResponseHeaders));
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
