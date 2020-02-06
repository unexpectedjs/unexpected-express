const makePromise = require('unexpected/lib/makePromise');
const http = require('http');
const messy = require('messy');
const stream = require('stream');
const qs = require('qs');

const classifyRequestBodyAndUpdateHttpRequest = require('./classifyRequestBodyAndUpdateHttpRequest');
const errors = require('./errors');
const resolveRequestBody = require('./resolveRequestBody');

function applyRequestBodyToToReq(requestBodyState, req, updateHttpRequestBody) {
  if (requestBodyState) {
    const { hasFormData, hasStream, requestBody } = requestBodyState;

    if (hasStream) {
      if (hasFormData) {
        // form-data pauses its streams by default for some reason:
        setImmediate(() => {
          requestBody.resume();
        });
      }
      const requestBodyChunks = [];
      requestBody
        .on('data', chunk => {
          if (!Buffer.isBuffer(chunk)) {
            chunk = Buffer.from(chunk, 'utf-8');
          }
          requestBodyChunks.push(chunk);
          req.push(chunk);
        })
        .on('end', () => {
          updateHttpRequestBody(Buffer.concat(requestBodyChunks));
          req.push(null);
        })
        .on('error', err => {
          req.emit('error', err);
        });
    } else {
      setImmediate(() => {
        // To work around nodejs v0.10.x issue with old-style streams, see also https://github.com/stream-utils/raw-body/pull/34
        req.push(requestBody);
        req.push(null);
      });
    }
  } else {
    req.push(null);
  }
}

function determineStatusProperty(obj) {
  for (const prop of ['statusCode', 'status']) {
    if (typeof obj[prop] === 'number') {
      return prop;
    }
  }
  return null;
}

class UnexpectedExpressMocker {
  constructor(subject) {
    if (!subject.handle || !subject.set) {
      // This check is from the lib/application file in express @ 4.10.2.
      // If we get inside here, we have something that is not an express app
      // https://github.com/strongloop/express/blob/661435256384165bb656cb7b6046b4138ca24c9e/lib/application.js#L186
      subject = require('express')().use(subject);
    }

    this.subject = subject;
  }

  mock(options) {
    const requestProperties =
      typeof options.request === 'string'
        ? { url: options.request }
        : { ...options.request };
    const expectedErrorPassedToNext = options.expectedErrorPassedToNext;

    const httpRequest = new messy.HttpRequest({
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

    const requestBody = resolveRequestBody(requestProperties, httpRequest);
    updateHttpRequestBody(requestBody);

    delete requestProperties.method;
    delete requestProperties.url;
    delete requestProperties.httpVersion;
    delete requestProperties.headers;
    delete requestProperties.body;
    delete requestProperties.unchunkedBody;
    delete requestProperties.rawBody;
    httpRequest.method = httpRequest.method || 'GET';
    if (
      httpRequest.encrypted &&
      typeof requestProperties.https === 'undefined'
    ) {
      // Warn if conflicting?
      requestProperties.https = true;
    }

    if (typeof requestProperties.query !== 'undefined') {
      if (
        typeof requestProperties.query === 'object' &&
        requestProperties.query
      ) {
        const stringifiedQueryString = qs.stringify(requestProperties.query);
        if (stringifiedQueryString) {
          httpRequest.url +=
            (httpRequest.url.indexOf('?') === -1 ? '?' : '&') +
            stringifiedQueryString;
        }
      } else {
        httpRequest.url +=
          (httpRequest.url.indexOf('?') === -1 ? '?' : '&') +
          String(requestProperties.query);
      }
      delete requestProperties.query;
    }

    let requestDestroyed = false;
    const req = new http.IncomingMessage({
      destroy() {
        requestDestroyed = true;
      }
    });

    const requestBodyState = classifyRequestBodyAndUpdateHttpRequest(
      requestBody,
      httpRequest
    );

    // Make req.connection.setTimeout a no-op so that req.setTimeout doesn't break
    // in this mocked state:
    req.connection.setTimeout = () => {};

    req.httpVersion = httpRequest.protocolVersion;
    const matchProtocolVersion = String(httpRequest.protocolVersion).match(
      /^(\d+)(?:\.(\d+))$/
    );
    if (matchProtocolVersion) {
      req.httpVersionMajor = parseInt(matchProtocolVersion[1], 10);
      req.httpVersionMinor = matchProtocolVersion[2]
        ? parseInt(matchProtocolVersion[2], 10)
        : 0;
    }
    req.connection.encrypted = !!requestProperties.https;
    delete requestProperties.https;
    req.connection.remoteAddress =
      requestProperties.remoteAddress || requestProperties.ip || '127.0.0.1';
    delete requestProperties.ip;
    delete requestProperties.remoteAddress;
    req.headers = {};
    httpRequest.headers.getNames().forEach(headerName => {
      const headerNameLowerCase = headerName.toLowerCase();
      if (headerNameLowerCase === 'set-cookie') {
        req.headers[headerNameLowerCase] = [].concat(
          httpRequest.headers.getAll(headerName)
        );
      } else {
        req.headers[headerNameLowerCase] = httpRequest.headers
          .getAll(headerName)
          .join(', ');
      }
    });
    req.method = httpRequest.method;
    req.url = httpRequest.requestLine.url;
    Object.assign(req, requestProperties);

    applyRequestBodyToToReq(requestBodyState, req, updateHttpRequestBody);

    const res = new http.ServerResponse(req);
    Object.assign(res, requestProperties.res); // Allows for specifying eg. res.locals
    delete requestProperties.res;
    res.locals = res.locals || {};

    const rawResponseChunks = [];
    res.assignSocket(new stream.Writable());
    res.connection._write = (chunk, encoding, cb) => {
      rawResponseChunks.push(chunk);
      cb();
    };

    let isDestroyed = false;
    res.connection.destroy = () => {
      isDestroyed = true;
    };

    let isAsync = false;
    setImmediate(() => {
      isAsync = true;
    });

    const context = {};
    const nextCalls = [];
    let done = false;
    let errorPassedToNext;

    return makePromise((resolve, reject) => {
      ['write', 'end', 'destroy'].forEach(methodName => {
        const orig = res[methodName];
        res[methodName] = function(chunk, encoding) {
          const returnValue = orig.apply(this, arguments);
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
      this.subject(req, res, function(err, _req, _res, _next) {
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

        // handle calling next() with a status code
        if (typeof err === 'number') {
          const statusCode = err;
          err = new Error(`${statusCode}`);
          err.statusCode = statusCode;
          errorPassedToNext = err;
        } else {
          errorPassedToNext = err;
        }

        resolve();
      });
    })
      .then(() => {
        if (res.connection._writableState.corked > 0) {
          // Wait for the connection to become uncorked before proceeding
          const originalUncork = res.connection.uncork;
          return new Promise(resolve => {
            res.connection.uncork = function() {
              const returnValue = originalUncork.apply(this, arguments);
              if (res.connection._writableState.corked === 0) {
                resolve();
              }
              return returnValue;
            };
          });
        }
      })
      .then(() => {
        Object.assign(context, {
          req,
          res,
          metadata: {
            strictAsync: isAsync,
            errorPassedToNext: false,
            isDestroyed,
            requestDestroyed,
            nextCalled: nextCalls.length > 0,
            locals: res.locals,
            url: req.url
          },
          httpRequest
        });

        let hasWrittenErrorStatusCode = false;
        if (errorPassedToNext && !res.headersSent) {
          hasWrittenErrorStatusCode = true;
          let statusCode;
          const statusProperty = determineStatusProperty(errorPassedToNext);
          if (statusProperty) {
            statusCode = errorPassedToNext[statusProperty];
          } else {
            statusCode = 500;
          }
          res.statusCode = statusCode;
          res.writeHead(statusCode);
        }

        if (!res.headersSent) {
          res.statusCode = 404;
          // Make sure that the already set headers get flushed:
          res.writeHead(404);
        }

        const httpResponse = (context.httpResponse = new messy.HttpResponse(
          rawResponseChunks.length > 0
            ? Buffer.concat(rawResponseChunks)
            : res._header
        ));
        if (typeof httpResponse.rawBody === 'undefined') {
          httpResponse.rawBody = Buffer.from([]);
        }
        httpResponse.statusCode = httpResponse.statusCode || res.statusCode;

        if (errorPassedToNext) {
          if (typeof expectedErrorPassedToNext !== 'undefined') {
            if (expectedErrorPassedToNext === true) {
              context.metadata.errorPassedToNext = true;
            } else if (typeof expectedErrorPassedToNext === 'string') {
              context.metadata.errorPassedToNext = errorPassedToNext.message;
            } else {
              context.metadata.errorPassedToNext = errorPassedToNext;
            }
          } else if (determineStatusProperty(errorPassedToNext)) {
            // FIXME
            if (!httpResponse.headers.get('Content-Type')) {
              httpResponse.headers.set('Content-Type', 'text/plain');
              httpResponse.body = errorPassedToNext.stack;
            }
            context.metadata.errorPassedToNext = new errors.ExplicitRouteError({
              data: { error: errorPassedToNext }
            });
          } else if (hasWrittenErrorStatusCode) {
            context.metadata.errorPassedToNext = new errors.UnknownRouteError({
              data: { error: errorPassedToNext }
            });
          } else {
            context.metadata.errorPassedToNext = new errors.SilentRouteError({
              data: { error: errorPassedToNext }
            });
          }
        }

        context.httpExchange = new messy.HttpExchange({
          request: context.httpRequest,
          response: context.httpResponse
        });
      })
      .then(() => {
        if (nextCalls.length > 1) {
          throw new Error('next called more than once');
        }
        done = true; // Tell the next function that subsequent calls should cause an exception to be thrown
        return context;
      });
  }
}

module.exports = UnexpectedExpressMocker;
