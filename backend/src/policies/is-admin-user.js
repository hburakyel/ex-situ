'use strict';

/**
 * Allows the request only when it carries a valid Strapi admin-panel JWT for an
 * active admin user. Used on content-API routes that the admin GeoCorrection
 * extension calls (it sends the admin token via useFetchClient). Content-API
 * routes don't run the admin auth strategy, so routes using this policy keep
 * `auth: false` and rely on this check instead.
 */
module.exports = async (policyContext, config, { strapi }) => {
  const authorization = policyContext.request.header.authorization || '';
  const [scheme, token] = authorization.split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return false;

  const { payload, isValid } = strapi.admin.services.token.decodeJwtToken(token);
  if (!isValid || !payload?.id) return false;

  const user = await strapi.query('admin::user').findOne({ where: { id: payload.id } });
  return Boolean(user && user.isActive === true);
};
