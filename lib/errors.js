const createError = require('createerror');

// base error
const UnexpectedExpressError = createError({ name: 'UnexpectedExpressError' });
// marker errors
const ExplicitRouteError = createError(
  { name: 'ExplicitRouteError' },
  UnexpectedExpressError
);
const SilentRouteError = createError(
  { name: 'SilentRouteError' },
  UnexpectedExpressError
);
const UnknownRouteError = createError(
  { name: 'UnknownRouteError' },
  UnexpectedExpressError
);

exports.UnexpectedExpressError = UnexpectedExpressError;
exports.ExplicitRouteError = ExplicitRouteError;
exports.SilentRouteError = SilentRouteError;
exports.UnknownRouteError = UnknownRouteError;
