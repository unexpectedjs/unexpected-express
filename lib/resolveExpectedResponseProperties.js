const intersection = require('lodash/intersection');
const messy = require('messy');
const pick = require('lodash/pick');
const omit = require('lodash/omit');

const metadataPropertyNames = [
  'strictAsync',
  'errorPassedToNext',
  'isDestroyed',
  'nextCalled',
  'locals',
  'url',
  'requestDestroyed',
];
const responsePropertyNames = messy.HttpResponse.propertyNames.concat(
  metadataPropertyNames
);

function hasKeys(x) {
  return Object.keys(x).length > 0;
}

function validateResponseProperties(x) {
  return intersection(Object.keys(x), responsePropertyNames).length > 0;
}

module.exports = function (value) {
  const responseProperties = value.response;

  let expectedResponseProperties;
  if (typeof responseProperties === 'number') {
    expectedResponseProperties = { statusCode: responseProperties };
  } else if (
    typeof responseProperties === 'string' ||
    Buffer.isBuffer(responseProperties)
  ) {
    expectedResponseProperties = { body: responseProperties };
  } else if (Array.isArray(responseProperties)) {
    throw new Error(
      'unexpected-express: Response object must be a number, string, buffer or object.'
    );
  } else {
    if (
      responseProperties &&
      hasKeys(responseProperties) &&
      !validateResponseProperties(responseProperties)
    ) {
      throw new Error(
        'unexpected-express: Response object specification incomplete.'
      );
    }

    expectedResponseProperties = { ...responseProperties };
  }

  const missingResponseProperties = Object.keys(
    expectedResponseProperties
  ).filter((key) => responsePropertyNames.indexOf(key) === -1);
  if (missingResponseProperties.length > 0) {
    throw new Error(
      `Property "${missingResponseProperties[0]}" does not exist on the response object.`
    );
  }

  const expectedMetadata = {
    ...pick(expectedResponseProperties, metadataPropertyNames),
    ...pick(value, metadataPropertyNames),
  };

  expectedResponseProperties = omit(
    expectedResponseProperties,
    metadataPropertyNames
  );

  return { expectedResponseProperties, expectedMetadata };
};
