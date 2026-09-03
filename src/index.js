// ===== WORKER ENTRY =====
// Every request to aperiodigitalco.com arrives here first.
//
// Only one path is dynamic: POST /api/contact, which hands off to the contact
// form backend. Everything else falls through to the static site in public/,
// served by the ASSETS binding declared in wrangler.jsonc.

import { handleContact } from './contact.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/contact') {
      // A browser opening the URL directly gets a plain answer rather than a crash.
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ ok: false, error: 'Use POST.' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json', Allow: 'POST' }
        });
      }
      return handleContact(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
