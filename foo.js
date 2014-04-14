var expect = require('unexpected')
    .clone()
    .installPlugin(require('./lib/unexpectedExpress'));

function myMiddleware(req, res, next) {
    res.setHeader('Content-Type', req.headers['content-type']);
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
