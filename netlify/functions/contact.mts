/**
 * POST /api/contact — the contact form's endpoint.
 *
 * Bot check: Google reCAPTCHA v3 with an Enterprise checkbox challenge on a
 * low score (netlify/lib/recaptcha.ts, action "contact"). Once it passes, the
 * message is forwarded server-side to Formspree, which emails it to the pension.
 *
 * Environment: the reCAPTCHA variables (see netlify/lib/recaptcha.ts) and
 * FORMSPREE_ENDPOINT (overrides the Formspree URL in src/data/site.ts).
 *
 * Responds with JSON: `{ ok: true }` or `{ ok: false, error }`, where error is
 * 'challenge' (show the checkbox), 'captcha' (bot check failed), 'invalid' (a
 * field Formspree rejected) or 'upstream' (Formspree/Google unreachable or
 * misconfigured).
 */
import type { Config } from '@netlify/functions';
import { site } from '../../src/data/site';
import { checkRecaptcha, RecaptchaConfigError } from '../lib/recaptcha';

const FIELDS = ['name', 'email', 'message', 'language', '_subject'] as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export default async (req: Request) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, error: 'invalid' }, 400);
  }

  // Honeypot: real visitors never see this field. Pretend success so bots move on.
  if (String(form.get('_gotcha') ?? '').trim()) return json({ ok: true });

  try {
    const check = await checkRecaptcha({
      action: 'contact',
      token: String(form.get('recaptchaToken') ?? ''),
      challengeToken: String(form.get('recaptchaChallengeToken') ?? ''),
      req,
    });
    if (!check.ok) return json({ ok: false, error: check.error }, check.status);
  } catch (err) {
    console.error('reCAPTCHA verification failed', err);
    return json({ ok: false, error: 'upstream' }, err instanceof RecaptchaConfigError ? 500 : 502);
  }

  // --- Forward to Formspree ----------------------------------------------
  const body = new FormData();
  for (const key of FIELDS) {
    const value = form.get(key);
    if (typeof value === 'string') body.set(key, value);
  }

  try {
    const res = await fetch(Netlify.env.get('FORMSPREE_ENDPOINT') ?? site.formspree, {
      method: 'POST',
      body,
      headers: {
        Accept: 'application/json',
        // Formspree's "restrict to domain" setting checks the referrer.
        Referer: req.headers.get('referer') ?? 'https://pensionmylos.com/',
      },
    });
    if (res.ok) return json({ ok: true });

    const data = (await res.json().catch(() => ({}))) as { errors?: { field?: string }[] };
    console.error('Formspree rejected the submission', res.status, data);
    if (data.errors?.some((e) => e.field)) return json({ ok: false, error: 'invalid' }, 400);
    return json({ ok: false, error: 'upstream' }, 502);
  } catch (err) {
    console.error('Formspree request failed', err);
    return json({ ok: false, error: 'upstream' }, 502);
  }
};

export const config: Config = {
  path: '/api/contact',
  method: 'POST',
};
