const messy = require('messy');

const resolveExpectedResponseProperties = require('./resolveExpectedResponseProperties');
const UnexpectedExpressMocker = require('./UnexpectedExpressMocker');

module.exports = {
  name: 'unexpected-express',
  version: require('../package.json').version,
  installInto(expect) {
    expect = expect.child();

    const topLevelExpect = expect;

    expect.use(require('unexpected-messy'));

    expect.addType({
      name: 'IncomingMessage',
      base: 'object',
      identify(obj) {
        return (
          obj && obj.constructor && obj.constructor.name === 'IncomingMessage'
        );
      },
      inspect(obj, depth, output) {
        output.text(obj.constructor.name, 'jsFunctionName');
      }
    });

    expect.exportAssertion(
      [
        '<function> to yield exchange satisfying <any>', // Please prefer this one because it does use 'to satisfy' semantics
        '<function> to yield exchange <any>'
      ],
      (expect, subject, value) => {
        if (!subject.handle || !subject.set) {
          expect.subjectOutput = function() {
            this.text('express middleware');
          };
        } else {
          expect.subjectOutput = function() {
            this.text('express app');
          };
        }

        const missingProperties = Object.keys(value).filter(
          key => key !== 'request' && key !== 'response'
        );
        if (missingProperties.length > 0) {
          throw new Error(`Property "${missingProperties[0]}" does not exist`);
        }

        const {
          expectedResponseProperties,
          expectedMetadata
        } = resolveExpectedResponseProperties(value);

        const mocker = new UnexpectedExpressMocker(subject);

        const options = {
          ...value,
          expectedErrorPassedToNext: expectedMetadata.errorPassedToNext
        };
        return mocker.mock(options).then(context => {
          const { errorPassedToNext } = context.metadata;

          // rethrow error that was passed to next() and captured as handled
          if (
            errorPassedToNext &&
            errorPassedToNext.UnexpectedExpressError &&
            ['UnknownRouteError', 'SilentRouteError'].includes(
              errorPassedToNext.name
            )
          ) {
            throw errorPassedToNext.data.error; // original error
          }

          const promiseByKey = {
            httpExchange: expect.promise(() =>
              expect(context.httpExchange, 'to satisfy', {
                response: expectedResponseProperties
              })
            ),
            metadata: {}
          };
          Object.keys(expectedMetadata).forEach(key => {
            promiseByKey.metadata[key] = expect.promise(() =>
              topLevelExpect(
                context.metadata[key],
                'to satisfy',
                expectedMetadata[key]
              )
            );
          });

          return expect.promise.settle(promiseByKey).then(promises => {
            if (promises.some(promise => promise.isRejected())) {
              expect.fail({
                diff(output) {
                  if (promiseByKey.httpExchange.isRejected()) {
                    output.append(
                      promiseByKey.httpExchange.reason().getDiff(output)
                    );
                  } else {
                    output.appendInspected(context.httpExchange);
                  }
                  Object.keys(promiseByKey.metadata).forEach(key => {
                    if (promiseByKey.metadata[key].isRejected()) {
                      output.nl().annotationBlock(function() {
                        this.text(key)
                          .text(':')
                          .sp()
                          .append(
                            promiseByKey.metadata[key]
                              .reason()
                              .getErrorMessage(output)
                          );
                      });
                    }
                  });
                  return output;
                }
              });
            }

            return context;
          });
        });
      }
    );
  }
};

module.exports.messy = messy;
