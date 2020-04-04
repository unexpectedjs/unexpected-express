const expect = require('unexpected');
const express = require('express');
const http = require('http');
const messy = require('messy');

const errors = require('../lib/errors');
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
          request: 'POST /foo/bar',
        }),
      'to be fulfilled'
    );

    expect(context, 'to exhaustively satisfy', {
      req: expect.it('to be an', http.IncomingMessage),
      res: expect.it('to be an', http.ServerResponse),
      metadata: expect.it('to be an object'),
      httpRequest: expect.it('to be a', messy.HttpRequest),
      httpResponse: expect.it('to be a', messy.HttpResponse),
      httpExchange: expect.it('to be a', messy.HttpExchange),
    });
  });

  it('should allow being passed a middleware', () => {
    const mocker = new UnexpectedExpressMocker((req, res) => {
      res.status(204).send();
    });

    return expect(
      () =>
        mocker.mock({
          request: 'POST /foo/bar',
        }),
      'to be fulfilled'
    );
  });

  describe('with a throwing route', () => {
    it('should resolve with an error with statusCode wrapped as an ExplicitRouteError', async () => {
      const error = new Error('boom');
      error.statusCode = 418;
      const mocker = new UnexpectedExpressMocker((req, res) => {
        throw error;
      });

      const context = await mocker.mock({
        request: 'POST /foo/bar',
      });

      return expect(context, 'to satisfy', {
        metadata: {
          errorPassedToNext: expect
            .it('to be an', errors.ExplicitRouteError)
            .and('to satisfy', { data: { error } }),
        },
      });
    });

    it('should resolve with an error with status wrapped as an ExplicitRouteError', async () => {
      const error = new Error('boom');
      error.status = 418;
      const mocker = new UnexpectedExpressMocker((req, res) => {
        throw error;
      });

      const context = await mocker.mock({
        request: 'POST /foo/bar',
      });

      return expect(context, 'to satisfy', {
        metadata: {
          errorPassedToNext: expect
            .it('to be an', errors.ExplicitRouteError)
            .and('to satisfy', { data: { error } }),
        },
      });
    });

    it('should resolve with an arbitrary error wrapped as a UnknownRouteError', async () => {
      const error = new Error('boom');
      const mocker = new UnexpectedExpressMocker((req, res) => {
        throw error;
      });

      const context = await mocker.mock({
        request: 'POST /foo/bar',
      });

      return expect(context, 'to satisfy', {
        metadata: {
          errorPassedToNext: expect
            .it('to be an', errors.UnknownRouteError)
            .and('to satisfy', { data: { error } }),
        },
      });
    });

    it('should resolve with an error ater headers wrapped as a SilentRouteError', async () => {
      const error = new Error('boom');
      const mocker = new UnexpectedExpressMocker((req, res) => {
        res.writeHead(200);
        throw error;
      });

      const context = await mocker.mock({
        request: 'POST /foo/bar',
      });

      return expect(context, 'to satisfy', {
        metadata: {
          errorPassedToNext: expect
            .it('to be an', errors.SilentRouteError)
            .and('to satisfy', { data: { error } }),
        },
      });
    });
  });
});
