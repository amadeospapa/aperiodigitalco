// Checks the contact-form credentials in .dev.vars by actually using them.
// Run:  node verify-setup.mjs          (tests both, sends nothing)
//       node verify-setup.mjs --send   (also sends a real test email + push)
//
// Keys are only ever printed masked, so this is safe to run with someone watching.

import { readFileSync, writeFileSync } from 'node:fs';

const send = process.argv.includes('--send');
let env = {};
try {
  env = Object.fromEntries(readFileSync('.dev.vars', 'utf8').split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
} catch {
  console.error('No .dev.vars file found. Copy .dev.vars.example to .dev.vars and fill it in.');
  process.exit(1);
}

// --chat-id : look up the chat id from the bot's recent messages and write it in.
if (process.argv.includes('--chat-id')) {
  const tok = env.TELEGRAM_TOKEN;
  if (!tok || /^1234567890:AA/.test(tok)) {
    console.error('\nPut your real TELEGRAM_TOKEN in .dev.vars first, then run this again.\n');
    process.exit(1);
  }
  const r = await fetch(`https://api.telegram.org/bot${tok}/getUpdates`).then(r => r.json());
  if (!r.ok) { console.error('\nTelegram rejected the token: ' + r.description + '\n'); process.exit(1); }

  const chats = [...new Map(r.result
    .map(u => u.message || u.edited_message || u.channel_post).filter(Boolean)
    .map(m => [m.chat.id, m.chat])).values()];

  if (!chats.length) {
    console.error('\nNo messages yet. Open the bot in Telegram, press START, then run this again.\n');
    process.exit(1);
  }
  const c = chats[0];
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.title || c.username;
  console.log(`\nFound chat: ${name} (id ${c.id})`);
  if (chats.length > 1) console.log('Other chats seen: ' + chats.slice(1).map(x => x.id).join(', '));

  const updated = readFileSync('.dev.vars', 'utf8').replace(/^TELEGRAM_CHAT_ID=.*$/m, 'TELEGRAM_CHAT_ID=' + c.id);
  writeFileSync('.dev.vars', updated);
  console.log('Written to .dev.vars. Now run:  node verify-setup.mjs --send\n');
  process.exit(0);
}

const mask = v => !v ? '(not set)' : v.length < 10 ? '***' : v.slice(0, 4) + '…' + v.slice(-4);
const PLACEHOLDER = /^(re_xxx|1234567890:AA|123456789$)/;
const ok = s => '  \x1b[32mOK\x1b[0m   ' + s;
const bad = s => '  \x1b[31mFAIL\x1b[0m ' + s;
let failures = 0;

console.log('\nReading .dev.vars:');
for (const k of ['RESEND_API_KEY', 'TELEGRAM_TOKEN', 'TELEGRAM_CHAT_ID'])
  console.log(`  ${k.padEnd(17)} ${mask(env[k])}`);

// ---- Telegram ----
console.log('\nTelegram:');
if (!env.TELEGRAM_TOKEN || PLACEHOLDER.test(env.TELEGRAM_TOKEN)) {
  console.log(bad('token still the placeholder — get one from @BotFather')); failures++;
} else {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/getMe`).then(r => r.json()).catch(e => ({ error: e.message }));
  if (r.ok) {
    console.log(ok(`token valid — bot is @${r.result.username}`));
    if (!env.TELEGRAM_CHAT_ID || PLACEHOLDER.test(env.TELEGRAM_CHAT_ID)) {
      console.log(bad('chat id still the placeholder')); failures++;
    } else if (send) {
      const s = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: 'Aperio Digital — contact form test. If you can read this, push notifications work.' })
      }).then(r => r.json());
      s.ok ? console.log(ok('test push sent — check your phone'))
           : (console.log(bad('chat id rejected: ' + s.description)), failures++);
    } else console.log('  ..   chat id looks set; re-run with --send to actually push');
  } else { console.log(bad('token rejected: ' + (r.description || r.error))); failures++; }
}

// ---- Resend ----
console.log('\nResend:');
if (!env.RESEND_API_KEY || PLACEHOLDER.test(env.RESEND_API_KEY)) {
  console.log(bad('API key still the placeholder — get one from resend.com')); failures++;
} else {
  // A sending-only key is the RIGHT kind for this job, but it cannot read /domains.
  // Treat that specific refusal as a pass, not a failure.
  const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY } });
  const body = await r.json().catch(() => ({}));
  const restricted = r.status === 401 && body.name === 'restricted_api_key';
  if (r.ok || restricted) {
    console.log(ok('API key valid' + (restricted ? ' (sending-only — the safer kind)' : '')));
    const verified = r.ok ? (body.data || []).filter(x => x.status === 'verified').map(x => x.name) : [];
    if (restricted) console.log('  ..   cannot list domains with a sending-only key; that is expected');
    else console.log(verified.length ? ok('verified domain(s): ' + verified.join(', '))
      : '  ..   no verified domain yet — sending from onboarding@resend.dev,\n         which only delivers to the address that owns the Resend account');
    if (send) {
      const to = env.LEAD_TO || 'amadeospapa@gmail.com';
      const s = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.LEAD_FROM || 'Aperio Digital <onboarding@resend.dev>', to,
          subject: 'Aperio Digital — contact form test',
          html: '<p>If you can read this, the contact form can reach your inbox.</p>' })
      });
      s.ok ? console.log(ok('test email sent to ' + to))
           : (console.log(bad('send rejected: ' + await s.text())), failures++);
    } else console.log('  ..   re-run with --send to actually email yourself');
  } else { console.log(bad('API key rejected (HTTP ' + r.status + '): ' + (body.message || ''))); failures++; }
}

console.log(failures ? `\n${failures} thing(s) still to fix.\n` : '\nAll good. Paste the same values into Cloudflare Pages and redeploy.\n');
process.exit(failures ? 1 : 0);
