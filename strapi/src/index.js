'use strict';

const RESEND_EMAIL_API_URL = 'https://api.resend.com/emails';
const { isSeedEnabled } = require('./seed/seed-env');

function normalizeAddress(value) {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(normalizeAddress).filter(Boolean);
  if (value.email) {
    return value.name ? `${value.name} <${value.email}>` : value.email;
  }
  return undefined;
}

module.exports = {
  register({ strapi }) {
    // Register custom services, controllers, routes here
  },
  async bootstrap({ strapi }) {
    // ─── Lifecycle Hook: Delete media from R2 when deleted in Strapi ───────
    strapi.db.lifecycles.subscribe({
      models: ['plugin::upload.file'],
      async beforeDelete(event) {
        const { data } = event;
        if (!data?.id) return;

        try {
          // Delete the file from upload provider (R2) via Strapi's upload service
          const uploadService = strapi.plugin('upload').service('upload');
          if (uploadService?.remove) {
            await uploadService.remove(data);
            strapi.log.info(`[R2] Deleted media file ${data.id} from R2`);
          }
        } catch (error) {
          strapi.log.error(`[R2] Failed to delete from R2: ${error.message}`);
          // Log error but don't block the Strapi deletion
        }
      },
    });

    try {
      const { ensureEnvAdminUser } = require('./seed/env-admin-user');
      const adminResult = await ensureEnvAdminUser(strapi);
      if (!adminResult.skipped) {
        strapi.log.info(
          `[admin-bootstrap] ${adminResult.email}: created=${Boolean(adminResult.created)}, passwordReset=${Boolean(adminResult.passwordReset)}`
        );
      }
    } catch (error) {
      strapi.log.error(`[admin-bootstrap] Failed to ensure admin from env: ${error.message}`);
    }

    if (process.env.RESEND_API_KEY) {
      const emailService = strapi.plugin('email')?.service('email');
      const originalSend = emailService?.send?.bind(emailService);

      if (emailService && originalSend) {
        emailService.send = async options => {
          const from =
            normalizeAddress(options.from) ||
            process.env.SMTP_FROM ||
            'onboarding@resend.dev';
          const to = normalizeAddress(options.to);

          if (!to) {
            throw new Error('Resend email requires a recipient.');
          }

          const response = await fetch(RESEND_EMAIL_API_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from,
              to,
              cc: normalizeAddress(options.cc),
              bcc: normalizeAddress(options.bcc),
              reply_to: normalizeAddress(
                options.replyTo || options.reply_to || process.env.SMTP_REPLY_TO
              ),
              subject: options.subject,
              html: options.html,
              text: options.text,
            }),
          });

          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(
              payload?.message ||
                payload?.error ||
                `Resend email failed with HTTP ${response.status}`
            );
          }

          return payload;
        };

        strapi.log.info('[email] Using Resend HTTPS API for transactional emails.');
      }
    }

    const publicUrl = process.env.PUBLIC_URL || strapi.config.get('server.url') || 'http://localhost:1337';
    const frontendUrl =
      process.env.FRONTEND_URL ||
      process.env.CORS_ORIGIN?.split(',')?.[0] ||
      'http://localhost:5173';
    // Keep users-permissions email templates aligned with the verified sender
    // from env so registration does not fail due to the default strapi.io domain.
    const senderEmail =
      process.env.SMTP_FROM ||
      strapi.config.get('plugin::email.settings.defaultFrom') ||
      'onboarding@resend.dev';
    const senderName = process.env.SMTP_FROM_NAME || 'Elewen';
    const replyTo =
      process.env.SMTP_REPLY_TO ||
      strapi.config.get('plugin::email.settings.defaultReplyTo') ||
      senderEmail;

    const pluginStore = strapi.store({ type: 'plugin', name: 'users-permissions' });
    const currentAdvancedSettings = await pluginStore.get({ key: 'advanced' });
    const currentGrant = await pluginStore.get({ key: 'grant' });
    const currentTemplates = await pluginStore.get({ key: 'email' });

    if (currentTemplates && typeof currentTemplates === 'object') {
      const nextTemplates = { ...currentTemplates };
      let emailTemplatesChanged = false;

      const confirmationEmailBody =
        '<p>Thank you for registering!</p>' +
        '<p>You have to confirm your email address. Please click on the link below.</p>' +
        '<p><a href="<%= URL %>?confirmation=<%= CODE %>">Confirm my email</a></p>' +
        '<p>Or copy this link: <%= URL %>?confirmation=<%= CODE %></p>' +
        '<p>Thanks.</p>';

      const resetPasswordEmailBody =
        '<p>We heard that you lost your password. Sorry about that!</p>' +
        '<p>But don’t worry! You can use the following link to reset your password:</p>' +
        '<p><a href="<%= URL %>?code=<%= TOKEN %>">Reset your password</a></p>' +
        '<p><%= URL %>?code=<%= TOKEN %></p>' +
        '<p>Thanks.</p>';

      ['email_confirmation', 'reset_password'].forEach(templateKey => {
        const template = nextTemplates[templateKey];
        if (!template || !template.options) return;

        const currentFrom = template.options.from || {};
        const currentReplyTo = template.options.response_email || '';
        const currentMessage = template.options.message || '';
        const currentObject = template.options.object || '';

        const nextOptions = {
          ...template.options,
          from: {
            ...currentFrom,
            name: senderName,
            email: senderEmail,
          },
          response_email: replyTo,
        };

        if (templateKey === 'email_confirmation') {
          nextOptions.object = 'Confirm your Elewen account';
          nextOptions.message = confirmationEmailBody;
        }

        if (templateKey === 'reset_password') {
          nextOptions.object = 'Reset your Elewen password';
          nextOptions.message = resetPasswordEmailBody;
        }

        const unchanged =
          currentFrom.email === senderEmail &&
          currentFrom.name === senderName &&
          currentReplyTo === replyTo &&
          currentMessage === nextOptions.message &&
          currentObject === nextOptions.object;

        if (unchanged) return;

        nextTemplates[templateKey] = { ...template, options: nextOptions };
        emailTemplatesChanged = true;
      });

      if (emailTemplatesChanged) {
        await pluginStore.set({ key: 'email', value: nextTemplates });
        strapi.log.info(
          `[users-permissions] Email template sender synced to verified address: ${senderEmail}`
        );
      }
    } else {
      strapi.log.warn(
        '[users-permissions] Email templates not found in plugin store; skipping sender sync.'
      );
    }

    if (currentAdvancedSettings && typeof currentAdvancedSettings === 'object') {
      const oauthRedirect = `${frontendUrl.replace(/\/$/, '')}/auth/callback`;
      // Default ON — set STRAPI_EMAIL_CONFIRMATION=false only to skip verification emails (local debug).
      const emailConfirmation = process.env.STRAPI_EMAIL_CONFIRMATION !== 'false';
      const confirmRedirectBase = `${frontendUrl.replace(/\/$/, '')}/login`;
      const nextAdvancedSettings = {
        ...currentAdvancedSettings,
        allow_register: true,
        unique_email: true,
        email_confirmation: emailConfirmation,
        email_reset_password: `${frontendUrl}/reset-password`,
        email_confirmation_redirection: `${confirmRedirectBase}?confirmed=true`,
        default_redirect_url: oauthRedirect,
      };

      await pluginStore.set({ key: 'advanced', value: nextAdvancedSettings });
      strapi.log.info(
        `[users-permissions] email_confirmation=${emailConfirmation}, reset-password URL: ${nextAdvancedSettings.email_reset_password}, post-login redirect: ${oauthRedirect}`
      );
    }

    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      // Must match Google Cloud Console + Strapi users-permissions grant URL:
      // {PUBLIC_URL}/api/connect/google/callback
      const googleCallbackUrl =
        process.env.GOOGLE_REDIRECT_URI || `${publicUrl}/api/connect/google/callback`;
      const frontendAuthCallback = `${frontendUrl.replace(/\/$/, '')}/auth/callback`;
      const baseGrant =
        currentGrant && typeof currentGrant === 'object' ? { ...currentGrant } : {};
      const previousGoogle =
        baseGrant.google && typeof baseGrant.google === 'object' ? baseGrant.google : {};

      const nextGrant = {
        ...baseGrant,
        google: {
          icon: 'google',
          ...previousGoogle,
          key: process.env.GOOGLE_CLIENT_ID,
          secret: process.env.GOOGLE_CLIENT_SECRET,
          callbackUrl: googleCallbackUrl,
          // Grant post-OAuth redirect — must be the frontend, NOT /api/connect/.../callback
          callback: frontendAuthCallback,
          scope:
            Array.isArray(previousGoogle.scope) && previousGoogle.scope.length
              ? previousGoogle.scope
              : ['email', 'profile'],
          // Always force-enable when env credentials exist (do not let a prior admin
          // "disabled" flag in DB overwrite this — causes "This provider is disabled").
          enabled: true,
        },
      };

      await pluginStore.set({ key: 'grant', value: nextGrant });
      strapi.log.info(
        `[users-permissions] Google OAuth enabled. Start: ${publicUrl}/api/connect/google → Google redirect: ${nextGrant.google.callbackUrl} → frontend: ${frontendAuthCallback}`
      );
    } else {
      strapi.log.warn(
        '[users-permissions] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing — Continue with Google will not work.'
      );
    }

    if (isSeedEnabled('SEED_CATERING_ESSENTIALS')) {
      try {
        const { seedCateringEssentials } = require('./seed/catering-essentials');
        const essentialsResult = await seedCateringEssentials(strapi);
        const essentialsCreated = essentialsResult.packages.filter(
          item => !item.skipped && !item.repaired
        ).length;
        const essentialsRepaired = essentialsResult.packages.filter(item => item.repaired).length;
        const essentialsSkipped = essentialsResult.packages.filter(item => item.skipped).length;

        strapi.log.info(
          `[seed/catering] Essentials created=${essentialsCreated}, repaired=${essentialsRepaired}, skipped=${essentialsSkipped}`
        );

        const { seedCateringAssisted } = require('./seed/catering-assisted');
        const assistedResult = await seedCateringAssisted(strapi);
        const assistedCreated = assistedResult.packages.filter(
          item => !item.skipped && !item.repaired
        ).length;
        const assistedRepaired = assistedResult.packages.filter(item => item.repaired).length;
        const assistedSkipped = assistedResult.packages.filter(item => item.skipped).length;

        strapi.log.info(
          `[seed/catering] Assisted created=${assistedCreated}, repaired=${assistedRepaired}, skipped=${assistedSkipped}, policy=${assistedResult.policyDocumentId}`
        );

        const { seedCateringEndToEnd } = require('./seed/catering-end-to-end');
        const endToEndResult = await seedCateringEndToEnd(strapi);
        const endToEndCreated = endToEndResult.packages.filter(
          item => !item.skipped && !item.repaired
        ).length;
        const endToEndRepaired = endToEndResult.packages.filter(item => item.repaired).length;
        const endToEndSkipped = endToEndResult.packages.filter(item => item.skipped).length;

        strapi.log.info(
          `[seed/catering] End-to-end created=${endToEndCreated}, repaired=${endToEndRepaired}, skipped=${endToEndSkipped}`
        );

        const { seedCateringAddons } = require('./seed/catering-addons');
        const addonsResult = await seedCateringAddons(strapi);
        const addonsCreated = addonsResult.addons.filter(item => !item.skipped).length;
        const addonsSkipped = addonsResult.addons.filter(item => item.skipped).length;
        const addonsUpdated = addonsResult.addons.filter(item => item.updated).length;

        strapi.log.info(
          `[seed/catering-addons] created=${addonsCreated}, updated=${addonsUpdated}, skipped=${addonsSkipped}`
        );

        const { seedCateringDiscountSettings } = require('./seed/catering-discount-settings');
        const discountResult = await seedCateringDiscountSettings(strapi);
        strapi.log.info(
          `[seed/catering-discounts] documentId=${discountResult.documentId}, created=${Boolean(discountResult.created)}, updated=${Boolean(discountResult.updated)}`
        );

        if (isSeedEnabled('SEED_CATERING_MENU')) {
          const { seedCateringMenuLibrary } = require('./seed/catering-menu-library');
          const menuResult = await seedCateringMenuLibrary(strapi);
          strapi.log.info(
            `[seed/catering-menu] documentId=${menuResult.documentId}, created=${Boolean(menuResult.created)}, updated=${Boolean(menuResult.updated)}`
          );
        }
      } catch (error) {
        strapi.log.error('[seed/catering] Catering seed failed:', error);
      }
    }

    if (isSeedEnabled('SEED_DELIVERY_CHARGES')) {
      try {
        const { seedDeliveryCharges } = require('./seed/delivery-charges');
        const deliveryResult = await seedDeliveryCharges(strapi);
        strapi.log.info(
          `[seed/delivery-charges] skipped=${Boolean(deliveryResult.skipped)}, created=${deliveryResult.created}, total=${deliveryResult.total}`
        );
      } catch (error) {
        strapi.log.error('[seed/delivery-charges] Delivery charge seed failed:', error);
      }
    }

    if (isSeedEnabled('SEED_DECOR_PROPOSAL_PACKAGES')) {
      try {
        const { seedDecorProposalPackages } = require('./seed/decor-proposal-packages');
        const decorResult = await seedDecorProposalPackages(strapi);
        const created = decorResult.packages.filter(
          item => !item.skipped && !item.repaired && !item.updated
        ).length;
        const repaired = decorResult.packages.filter(item => item.repaired).length;
        const updated = decorResult.packages.filter(item => item.updated).length;
        const skipped = decorResult.packages.filter(item => item.skipped).length;

        strapi.log.info(
          `[seed/decor-proposal] created=${created}, updated=${updated}, repaired=${repaired}, skipped=${skipped}, event=${decorResult.eventDocumentId ?? 'n/a'}`
        );
      } catch (error) {
        strapi.log.error('[seed/decor-proposal] Proposal decor seed failed:', error);
      }
    }

    if (isSeedEnabled('SEED_DECOR_ANNIVERSARY_PACKAGES')) {
      try {
        const { seedDecorAnniversaryPackages } = require('./seed/decor-anniversary-packages');
        const anniversaryResult = await seedDecorAnniversaryPackages(strapi);
        const created = anniversaryResult.packages.filter(
          item => !item.skipped && !item.repaired && !item.updated
        ).length;
        const repaired = anniversaryResult.packages.filter(item => item.repaired).length;
        const updated = anniversaryResult.packages.filter(item => item.updated).length;
        const skipped = anniversaryResult.packages.filter(item => item.skipped).length;

        strapi.log.info(
          `[seed/decor-anniversary] created=${created}, updated=${updated}, repaired=${repaired}, skipped=${skipped}, event=${anniversaryResult.eventDocumentId ?? 'n/a'}`
        );
      } catch (error) {
        strapi.log.error('[seed/decor-anniversary] Anniversary decor seed failed:', error);
      }
    }

    if (isSeedEnabled('SEED_INHOUSE_PLANNER')) {
      try {
        const { seedInhousePlannerContent } = require('./seed/inhouse-planner-content');
        const inhouseResult = await seedInhousePlannerContent(strapi);
        strapi.log.info(
          `[seed/inhouse-planner] page=${inhouseResult.inhousePlannerPage.documentId}, grand=${inhouseResult.grandCelebrationsIntro.documentId}, social=${inhouseResult.celebrationEveryDay.documentId}`
        );
      } catch (error) {
        strapi.log.error('[seed/inhouse-planner] In-house planner CMS seed failed:', error);
      }
    }

    if (isSeedEnabled('SEED_PRIVACY_POLICY')) {
      try {
        const { seedPrivacyPolicy } = require('./seed/privacy-policy');
        const privacyResult = await seedPrivacyPolicy(strapi);
        strapi.log.info(
          `[seed/privacy-policy] documentId=${privacyResult.documentId}, created=${Boolean(privacyResult.created)}, updated=${Boolean(privacyResult.updated)}`
        );
      } catch (error) {
        strapi.log.error('[seed/privacy-policy] Privacy policy seed failed:', error);
      }
    }

    if (isSeedEnabled('SEED_TERMS_AND_CONDITIONS')) {
      try {
        const { seedTermsAndConditions } = require('./seed/terms-and-conditions');
        const termsResult = await seedTermsAndConditions(strapi);
        strapi.log.info(
          `[seed/terms-and-conditions] documentId=${termsResult.documentId}, created=${Boolean(termsResult.created)}, updated=${Boolean(termsResult.updated)}`
        );
      } catch (error) {
        strapi.log.error('[seed/terms-and-conditions] Terms and conditions seed failed:', error);
      }
    }

    if (isSeedEnabled('SEED_EVENT_THEME_MAP')) {
      try {
        const { seedEventThemeMap } = require('./seed/event-theme-map');
        const mapResult = await seedEventThemeMap(strapi);
        if (mapResult.rolledBack) {
          strapi.log.info(
            `[seed/event-theme-map] rollback done snapshot=${mapResult.snapshotPath}`
          );
        } else {
          const updated = (mapResult.results || []).filter(item => item.updated).length;
          const skipped = (mapResult.results || []).filter(item => item.skipped).length;
          strapi.log.info(
            `[seed/event-theme-map] updated=${updated}, skipped=${skipped}, themes=${mapResult.themeCount}, snapshot=${mapResult.snapshotPath}`
          );
        }
      } catch (error) {
        strapi.log.error('[seed/event-theme-map] Event theme map seed failed:', error);
      }
    }

    if (isSeedEnabled('SEED_COUPON_TEMPLATES')) {
      try {
        const { seedCouponTemplates } = require('./seed/coupon-templates');
        const couponResults = await seedCouponTemplates(strapi);
        const created = couponResults.filter(item => item.created).length;
        const updated = couponResults.filter(item => item.updated).length;
        strapi.log.info(
          `[seed/coupon-templates] created=${created}, updated=${updated}, total=${couponResults.length}`
        );
      } catch (error) {
        strapi.log.error('[seed/coupon-templates] Coupon template seed failed:', error);
      }
    }

    if (isSeedEnabled('SEED_DECOR_BABY_SHOWER_PACKAGES')) {
      try {
        const { seedDecorBabyShowerPackages } = require('./seed/decor-baby-shower-packages');
        const babyShowerResult = await seedDecorBabyShowerPackages(strapi);
        const created = babyShowerResult.packages.filter(
          item => !item.skipped && !item.repaired && !item.updated
        ).length;
        const repaired = babyShowerResult.packages.filter(item => item.repaired).length;
        const updated = babyShowerResult.packages.filter(item => item.updated).length;
        const skipped = babyShowerResult.packages.filter(item => item.skipped).length;

        strapi.log.info(
          `[seed/decor-baby-shower] created=${created}, updated=${updated}, repaired=${repaired}, skipped=${skipped}, event=${babyShowerResult.eventDocumentId ?? 'n/a'}`
        );
      } catch (error) {
        strapi.log.error('[seed/decor-baby-shower] Baby shower decor seed failed:', error);
      }
    }

    if (isSeedEnabled('SEED_DECOR_BACHELORETTE_PACKAGES')) {
      try {
        const { seedDecorBachelorettePackages } = require('./seed/decor-bachelorette-packages');
        const bacheloretteResult = await seedDecorBachelorettePackages(strapi);
        const created = bacheloretteResult.packages.filter(
          item => !item.skipped && !item.repaired && !item.updated
        ).length;
        const repaired = bacheloretteResult.packages.filter(item => item.repaired).length;
        const updated = bacheloretteResult.packages.filter(item => item.updated).length;
        const skipped = bacheloretteResult.packages.filter(item => item.skipped).length;

        strapi.log.info(
          `[seed/decor-bachelorette] created=${created}, updated=${updated}, repaired=${repaired}, skipped=${skipped}, event=${bacheloretteResult.eventDocumentId ?? 'n/a'}`
        );
      } catch (error) {
        strapi.log.error('[seed/decor-bachelorette] Bachelorette decor seed failed:', error);
      }
    }

    if (isSeedEnabled('SEED_DECOR_EXCEL_PACKAGES')) {
      const excelSeedModules = [
        { name: 'decor-bubbles-black-tie', fn: () => require('./seed/decor-bubbles-black-tie-packages').seedDecorBubblesBlackTiePackages(strapi) },
        { name: 'decor-sufi-night', fn: () => require('./seed/decor-sufi-night-packages').seedDecorSufiNightPackages(strapi) },
        { name: 'decor-house-party-birthday', fn: () => require('./seed/decor-house-party-birthday-packages').seedDecorHousePartyBirthdayPackages(strapi) },
        { name: 'decor-pastel', fn: () => require('./seed/decor-pastel-packages').seedDecorPastelPackages(strapi) },
        { name: 'decor-bohemian', fn: () => require('./seed/decor-bohemian-packages').seedDecorBohemianPackages(strapi) },
      ];

      for (const moduleSeed of excelSeedModules) {
        try {
          const result = await moduleSeed.fn();
          const created = result.packages.filter(
            item => !item.skipped && !item.repaired && !item.updated
          ).length;
          const repaired = result.packages.filter(item => item.repaired).length;
          const updated = result.packages.filter(item => item.updated).length;
          const skipped = result.packages.filter(item => item.skipped).length;

          strapi.log.info(
            `[seed/${moduleSeed.name}] created=${created}, updated=${updated}, repaired=${repaired}, skipped=${skipped}, event=${result.eventDocumentId ?? 'n/a'}`
          );
        } catch (error) {
          strapi.log.error(`[seed/${moduleSeed.name}] Excel decor seed failed:`, error);
        }
      }
    }
  },
};
