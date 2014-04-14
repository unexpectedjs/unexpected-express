Unexpected-express
==================

Plugin for [Unexpected](https://github.com/sunesimonsen/) that makes it easy to test [Express.js](https://github.com/visionmedia/express/) middleware.

Example:

```javascript
var expect = require('unexpected')
    .clone()
    .installPlugin(require('unexpected-express'));

function myMiddleware(req, res, next) {
    res.setHeader('Content-Type', req.headers['accept']);
    res.send('Here goes ' + req.url);
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
                body: 'Here goes /blah in the form of text/plain',
                headers: {
                    'Content-Type': 'text/plain'
                }
            }
        }, done);
    });
});
```

License
-------

Unexpected-express is licensed under a standard 3-clause BSD license
-- see the `LICENSE` file for details.
