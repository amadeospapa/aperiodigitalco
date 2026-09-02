# Contact form backend

The form at the bottom of `index.html` POSTs to `/api/contact`, handled by
`functions/api/contact.js`. That function emails the lead to you and pushes it to
Telegram. If it cannot be reached, the form falls back to opening the visitor's
email app, which is what the site did before.

Cloudflare Pages picks up the `functions/` directory automatically. There is no
build step and nothing to install — just deploy as usual.

## 1. Email (Resend)

1. Sign up at [resend.com](https://resend.com) with amadeospapa@gmail.com.
2. **API Keys → Create**, copy the `re_...` key.
3. That is enough to start: the default sender `onboarding@resend.dev` works
   immediately, but only delivers to the address that owns the Resend account.
4. To send from your own domain, add `aperiodigital.co` under **Domains**, add the
   DNS records it gives you, then set `LEAD_FROM` to something like
   `Aperio Digital <leads@aperiodigital.co>`.

Free tier is 3,000 emails/month, far past what a contact form needs.

## 2. Telegram push

1. In Telegram, message [@BotFather](https://t.me/botfather) → `/newbot`, name it
   whatever you like. He replies with a token like `1234567890:AA...`.
2. Send your new bot any message (it cannot message you first — Telegram blocks
   bots from opening a conversation).
3. Open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and copy
   the number at `result[0].message.chat.id`. That is your `TELEGRAM_CHAT_ID`.

## 3. Add the secrets to Cloudflare

Pages project → **Settings → Environment variables → Production**. Add each as an
**encrypted** variable, then redeploy so the running function picks them up:

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

Create a KV namespace and bind it to the Pages project as `LEADS`. The function
then caps each IP at 5 messages per hour. Without the binding it skips the check.

## Testing

```bash
# Local, with .dev.vars filled in
npx wrangler pages dev .

# Hit the endpoint directly
curl -X POST http://localhost:8788/api/contact \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","email":"test@example.com","message":"Hello","elapsed":9999}'

# Watch production logs
npx wrangler pages deployment tail
```

`elapsed` is how long the visitor had the page open. Anything under 2 seconds is
treated as a bot, so include a realistic value when testing by hand.

## Spam handling

Three layers, cheapest first: a honeypot field hidden off-screen that only bots
fill in, a minimum two-second fill time, and the optional KV rate limit. Bot
submissions get a `200 OK` rather than an error, so scripts do not learn to adapt.
If spam ever gets through, the next step is [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/).
