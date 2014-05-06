var BufferedStream = require('bufferedstream'),
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
        expect(done, 'to be a function');
        var requestProperties = _.extend({method: 'GET'}, value.request),
            expectedResponseProperties = typeof value.response === 'number' ? {statusCode: value.response} : _.extend({}, value.response);

        requestProperties.headers = lowerCaseHeaderNames(requestProperties.headers || {});

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
        _.extend(req, requestProperties);

        var res = new http.ServerResponse(req);
        _.extend(res, requestProperties.res); // Allows for specifying eg. res.locals
        res.connection = new BufferedStream();
        res.connection._httpMessage = res;

        var nextCallCount = 0,
            next = function (err, _req, _res, _next) {
                nextCallCount += 1;
                res.statusCode = err && (err.statusCode || err.status) || 404;
                doTheAssertions();
            };

        var responseBodyChunks = [],
            isDestroyed = false,
            isAsync = false;

        setImmediate(function () {
            isAsync = true;
        });

        function doTheAssertions() {
            // Apparently setImmediate (or throwing an exception) is not an option here. If we don't call done, errors won't make it into mocha.
            try {
                var expectedResponseHeaders,
                    responseProperties = {
                        strictAsync: isAsync,
                        statusCode: res.statusCode,
                        isDestroyed: isDestroyed,
                        nextCalled: nextCallCount > 0
                    };

                if (typeof expectedResponseProperties.headers === 'object') {
                    expectedResponseHeaders = expectedResponseProperties.headers;
                    delete expectedResponseProperties.headers;
                }

                if (responseBodyChunks.length > 0) {
                    responseProperties.body = Buffer.concat(responseBodyChunks);
                    if (typeof expectedResponseProperties.body === 'string') {
                        responseProperties.body = responseProperties.body.toString('utf-8');
                    } else if (expectedResponseProperties.body && !Buffer.isBuffer(expectedResponseProperties.body) && typeof expectedResponseProperties.body === 'object' && /^application\/json\b/.test(res._headers['content-type'])) {
                        responseProperties.body = JSON.parse(responseProperties.body.toString('utf-8'));
                    }
                }
                expect(responseProperties, 'to have properties', expectedResponseProperties);
                if (expectedResponseHeaders) {
                    expect(formatHeaderNames(res._headers), 'to have properties', formatHeaderNames(expectedResponseHeaders));
                }
            } catch (err) {
                return done(err);
            }
            done();
        }
        ['write', 'end', 'destroy'].forEach(function (methodName) {
            var orig = res[methodName];
            res[methodName] = function (chunk, encoding) {
                var returnValue = orig.apply(this, arguments);
                if (methodName !== 'destroy') {
                    if (encoding) {
                        throw new Error('encoding parameter not supported');
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
