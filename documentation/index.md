---
template: default.ejs
theme: dark
title: unexpected-express
repository: https://github.com/unexpectedjs/unexpected-express
---

# Unexpected-express

![Unexpected Express (train)](trainWreck.jpg)

## Example

Assert that a particular request specified in the _request_ property to
myMiddleware results in a response whose values match those in the properties
listed in the _response_ property:

```js#evaluate:false
var expect = require('unexpected')
  .clone()
  .installPlugin(require('unexpected-express'));
```

```js
function myMiddleware(req, res, next) {
  var contentType = req.headers['accept'] || 'text/plain';
  if (contentType !== 'text/plain' && contentType !== 'text/html') {
    return res.status(400).end();
  }
  res.type(contentType);
  var body = 'Here goes ' + req.url + ' as ' + contentType;
  if (contentType === 'text/html') {
    body =
      '<html>' + body.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</html>';
  }
  res.send(body);
}
```

```js#async:true
return expect(express().use(myMiddleware), 'to yield exchange', {
  request: {
    url: '/blah',
    headers: {
      Accept: 'text/plain',
    },
  },
  response: {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body: 'Here goes /blah as text/plain',
  },
});
```

## Extended assertions

Sometimes you may want to make additional assertions on the response after the
primary comparisons are completed by 'to yield exchange'. This is possible by
attaching another function to the promise that is returned and executing further
assertions.

For example, imagine a middleware that generates a timestamp on returned requests
and while you may not know what the value will be, you wish to assert its presence:

```js
function secondMiddleware(req, res, next) {
  res.type('json');
  var body = {};
  body.timestamp = Date.now();
  res.send(body);
}
```

```js#async:true
return expect(express().use(secondMiddleware), 'to yield exchange', {
  request: 'GET /other',
  response: 200,
}).then(function (context) {
  // retrieve the response body
  var body = context.httpResponse.body;

  expect(body.timestamp, 'to be defined');
});
```

The context object provided to the `then()` callback will be provided a context
object exposes the following properties on which assertions can be made:

- httpRequest
- httpResponse
- res
- req

## Extensive testing

If you're going to test a piece of middleware extensively, you can create your
own custom assertion around that to increase DRYness and put the request
properties into the subject's spot:

```js#async:true
expect.addAssertion(
  '<object|string> to yield a response of <object|number>',
  function (expect, subject, value) {
    return expect(express().use(myMiddleware), 'to yield exchange', {
      request: subject,
      response: value,
    });
  }
);
```

```js#async:true
return expect('/barf', 'to yield a response of', {
  body: 'Here goes /barf as text/plain',
});
```

```js#async:true
return expect(
  {
    url: '/quux',
    headers: {
      Accept: 'text/html',
    },
  },
  'to yield a response of',
  {
    body: '<html>Here goes /quux as text/html</html>',
  }
);
```

```js#async:true
// should entitify less than and ampersand chars in text/html
return expect(
  {
    url: '/<h&ey<',
    headers: {
      Accept: 'text/html',
    },
  },
  'to yield a response of',
  {
    body: '<html>Here goes /&lt;h&amp;ey&lt; as text/html</html>',
  }
);
```

```js
// should not entitify in text/plain
return expect('/<hey', 'to yield a response of', {
  body: 'Here goes /<hey as text/plain',
});
```

```js#async:true
// should return a 400 if asked for an unsupported Content-Type
return expect(
  {
    url: '/something',
    headers: {
      Accept: 'text/calendar',
    },
  },
  'to yield a response of',
  400
);
```

To read more about adding custom assertions please see the unexpected
documentation [here](http://unexpected.js.org/api/addAssertion/).

## Testing POST requests

There are three commonly used way to POST content to a backend: JSON POST-request (`Content-Type = application/json`), HTML form POST-request (`Content-Type = application/x-www-form-urlencoded`) and multipart POST-request typically used for file uploads (`Content-Type = multipart/form-data`).

### JSON

To test JSON POST-requests you can use the `request` objects `data`-property:

```js#async:true
return expect(express().use(myMiddleware), 'to yield exchange', {
  request: {
    url: 'POST /api/',
    body: {
      title: 'Hello World',
    },
  },
  response: 200,
});
```

### HTML form POST

To test HTML form POST-requests you can use the `request` objects `form`-property:

```js#async:true
return expect(express().use(myMiddleware), 'to yield exchange', {
  request: {
    url: 'POST /api/',
    form: {
      title: 'Hello World',
    },
  },
  response: 200,
});
```

### Multipart (file upload) form POST

To test multipart form POST-requests you can use the `request` objects `formData`-property:

```js#async:true
return expect(express().use(myMiddleware), 'to yield exchange', {
  request: {
    url: 'POST /api/',
    formData: {
      title: 'Hello World',
      attachment: {
        value: Buffer.from([0x00, 0x01]),
        contentType: 'foo/bar',
        filename: 'blabla',
      },
    },
  },
  response: 200,
});
```

## Reporting

You'll get a nice diff when expectations aren't met:

```js#async:true
return expect('/baz', 'to yield a response of', {
  statusCode: 404,
  body: 'I could not find /baz',
});
```

```output
expected '/baz'
to yield a response of { statusCode: 404, body: 'I could not find /baz' }

GET /baz HTTP/1.1

HTTP/1.1 200 OK // should be 404 Not Found
                //
                // -HTTP/1.1 200 OK
                // +HTTP/1.1 404 Not Found
X-Powered-By: Express
Content-Type: text/plain; charset=utf-8
Content-Length: 28
ETag: W/"1c-HFUAMbnVgCT4McocftsoE3lehW4"
Date: Sat, 12 Mar 2016 22:56:04 GMT
Connection: keep-alive

-Here goes /baz as text/plain
+I could not find /baz
```

## Additional features:

- Normalizes header names so you don't need to use the ugly lower-case form in the assertions
- The expected response bodies can be specified as either strings, objects (implies JSON), or Buffer instances
- Request bodies can be provided as either strings, objects (implies JSON), Buffer instances, or streams.
- Request body streams that are instances of https://github.com/felixge/node-form-data are special cased to implicitly set the `Content-Type` header correctly.

## License

Unexpected-express is licensed under a standard 3-clause BSD license
-- see the `LICENSE` file for details.
