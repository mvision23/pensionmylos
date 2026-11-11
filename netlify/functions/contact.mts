/**
 * POST /api/contact — the contact form's endpoint.
 *
 * Bot check (Google reCAPTCHA / Cloud Fraud Defense), in two steps:
 *  1. Invisible reCAPTCHA v3: every submission carries a v3 token
 *     (`recaptchaToken`), checked with the v3 secret key. A good score is enough.
 *  2. Challenge on low score: if the score is below the threshold and the
 *     Enterprise API key is configured, we answer `{ error: 'challenge' }`. The
 *     page then loads reCAPTCHA Enterprise, shows its "I'm not a robot"
 *     checkbox (with an image test when Google is unsure) and resends the form
 *     with that token (`recaptchaChallengeToken`). We verify it by creating an
 *     assessment in the Google Cloud project. Without the API key, low scores
 *     are simply rejected.
 *
 * Once the check passes, the message is forwarded server-side to Formspree,
 * which emails it to the pension.
 *
 * Environment variables (set in Netlify, never in the repo):
 *   RECAPTCHA_SECRET_KEY            v3 secret key (required)
 *   RECAPTCHA_ENTERPRISE_API_KEY    Google Cloud API key allowed to call the
 *                                   reCAPTCHA Enterprise API (enables the challenge)
 *   RECAPTCHA_ENTERPRISE_PROJECT    Google Cloud project ID, default 'pension-mylos'
 *   RECAPTCHA_MIN_SCORE             v3 threshold, default 0.5
 *   FORMSPREE_ENDPOINT              overrides the Formspree URL in src/data/site.ts
 *
 * Responds with JSON: `{ ok: true }` or `{ ok: false, error }`, where error is
 * 'challenge' (show the checkbox), 'captcha' (bot check failed), 'invalid' (a
 * field Formspree rejected) or 'upstream' (Formspree/Google unreachable or
 * misconfigured).
 */
import type { Config } from '@netlify/functions';
import { site } from '../../src/data/site';

const ACTION = 'contact';
const DEFAULT_MIN_SCORE = 0.5;
const FIELDS = ['name', 'email', 'message', 'language', '_subject'] as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

type SiteVerify = {
  success: boolean;
  score?: number;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
};

/** Asks Google about a token. Throws if Google can't be reached. */
async function verify(secret: string, token: string, ip: string | null): Promise<SiteVerify> {
  const params = new URLSearchParams({ secret, response: token });
  if (ip) params.set('remoteip', ip);
  const res = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body: params });
  return (await res.json()) as SiteVerify;
}

type Assessment = {
  tokenProperties?: { valid?: boolean; invalidReason?: string; action?: string; hostname?: string };
  riskAnalysis?: { score?: number; reasons?: string[] };
  error?: { code?: number; message?: string };
};

/**
 * Checks an Enterprise checkbox token by creating an assessment (REST version
 * of the @google-cloud/recaptcha-enterprise `createAssessment` sample).
 * Returns true when the token is valid for our action. Throws if Google can't
 * be reached or the request itself is refused (bad API key, wrong project…).
 */
async function assessChallenge(apiKey: string, token: string, req: Request, ip: string | null): Promise<boolean> {
  const project = Netlify.env.get('RECAPTCHA_ENTERPRISE_PROJECT') ?? 'pension-mylos';
  const url = `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(project)}/assessments?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: {
        token,
        siteKey: site.recaptchaChallengeSiteKey,
        expectedAction: ACTION,
        userAgent: req.headers.get('user-agent') ?? undefined,
        userIpAddress: ip ?? undefined,
      },
    }),
  });
  const a = (await res.json().catch(() => ({}))) as Assessment;
  if (!res.ok) throw new Error(`createAssessment failed (${res.status}): ${a.error?.message ?? 'no details'}`);

  const t = a.tokenProperties ?? {};
  if (t.valid && t.action === ACTION) return true;
  console.warn('reCAPTCHA challenge rejected', {
    valid: t.valid,
    invalidReason: t.invalidReason,
    action: t.action,
    hostname: t.hostname,
    score: a.riskAnalysis?.score,
    reasons: a.riskAnalysis?.reasons,
  });
  return false;
}

const logRejection = (kind: string, v: SiteVerify) =>
  console.warn(`reCAPTCHA ${kind} rejected`, {
    success: v.success,
    score: v.score,
    action: v.action,
    hostname: v.hostname,
    errors: v['error-codes'],
  });

/** Runs the two-step bot check. Returns null when the visitor passes, else the response to send. */
async function botCheck(form: FormData, req: Request, ip: string | null): Promise<Response | null> {
  const v3Secret = Netlify.env.get('RECAPTCHA_SECRET_KEY');
  const enterpriseKey = Netlify.env.get('RECAPTCHA_ENTERPRISE_API_KEY');
  if (!v3Secret) {
    console.error('RECAPTCHA_SECRET_KEY is not set');
    return json({ ok: false, error: 'upstream' }, 500);
  }

  // Step 2: the visitor has answered the checkbox challenge.
  const challengeToken = String(form.get('recaptchaChallengeToken') ?? '');
  if (challengeToken) {
    if (!enterpriseKey) return json({ ok: false, error: 'captcha' }, 400);
    if (await assessChallenge(enterpriseKey, challengeToken, req, ip)) return null;
    // Usually an expired checkbox: let the page ask again.
    return json({ ok: false, error: 'challenge' }, 403);
  }

  // Step 1: invisible v3 score.
  const token = String(form.get('recaptchaToken') ?? '');
  if (!token) return json({ ok: false, error: 'captcha' }, 400);
  const v = await verify(v3Secret, token, ip);
  if (!v.success || v.action !== ACTION) {
    logRejection('v3', v);
    return json({ ok: false, error: 'captcha' }, 403);
  }
  const minScore = Number(Netlify.env.get('RECAPTCHA_MIN_SCORE') ?? DEFAULT_MIN_SCORE);
  if ((v.score ?? 0) >= minScore) return null;

  logRejection('v3 low score', v);
  return json({ ok: false, error: enterpriseKey ? 'challenge' : 'captcha' }, 403);
}

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
    const rejected = await botCheck(form, req, req.headers.get('x-nf-client-connection-ip'));
    if (rejected) return rejected;
  } catch (err) {
    console.error('reCAPTCHA verification request failed', err);
    return json({ ok: false, error: 'upstream' }, 502);
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
