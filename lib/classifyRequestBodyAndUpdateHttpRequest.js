module.exports = function classifyRequestBodyAndUpdateHttpRequest(
  requestBody,
  httpRequest,
  useFastJson = false
) {
  let hasFormData = false;
  let hasFastJson = false;
  let hasStream = false;

  if (typeof requestBody === 'undefined') {
    return null;
  }

  httpRequest.headers.set('Transfer-Encoding', 'chunked');
  if (requestBody.pipe) {
    hasStream = true;
    if (
      requestBody.constructor &&
      requestBody.constructor.name === 'FormData'
    ) {
      hasFormData = true;
      if (!httpRequest.headers.has('Content-Type')) {
        httpRequest.headers.set(
          'Content-Type',
          `multipart/form-data; boundary=${requestBody.getBoundary()}`
        );
      }
    }
  } else {
    if (typeof requestBody === 'object' && !Buffer.isBuffer(requestBody)) {
      if (!httpRequest.headers.has('Content-Type')) {
        httpRequest.headers.set('Content-Type', 'application/json');
      }

      if (useFastJson) {
        hasFastJson = true;
      } else {
        requestBody = httpRequest.unchunkedBody;
      }
    }

    if (
      !hasFastJson &&
      !httpRequest.headers.has('Content-Length') &&
      !httpRequest.headers.has('Transfer-Encoding')
    ) {
      httpRequest.headers.set('Content-Length', String(requestBody.length));
    }
  }

  return {
    hasFormData,
    hasFastJson,
    hasStream,
    requestBody
  };
};
