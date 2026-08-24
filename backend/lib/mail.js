/* Outgoing mail. Configured entirely through the environment:
 *
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
 *
 * With none of that set, mail is disabled: nothing is sent, the verification
 * link is logged to the server console instead, and (outside production) it is
 * handed back to the caller so local sign-up still works end to end.
 */
const nodemailer = require('nodemailer');
const { UNVERIFIED_TTL_HOURS } = require('./limits');

const HOST = process.env.SMTP_HOST || '';
const PORT = Number(process.env.SMTP_PORT || 587);
const USER = process.env.SMTP_USER || '';
const PASS = process.env.SMTP_PASS || '';
const FROM = process.env.MAIL_FROM || (USER ? `Robo Kyle <${USER}>` : '');
const SITE_URL = (process.env.SITE_URL || 'https://robokyle.org').replace(/\/$/, '');

const enabled = !!(HOST && USER && PASS);
const exposeLink = process.env.NODE_ENV !== 'production';

const transport = enabled ? nodemailer.createTransport({
  host: HOST,
  port: PORT,
  secure: PORT === 465,          // 587 upgrades with STARTTLS instead
  auth: { user: USER, pass: PASS },
}) : null;

const verifyUrl = (token) => `${SITE_URL}/verify?token=${encodeURIComponent(token)}`;

function verificationBody(username, url) {
  const text = [
    `Hi ${username},`,
    '',
    'Confirm this address to finish setting up your Robo Kyle account:',
    url,
    '',
    `The link is good for ${UNVERIFIED_TTL_HOURS} hours. After that the account is removed and you can sign up again.`,
    'If you did not sign up, ignore this email.',
  ].join('\n');

  const html = `<p>Hi ${username},</p>
<p>Confirm this address to finish setting up your Robo Kyle account:</p>
<p><a href="${url}">Confirm my email</a></p>
<p style="color:#666">The link is good for ${UNVERIFIED_TTL_HOURS} hours. After that the account is removed and you can sign up again.
If you did not sign up, ignore this email.</p>`;

  return { text, html };
}

/* Resolves with { sent, link }. `link` is only populated when it is safe to show
 * the caller: either mail is off and this is not production, or sending failed. */
async function sendVerification(user, token) {
  const url = verifyUrl(token);

  if (!enabled) {
    console.log(`[mail] disabled, verification link for ${user.email}: ${url}`);
    return { sent: false, link: exposeLink ? url : null };
  }

  const body = verificationBody(user.username, url);
  try {
    await transport.sendMail({
      from: FROM,
      to: user.email,
      subject: 'Confirm your email for Robo Kyle',
      text: body.text,
      html: body.html,
    });
    return { sent: true, link: null };
  } catch (err) {
    console.error(`[mail] could not send to ${user.email}: ${err.message}`);
    return { sent: false, link: exposeLink ? url : null };
  }
}

module.exports = { enabled, sendVerification, verifyUrl, SITE_URL };
