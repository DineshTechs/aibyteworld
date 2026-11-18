import { apiFetch } from '../utils/apiFetch.js';

// Transactional email through Brevo or Resend (both have free plans).
// The sender address must be verified with the provider first.
export const EMAIL_PROVIDERS = {
  brevo: { name: 'Brevo', signup: 'https://app.brevo.com/settings/keys/api', delayMs: 120 },
  resend: { name: 'Resend', signup: 'https://resend.com/api-keys', delayMs: 550 },
};

export async function sendEmail(provider, apiKey, { from, to, subject, html, text, headers = {}, replyTo }) {
  if (provider === 'brevo') {
    const { data } = await apiFetch('Brevo', 'https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey },
      body: { sender: { email: from.email, name: from.name || undefined }, to: [{ email: to }], subject, htmlContent: html, textContent: text, headers, ...(replyTo ? { replyTo: { email: replyTo } } : {}) },
    });
    return data?.messageId || '';
  }
  if (provider === 'resend') {
    const { data } = await apiFetch('Resend', 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: { from: from.name ? `${from.name.replace(/[<>"]/g, '')} <${from.email}>` : from.email, to: [to], subject, html, text, headers, ...(replyTo ? { reply_to: replyTo } : {}) },
    });
    return data?.id || '';
  }
  throw new Error('Choose an email provider first.');
}
