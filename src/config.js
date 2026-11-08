'use strict';
const path = require('node:path');

const env = process.env;
const trimSlash = (s) => String(s || '').trim().replace(/\/+$/, '');

module.exports = {
  PORT: Number(env.PORT || 3000),
  DATA_DIR: env.DATA_DIR || path.join(__dirname, '..', 'data'),

  STOCK_API_URL: trimSlash(env.STOCK_API_URL),
  STOCK_API_KEY: env.STOCK_API_KEY || '',
  RESEND_API_KEY: env.RESEND_API_KEY || '',
  RESEND_BASE_URL: trimSlash(env.RESEND_BASE_URL || 'https://api.resend.com'),
  WEBHOOK_SECRET: env.WEBHOOK_SECRET || '',
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || '',

  // Optional branding / tuning. Everything works without these.
  STORE_NAME: env.STORE_NAME || 'The Goods Co.',
  STORE_URL: trimSlash(env.STORE_URL || 'https://example.com'),
  EMAIL_FROM: env.EMAIL_FROM || 'The Goods Co. <onboarding@resend.dev>',
  POLL_SECONDS: Number(env.POLL_SECONDS || 60),
  MAX_SEND_ATTEMPTS: Number(env.MAX_SEND_ATTEMPTS || 8),
};
