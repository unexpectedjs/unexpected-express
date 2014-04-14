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
        var requestProperties = value.request,
            expectedResponseProperties = value.response;

        requestProperties.headers = lowerCaseHeaderNames(requestProperties.headers || {});

        var responseProperties = {},
            req = new http.IncomingMessage();
        _.extend(req, requestProperties);

        var res = new http.ServerResponse(req);
        res.connection = new BufferedStream();
        res.connection._httpMessage = res;

        var nextCallCount = 0,
            next = function (err, _req, _res, _next) {
                res.nextCallCount += 1;
                res.statusCode = err && err.statusCode || 404;
                done();
            };

        var responseBodyChunks = [];
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
                    var responseProperties = {
                        statusCode: res.statusCode,
                        body: Buffer.concat(responseBodyChunks),
                        isDestroyed: methodName === 'destroy',
                        nextCalled: nextCallCount > 0
                    };
                    if (typeof expectedResponseProperties.headers === 'object') {
                        expect(formatHeaderNames(res._headers), 'to have properties', formatHeaderNames(expectedResponseProperties.headers));
                        delete expectedResponseProperties.headers;
                    }
                    if (typeof expectedResponseProperties.body === 'string') {
                        responseProperties.body = responseProperties.body.toString('utf-8');
                    } else if (expectedResponseProperties.body && !Buffer.isBuffer(expectedResponseProperties.body) && typeof expectedResponseProperties.body === 'object' && /^application\/json\b/.test(res._headers['content-type'])) {
                        responseProperties.body = JSON.parse(responseProperties.body.toString('utf-8'));
                    }
                    try {
                        expect(responseProperties, 'to have properties', expectedResponseProperties);
                    } catch (err) {
                        return done(err);
                    }
                    done();
                }
                return returnValue;
            };
        });
        subject(req, res, next);
    });
};
