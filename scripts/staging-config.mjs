import { createHmac } from 'node:crypto';
export function stagingConfig(env) {
  const secret = env.STAGING_ROLE_SECRET;
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 256)
    throw new Error('Missing staging secret');
  const host = env.STAGING_DATABASE_HOST,
    name = env.STAGING_DATABASE_NAME;
  if (
    typeof host !== 'string' ||
    !/^[a-z0-9-]+$/.test(host) ||
    typeof name !== 'string' ||
    !/^[a-z][a-z0-9_]{0,62}$/.test(name)
  )
    throw new Error('Invalid private staging database location');
  const derive = (label) =>
    createHmac('sha256', secret)
      .update('finanzas-p10:' + label)
      .digest();
  const roles = [
    ['finanzas_staging_api', 'finanzas_runtime'],
    ['finanzas_staging_auth', 'finanzas_auth_runtime'],
  ].map(([role, group]) => ({ role, group, password: derive(role).toString('hex') }));
  const urls = roles.map(
    ({ role, password }) => `postgresql://${role}:${password}@${host}:5432/${name}`,
  );
  return {
    roles,
    runtime: {
      DATABASE_URL: urls[0],
      AUTH_DATABASE_URL: urls[1],
      AUTH_MAIL_KEY: derive('auth-mail').toString('base64'),
      MFA_ENCRYPTION_KEY: derive('mfa').toString('base64'),
    },
  };
}
