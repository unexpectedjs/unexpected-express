const expect = require('unexpected');
const express = require('express');
const http = require('http');
const messy = require('messy');

const UnexpectedExpressMocker = require('../lib/UnexpectedExpressMocker');

describe('UnexpectedExpressMocker', () => {
  it('should resolve with the context', async () => {
    const app = express().post('/foo/bar', (req, res) => {
      res.status(204).send();
    });
    const mocker = new UnexpectedExpressMocker(app);

    const context = await expect(
      () =>
        mocker.mock({
          request: 'POST /foo/bar'
        }),
      'to be fulfilled'
    );

    expect(context, 'to exhaustively satisfy', {
      req: expect.it('to be a', http.IncomingMessage),
      res: expect.it('to be a', http.ServerResponse),
      metadata: expect.it('to be an object'),
      httpRequest: expect.it('to be a', messy.HttpRequest),
      httpResponse: expect.it('to be a', messy.HttpResponse),
      httpExchange: expect.it('to be a', messy.HttpExchange)
    });
  });

  it('should allow being passed a middleware', () => {
    const mocker = new UnexpectedExpressMocker((req, res) => {
      res.status(204).send();
    });

    return expect(
      () =>
        mocker.mock({
          request: 'POST /foo/bar'
        }),
      'to be fulfilled'
    );
  });
});
