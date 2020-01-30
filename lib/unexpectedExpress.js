const messy = require('messy');

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
          // This check is from the lib/application file in express @ 4.10.2.
          // If we get inside here, we have something that is not an express app
          // https://github.com/strongloop/express/blob/661435256384165bb656cb7b6046b4138ca24c9e/lib/application.js#L186
          subject = require('express')().use(subject);
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

        const mocker = new UnexpectedExpressMocker(value, topLevelExpect);

        return mocker.mock(subject).then(context => {
          const { expectedResponseProperties, expectedMetadata } = mocker;

          return (function() {
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
          })();
        });
      }
    );
  }
};

module.exports.messy = messy;
