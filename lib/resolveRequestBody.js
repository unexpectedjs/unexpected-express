const FormData = require('form-data');
const isStream = require('is-stream');
const qs = require('qs');

module.exports = function resolveRequestBody(requestProperties, httpRequest) {
  let requestBody = requestProperties.body;

  if (requestProperties.form) {
    const requestForm = requestProperties.form;
    if (typeof requestForm !== 'string') {
      requestBody = qs.stringify(requestForm);
    } else {
      requestBody = requestForm;
    }

    if (!httpRequest.headers.has('Content-Type')) {
      httpRequest.headers.set(
        'Content-Type',
        'application/x-www-form-urlencoded'
      );
    }
  } else if (requestProperties.formData) {
    if (requestBody) {
      throw new Error(
        'unexpected-express: The "body" and "formData" options are not supported together'
      );
    }

    requestBody = new FormData();

    Object.keys(requestProperties.formData).forEach(name => {
      let value = requestProperties.formData[name];

      let options = {};

      if (isStream.readable(value) && value.path) {
        options.filename = value.path;
      } else if (typeof value === 'object' && !Buffer.isBuffer(value)) {
        options = { ...value };
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
  } else if (
    'unchunkedBody' in requestProperties ||
    'rawBody' in requestProperties
  ) {
    requestBody = httpRequest.body;
  }

  return requestBody;
};
