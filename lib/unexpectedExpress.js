/*global setImmediate:true*/

if (typeof setImmediate === 'undefined') {
    setImmediate = process.nextTick;
}

var BufferedStream = require('bufferedstream'),
    URL = require('url'),
    http = require('http'),
    _ = require('underscore');

// Convert a header name to its canonical form, eg. "content-length" => "Content-Length".
var headerNameSpecialCases = {
    'a-im': 'A-IM',
    bcc: 'BCC',
    cc: 'CC',
    'content-md5': 'Content-MD5',
    'c-pep': 'C-PEP',
    'c-pep-info': 'C-PEP-Info',
    'content-features': 'Content-features',
    'content-id': 'Content-ID',
    dasl: 'DASL',
    dav: 'DAV',
    'dl-expansion-history': 'DL-Expansion-History',
    'differential-id': 'Differential-ID',
    'discarded-x400-ipms-extensions': 'Discarded-X400-IPMS-Extensions',
    'discarded-x400-mts-extensions': 'Discarded-X400-MTS-Extensions',
    'dkim-signature': 'DKIM-Signature',
    'ediint-features': 'EDIINT-Features',
    'jabber-id': 'Jabber-ID',
    'list-id': 'List-ID',
    'mime-version': 'MIME-Version',
    'message-id': 'Message-ID',
    'mmhs-exempted-address': 'MMHS-Exempted-Address',
    'mmhs-extended-authorisation-info': 'MMHS-Extended-Authorisation-Info',
    'mmhs-subject-indicator-codes': 'MMHS-Subject-Indicator-Codes',
    'mmhs-handling-instructions': 'MMHS-Handling-Instructions',
    'mmhs-message-instructions': 'MMHS-Message-Instructions',
    'mmhs-codress-message-indicator': 'MMHS-Codress-Message-Indicator',
    'mmhs-originator-reference': 'MMHS-Originator-Reference',
    'mmhs-primary-precedence': 'MMHS-Primary-Precedence',
    'mmhs-copy-precedence': 'MMHS-Copy-Precedence',
    'mmhs-message-type': 'MMHS-Message-Type',
    'mmhs-other-receipients-indicator-to': 'MMHS-Other-Recipients-Indicator-To',
    'mmhs-other-recipients-indicator-cc': 'MMHS-Other-Recipients-Indicator-CC',
    'mmhs-acp127-message-identifier': 'MMHS-Acp127-Message-Identifier',
    'mmhs-originator-plad': 'MMHS-Originator-PLAD',
    'mt-priority': 'MT-Priority',
    'nntp-posting-date': 'NNTP-Posting-Date',
    'nntp-posting-host': 'NNTP-Posting-Host',
    'original-message-id': 'Original-Message-ID',
    dnt: 'DNT',
    etag: 'ETag',
    p3p: 'P3P',
    pep: 'PEP̈́',
    'pics-label': 'PICS-Label',
    'prevent-nondelivery-report': 'Prevent-NonDelivery-Report',
    profileobject: 'ProfileObject',
    'received-spf': 'Received-SPF',
    'resent-message-id': 'Resent-Message-ID',
    'sec-websocket-accept': 'Sec-WebSocket-Accept',
    'sec-websocket-extensions': 'Sec-WebSocket-Extensions',
    'sec-websocket-key': 'Sec-WebSocket-Key',
    'sec-websocket-protocol': 'Sec-WebSocket-Protocol',
    'sec-websocket-version': 'Sec-WebSocket-Version',
    slug: 'SLUG',
    soapaction: 'SoapAction',
    'status-uri': 'Status-URI',
    subok: 'SubOK',
    tcn: 'TCN',
    te: 'TE',
    'ua-color': 'UA-Color',
    'ua-media': 'UA-Media',
    'ua-pixels': 'UA-Pixels',
    'ua-resolution': 'UA-Resolution',
    'ua-windowpixels': 'UA-Windowpixels',
    uri: 'URI',
    'vbr-info': 'VBR-Info',
    'www-authenticate': 'WWW-Authenticate',
    'x400-mts-identifier': 'X400-MTS-Identifier',
    'x-att-deviceid': 'X-ATT-DeviceId',
    'x-cdn': 'X-CDN',
    'x-csa-complaints': 'x-csa-complaints',
    'x-ua-compatible': 'X-UA-Compatible',
    'x-riferimento-message-id': 'X-Riferimento-Message-ID',
    'x-sg-eid': 'X-SG-EID',
    'x-tiporicevuta': 'X-TipoRicevuta',
    'x-verificasicurezza': 'X-VerificaSicurezza',
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
                        return setImmediate(function () {
                            done(errorPassedToNext);
                        });
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
