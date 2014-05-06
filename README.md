Unexpected-express
==================

Plugin for [Unexpected](https://github.com/sunesimonsen/) that makes it easy to test [Express.js](https://github.com/visionmedia/express/) middleware.

Example:

```javascript
var expect = require('unexpected')
    .clone()
    .installPlugin(require('unexpected-express'));

function myMiddleware(req, res, next) {
    var contentType = req.headers['accept'] || 'text/plain';
    if (contentType !== 'text/plain' && contentType !== 'text/html') {
        return next(400);
    }
    res.setHeader('Content-Type', contentType);
    var body = 'Here goes ' + req.url + ' as ' + contentType;
    if (contentType === 'text/html') {
        body = '<html>' + body.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</html>';
    }
    res.send(body);
}

describe('myMiddleware', function (done) {
    it('should handle a simple request', function (done) {
        expect(require('express')().use(myMiddleware), 'to be middleware that processes', {
            request: {
                url: '/blah',
                headers: {
                    Accept: 'text/plain'
                }
            },
            response: {
                statusCode: 200,
                headers: {
                    'Content-Type': 'foo/bar'
                },
                body: 'Here goes /blah as foo/bar'
            }
        }, done);
    });
});
```

If you're going to test a piece of middleware extensively, you can create your
own custom assertion around that to increase DRYness and put the request
properties into the subject's spot:

```javascript
expect.addAssertion('to yield a response of', function (expect, subject, value, done) {
    expect(require('express')().use(myMiddleware), 'to be middleware that processes', {
        request: subject,
        response: value
    }, done);
});

describe('myMiddleware', function () {
    it('should default to text/plain', function (done) {
        expect({url: '/barf'}, 'to yield a response of', {body: 'Here goes /barf as text/plain'}, done);
    });

    it('should support text/html', function (done) {
        expect({url: '/quux', headers: {Accept: 'text/html'}}, 'to yield a response of', {body: '<html>Here goes /quux as text/html</html>'}, done);
    });

    it('should entitify less than and ampersand chars in text/html', function (done) {
        expect({url: '/<h&ey<', headers: {Accept: 'text/html'}}, 'to yield a response of', {body: '<html>Here goes /&lt;h&amp;ey&lt; as text/html</html>'}, done);
    });

    it('should not entitify in text/plain', function (done) {
        expect({url: '/<hey'}, 'to yield a response of', {body: 'Here goes /<hey as text/plain'}, done);
    });

    it('should return a 400 if asked for an unsupported Content-Type', function (done) {
        expect({url: '/something', headers: {Accept: 'text/calendar'}}, 'to yield a response of', {statusCode: 400}, done);
    });

    it('should return a 404 for /baz', function (done) {
        expect({url: '/baz'}, 'to yield a response of', {statusCode: 404, body: 'I could not find /baz'}, done);
    });
});
```

You'll get a nice diff when expectations aren't met:

```
  1) myMiddleware return a 404 for /baz:

      Error: expected [Function: app] to be middleware that processes { request: { url: '/baz', headers: {} },
  response: { statusCode: 404, body: 'I could not find /baz' } }, [Function]
      + expected - actual
```
```diff
{
+  "body": "I could not find /baz",
-  "body": "Here goes /baz as text/plain",
   "isDestroyed": false,
   "nextCalled": false,
+  "statusCode": 404
-  "statusCode": 200
}
```
```
      at ServerResponse.res.(anonymous function) [as end] (/path/to/unexpected-express/lib/unexpectedExpress.js:99:25)
      at ServerResponse.res.send (/path/to/unexpected-express/node_modules/express/lib/response.js:154:8)
      at Object.myMiddleware [as handle] (/path/to/unexpected-express/hey.js:8:9)
      at next (/path/to/unexpected-express/node_modules/express/node_modules/connect/lib/proto.js:193:15)
      at Object.expressInit [as handle] (/path/to/unexpected-express/node_modules/express/lib/middleware.js:30:5)
      at next (/path/to/unexpected-express/node_modules/express/node_modules/connect/lib/proto.js:193:15)
      at Object.query [as handle] (/path/to/unexpected-express/node_modules/express/node_modules/connect/lib/middleware/query.js:45:5)
      at next (/path/to/unexpected-express/node_modules/express/node_modules/connect/lib/proto.js:193:15)
      at Function.app.handle (/path/to/unexpected-express/node_modules/express/node_modules/connect/lib/proto.js:201:3)
      at app (/path/to/unexpected-express/node_modules/express/node_modules/connect/lib/connect.js:65:37)
      at Assertion.<anonymous> (/path/to/unexpected-express/lib/unexpectedExpress.js:108:9)
      at Unexpected.expect (unexpected-core.js:338:25)
      at wrappedExpect (unexpected-core.js:313:33)
      at Assertion.expect.url (/path/to/unexpected-express/hey.js:32:5)
      at Unexpected.expect (unexpected-core.js:338:25)
      at Context.<anonymous> (/path/to/unexpected-express/hey.js:48:9)
      at Test.Runnable.run (/path/to/mocha/lib/runnable.js:196:15)
      at Runner.runTest (/path/to/mocha/lib/runner.js:374:10)
      at /path/to/mocha/lib/runner.js:452:12
      at next (/path/to/mocha/lib/runner.js:299:14)
      at /path/to/mocha/lib/runner.js:309:7
      at next (/path/to/mocha/lib/runner.js:247:23)
      at Object._onImmediate (/path/to/mocha/lib/runner.js:276:5)
      at processImmediate [as _immediateCallback] (timers.js:330:15)
```

Additional features:

* Normalizes header names so you don't need to use the ugly lower-case form in the assertions
* The expected response bodies can be specified as either strings, objects (implies JSON), or Buffer instances
* Request bodies can be provided as either strings, objects (implies JSON), Buffer instances, or streams.
* Request body streams that are instances of https://github.com/felixge/node-form-data are special cased to implicitly set the `Content-Type` header correctly.

License
-------

Unexpected-express is licensed under a standard 3-clause BSD license
-- see the `LICENSE` file for details.
