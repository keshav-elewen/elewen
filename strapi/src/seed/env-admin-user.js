'use strict';

/**
 * Ensure a Strapi admin (Super Admin) exists for STRAPI_ADMIN_EMAIL / STRAPI_ADMIN_PASSWORD.
 * - Missing → created as an active Super Admin.
 * - Exists with a different password → password reset to the env value.
 * Skipped when either variable is empty, so production is unaffected unless both are set.
 */
async function ensureEnvAdminUser(strapi) {
  const email = String(process.env.STRAPI_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.STRAPI_ADMIN_PASSWORD || '');
  if (!email || !password) return { skipped: true };

  const userService = strapi.service('admin::user');
  const authService = strapi.service('admin::auth');
  const existing = await userService.findOneByEmail(email);

  if (!existing) {
    const superAdminRole = await strapi.service('admin::role').getSuperAdmin();
    if (!superAdminRole) {
      throw new Error('Super Admin role not found');
    }
    await userService.create({
      email,
      password,
      firstname: process.env.STRAPI_ADMIN_FIRSTNAME || 'Admin',
      lastname: process.env.STRAPI_ADMIN_LASTNAME || '',
      isActive: true,
      registrationToken: null,
      roles: [superAdminRole.id],
    });
    return { email, created: true };
  }

  const passwordMatches =
    existing.password && (await authService.validatePassword(password, existing.password));
  if (!passwordMatches) {
    await userService.resetPasswordByEmail(existing.email, password);
    return { email, passwordReset: true };
  }

  return { email, unchanged: true };
}

module.exports = { ensureEnvAdminUser };
