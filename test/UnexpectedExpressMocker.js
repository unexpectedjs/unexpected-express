const expect = require('unexpected');
const express = require('express');
const http = require('http');
const messy = require('messy');

const UnexpectedExpressMocker = require('../lib/UnexpectedExpressMocker');

describe('UnexpectedExpressMocker', () => {
  it('should resolve with the context', async () => {
    const mocker = new UnexpectedExpressMocker({
      request: 'POST /foo/bar',
      response: 204
    });
    const app = express().post('/foo/bar', (req, res) => {
      res.status(204).send();
    });

    const context = await expect(() => mocker.mock(app), 'to be fulfilled');

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
    const mocker = new UnexpectedExpressMocker({
      request: 'POST /foo/bar',
      response: 204
    });

    return expect(
      () =>
        mocker.mock((req, res) => {
          res.status(204).send();
        }),
      'to be fulfilled'
    );
  });
});
