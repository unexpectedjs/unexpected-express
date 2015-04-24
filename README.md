Unexpected-express
==================

Plugin for [Unexpected](https://github.com/unexpectedjs/unexpected) that makes it easy to test [Express.js](https://github.com/visionmedia/express/) middleware. Uses the [unexpected-messy](https://github.com/unexpectedjs/unexpected-messy) plugin to do most of the heavy lifting.

[![NPM version](https://badge.fury.io/js/unexpected-express.svg)](http://badge.fury.io/js/unexpected-express)
[![Build Status](https://travis-ci.org/unexpectedjs/unexpected-express.svg?branch=master)](https://travis-ci.org/unexpectedjs/unexpected-express)
[![Coverage Status](https://coveralls.io/repos/unexpectedjs/unexpected-express/badge.svg)](https://coveralls.io/r/unexpectedjs/unexpected-express)
[![Dependency Status](https://david-dm.org/unexpectedjs/unexpected-express.svg)](https://david-dm.org/unexpectedjs/unexpected-express)

![Unexpected Express (train)](http://upload.wikimedia.org/wikipedia/commons/1/19/Train_wreck_at_Montparnasse_1895.jpg)

Example
-------

Assert that a particular request specified in the *request* property to
myMiddleware results in a response whose values match those in the properties
listed in the *response* property:

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

describe('myMiddleware', function () {
    it('should handle a simple request', function () {
        return expect(require('express')().use(myMiddleware), 'to yield exchange', {
            request: {
                url: '/blah',
                headers: {
                    Accept: 'text/plain'
                }
            },
            response: {
                statusCode: 200,
                headers: {
                    'Content-Type': 'text/plain'
                },
                body: 'Here goes /blah as text/plain'
            }
        });
    });
});
```

Extended assertions
-------------------

Sometimes you may want to make additional assertions on the response after the
primary comparisons are completed by 'to yield exchange'. This is possible by
attaching another function to the promise that is returned and executing further
assertions.

For example, imagine a middleware that generates a timestamp on returned requests
and while you may not know what the value will be, you wish to assert it's presence:

```javascript
function secondMiddleware(req, res, next) {
    var contentType = req.headers['accept'] || 'text/plain';
    if (contentType !== 'application/json') {
        return next(400);
    }

    var body = req.body;

    body.timestamp = Date.now();

    res.send(body);
}

describe('secondMiddleware', function () {
    it('should attach a timestamp to responses, function () {
        return expect(require('express')().use(secondMiddleware), 'to yield exchange', {
            request: {
                url: '/other',
                body: {
                    foo: 'bar'
                }
            },
            response: {
                statusCode: 200
                body: {
                    foo: 'bar'
                }
            }
        }).then(function (context) {
            // retrieve the response body
            var body = context.httpResponse.body;

            expect(body.timestamp, 'to be defined');
        });
    });
});

```

The context object provided to the then() callback will be provided a context
object exposes the following properties on which assertions can be made:

- httpRequest
- httpResponse
- res
- req

Extensive testing
-----------------

If you're going to test a piece of middleware extensively, you can create your
own custom assertion around that to increase DRYness and put the request
properties into the subject's spot:

```javascript
expect.addAssertion('to yield a response of', function (expect, subject, value) {
    return expect(require('express')().use(myMiddleware), 'to yield exchange', {
        request: subject,
        response: value
    });
});

describe('myMiddleware', function () {
    it('should default to text/plain', function () {
        return expect('/barf', 'to yield a response of', 'Here goes /barf as text/plain');
    });

    it('should support text/html', function () {
        return expect({url: '/quux', headers: {Accept: 'text/html'}}, 'to yield a response of', '<html>Here goes /quux as text/html</html>');
    });

    it('should entitify less than and ampersand chars in text/html', function () {
        return expect({url: '/<h&ey<', headers: {Accept: 'text/html'}}, 'to yield a response of', '<html>Here goes /&lt;h&amp;ey&lt; as text/html</html>');
    });

    it('should not entitify in text/plain', function () {
        return expect('/<hey', 'to yield a response of', 'Here goes /<hey as text/plain');
    });

    it('should return a 400 if asked for an unsupported Content-Type', function () {
        return expect({url: '/something', headers: {Accept: 'text/calendar'}}, 'to yield a response of', {statusCode: 400, errorPassedToNext: true});
    });

    it('should return a 404 for /baz', function () {
        return expect('/baz', 'to yield a response of', {statusCode: 404, body: 'I could not find /baz'});
    });
});
```

To read more about adding custom assertions please see the unexpected
documentation [here](http://unexpectedjs.github.io/api/addAssertion/).

Reporting
---------

You'll get a nice diff when expectations aren't met:

![Diff example](diffExample.png)

Additional features:
--------------------

* Normalizes header names so you don't need to use the ugly lower-case form in the assertions
* The expected response bodies can be specified as either strings, objects (implies JSON), or Buffer instances
* Request bodies can be provided as either strings, objects (implies JSON), Buffer instances, or streams.
* Request body streams that are instances of https://github.com/felixge/node-form-data are special cased to implicitly set the `Content-Type` header correctly.

License
-------

Unexpected-express is licensed under a standard 3-clause BSD license
-- see the `LICENSE` file for details.
