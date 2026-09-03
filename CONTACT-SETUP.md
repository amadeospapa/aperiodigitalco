# Contact form backend

The form at the bottom of `public/index.html` POSTs to `/api/contact`. The Worker
entry `src/index.js` routes that one path to `src/contact.js`, which emails the lead
to you and pushes it to Telegram; everything else falls through to the static site in
`public/`. If the endpoint cannot be reached, the form falls back to opening the
visitor's email app.

The site is a **Worker** (`aperiodigitalco`), not Cloudflare Pages. Workers Builds is
connected to the GitHub repo, so a push to `main` is a deploy. Config lives in
`wrangler.jsonc`; there is no build step.

## 1. Email (Resend)

1. Sign up at [resend.com](https://resend.com) with amadeospapa@gmail.com.
2. **API Keys → Create**, copy the `re_...` key.
3. That is enough to start: the default sender `onboarding@resend.dev` works
   immediately, but only delivers to the address that owns the Resend account.
4. To send from your own domain, add `aperiodigitalco.com` under **Domains**, add the
   DNS records it gives you, then set `LEAD_FROM` to something like
   `Aperio Digital <leads@aperiodigitalco.com>`.

Free tier is 3,000 emails/month, far past what a contact form needs.

## 2. Telegram push

1. In Telegram, message [@BotFather](https://t.me/botfather) → `/newbot`, name it
   whatever you like. He replies with a token like `1234567890:AA...`.
2. Send your new bot any message (it cannot message you first — Telegram blocks
   bots from opening a conversation).
3. Open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and copy
   the number at `result[0].message.chat.id`. That is your `TELEGRAM_CHAT_ID`.

## 3. Add the secrets to Cloudflare

Set these as Worker secrets from the project directory:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TELEGRAM_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

The name goes on the command line; the value goes in at the prompt. Putting the value
in the name position stores your key in plaintext, since only values are encrypted.

In the dashboard the same page is Worker → **Settings → Variables and Secrets**. Note
this is the *Worker's* settings, not a Pages project:

| Variable | Required | Notes |
|---|---|---|
| `RESEND_API_KEY` | for email | from step 1 |
| `TELEGRAM_TOKEN` | for push | from step 2 |
| `TELEGRAM_CHAT_ID` | for push | from step 2 |
| `LEAD_TO` | no | defaults to amadeospapa@gmail.com |
| `LEAD_FROM` | no | defaults to Resend's test sender |

Either channel can be left out and the other still works. With neither set, the
form returns an error and falls back to mailto.

## 4. Optional: rate limiting

Create a KV namespace and bind it as `LEADS` in `wrangler.jsonc`. The handler
then caps each IP at 5 messages per hour. Without the binding it skips the check.

## Testing

```bash
# Local, with .dev.vars filled in
npx wrangler dev

# Hit the endpoint directly
curl -X POST http://localhost:8787/api/contact \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","email":"test@example.com","message":"Hello","elapsed":9999}'

# Watch production logs
npx wrangler tail
```

`elapsed` is how long the visitor had the page open. Anything under 2 seconds is
treated as a bot, so include a realistic value when testing by hand.

## Spam handling

Three layers, cheapest first: a honeypot field hidden off-screen that only bots
fill in, a minimum two-second fill time, and the optional KV rate limit. Bot
submissions get a `200 OK` rather than an error, so scripts do not learn to adapt.
If spam ever gets through, the next step is [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/).
