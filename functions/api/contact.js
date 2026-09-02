// ===== CONTACT FORM BACKEND =====
// A Cloudflare Pages Function. Anything POSTed to /api/contact lands here, on the
// same domain as the site, so the browser never has to deal with CORS.
//
// Secrets live in the Pages dashboard (Settings > Environment variables), never in
// this file. Nothing here is sent to the browser, so the API keys stay private:
//   RESEND_API_KEY    - from resend.com, sends the email
//   TELEGRAM_TOKEN    - from @BotFather, sends the phone notification
//   TELEGRAM_CHAT_ID  - your own chat id, so the bot knows who to message
// Optional overrides: LEAD_TO (where email goes), LEAD_FROM (who it comes from).
// Optional KV namespace bound as LEADS turns on rate limiting.
//
// Either channel can be left unconfigured and the other still works.

// Longest we accept for each field. Anything past this is trimmed, not rejected,
// so a chatty visitor never loses their message to a validation error.
const MAX = { name: 100, business: 120, email: 150, phone: 40, service: 60, message: 4000 };

// Same check the browser already did, repeated here because anyone can POST
// directly to this endpoint and skip the form entirely.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = request.headers.get('CF-Connecting-IP') || '';

  // Read the body. A bot posting junk instead of JSON stops right here.
  let raw;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: 'Expected JSON.' }, 400);
  }

  // --- Spam traps, cheapest first ---

  // Honeypot: a field hidden with CSS that humans never see and bots love to fill.
  // Answer 200 so the bot thinks it worked and does not come back to probe.
  if (raw.company_website) return json({ ok: true });

  // Nobody fills in a name, an email and a message in under two seconds.
  if (typeof raw.elapsed === 'number' && raw.elapsed < 2000) return json({ ok: true });

  if (await rateLimited(env, ip)) {
    return json({ ok: false, error: 'Too many messages from this connection. Try again later.' }, 429);
  }

  // --- Validate and tidy up ---
  const d = {
    name:     clean(raw.name, MAX.name),
    business: clean(raw.business, MAX.business),
    email:    clean(raw.email, MAX.email),
    phone:    clean(raw.phone, MAX.phone),
    service:  clean(raw.service, MAX.service) || 'Not specified',
    message:  clean(raw.message, MAX.message)
  };

  if (!d.name) return json({ ok: false, error: 'Please add your name.' }, 400);
  if (!EMAIL_RE.test(d.email)) return json({ ok: false, error: 'That email address does not look right.' }, 400);

  // --- Deliver ---
  // Both go out at once, and one failing does not stop the other. Losing a lead
  // matters far more than a tidy error, so any single success counts as a success.
  const results = await Promise.allSettled([sendEmail(env, d), sendTelegram(env, d)]);
  const delivered = results.some(r => r.status === 'fulfilled' && r.value === true);

  if (!delivered) {
    // Shows up in `wrangler pages deployment tail` and the Pages dashboard logs.
    console.error('Contact form delivery failed', results.map(r => r.reason?.message || r.value));
    return json({ ok: false, error: 'Could not send right now.' }, 502);
  }
  return json({ ok: true });
}

// Anything other than a POST (someone opening /api/contact in a browser tab).
export async function onRequest() {
  return json({ ok: false, error: 'Use POST.' }, 405);
}

// ===== Helpers =====

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Force whatever arrived into a trimmed, length-capped string.
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Escape anything a visitor typed before it goes into the HTML email, so a message
// containing tags renders as text instead of becoming part of the markup.
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Five messages an hour per IP, but only if a KV namespace is bound as LEADS.
// Without one this quietly does nothing and the form still works.
async function rateLimited(env, ip) {
  if (!env.LEADS || !ip) return false;
  const key = 'rl:' + ip;
  const count = parseInt(await env.LEADS.get(key) || '0', 10);
  if (count >= 5) return true;
  // Writing again pushes the hour out, so a persistent spammer stays blocked.
  await env.LEADS.put(key, String(count + 1), { expirationTtl: 3600 });
  return false;
}

// Email via Resend. reply_to is the important bit: hitting reply in your inbox
// answers the lead directly instead of answering yourself.
async function sendEmail(env, d) {
  if (!env.RESEND_API_KEY) return false;

  const row = (label, value) => value
    ? `<tr><td style="padding:6px 16px 6px 0;color:#888;font:600 12px/1.4 system-ui;letter-spacing:.08em;text-transform:uppercase;vertical-align:top">${label}</td><td style="padding:6px 0;color:#111;font:400 15px/1.5 system-ui">${esc(value)}</td></tr>`
    : '';

  const html = `<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:system-ui,sans-serif">
    <p style="margin:0 0 4px;font:600 12px/1 system-ui;letter-spacing:.2em;text-transform:uppercase;color:#1f6feb">Aperio Digital</p>
    <h1 style="margin:0 0 24px;font-size:22px;color:#111">New enquiry from the website</h1>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee">
      ${row('Name', d.name)}${row('Business', d.business)}${row('Email', d.email)}${row('Phone', d.phone)}${row('Interested in', d.service)}
    </table>
    ${d.message ? `<p style="margin:24px 0 6px;font:600 12px/1 system-ui;letter-spacing:.08em;text-transform:uppercase;color:#888">Message</p>
    <div style="padding:16px;background:#f6f8fa;border-radius:6px;color:#111;font:400 15px/1.6 system-ui;white-space:pre-wrap">${esc(d.message)}</div>` : ''}
    <p style="margin:28px 0 0;color:#888;font-size:13px">Reply to this email to answer ${esc(d.name)} directly.</p>
  </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.LEAD_FROM || 'Aperio Digital <onboarding@resend.dev>',
      to: env.LEAD_TO || 'amadeospapa@gmail.com',
      reply_to: d.email,
      subject: `New lead — ${d.business || d.name} (${d.service})`,
      html
    })
  });
  if (!res.ok) throw new Error('Resend ' + res.status + ' ' + await res.text());
  return true;
}

// Telegram push. Sent as plain text on purpose: with no parse_mode set, a message
// full of underscores or asterisks cannot break the formatting or the send.
async function sendTelegram(env, d) {
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) return false;

  const text = [
    'New lead — aperiodigital.co',
    '',
    'Name: ' + d.name,
    d.business ? 'Business: ' + d.business : '',
    'Email: ' + d.email,
    d.phone ? 'Phone: ' + d.phone : '',
    'Interested in: ' + d.service,
    d.message ? '\n' + d.message : ''
  ].filter(Boolean).join('\n');

  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true })
  });
  if (!res.ok) throw new Error('Telegram ' + res.status + ' ' + await res.text());
  return true;
}
