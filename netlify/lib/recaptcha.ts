/**
 * Google reCAPTCHA (Cloud Fraud Defense) verification shared by the contact
 * form (netlify/functions/contact.mts) and the booking checkout
 * (netlify/functions/booking-checkout.mts).
 *
 * Two steps:
 *  1. Invisible reCAPTCHA v3: the page sends a v3 token for an `action`
 *     ("contact" / "booking"), checked with the v3 secret key. A good score
 *     passes.
 *  2. Challenge on a low score: if RECAPTCHA_ENTERPRISE_API_KEY is set we
 *     answer `challenge`; the page shows the Enterprise "I'm not a robot"
 *     checkbox and resends with its token, which we verify by creating an
 *     assessment in the Google Cloud project. Without the API key, low
 *     scores are simply rejected.
 *
 * Environment: RECAPTCHA_SECRET_KEY (required), RECAPTCHA_ENTERPRISE_API_KEY,
 * RECAPTCHA_ENTERPRISE_PROJECT (default 'pension-mylos'), RECAPTCHA_MIN_SCORE
 * (default 0.5).
 */
import { site } from '../../src/data/site';

const DEFAULT_MIN_SCORE = 0.5;

/** Misconfiguration (missing secret): the caller should answer 500. */
export class RecaptchaConfigError extends Error {}

export type RecaptchaOutcome = { ok: true } | { ok: false; error: 'captcha' | 'challenge'; status: number };

type SiteVerify = { success: boolean; score?: number; action?: string; hostname?: string; 'error-codes'?: string[] };
type Assessment = {
  tokenProperties?: { valid?: boolean; invalidReason?: string; action?: string; hostname?: string };
  riskAnalysis?: { score?: number; reasons?: string[] };
  error?: { code?: number; message?: string };
};

async function verifyV3(secret: string, token: string, ip: string | null): Promise<SiteVerify> {
  const params = new URLSearchParams({ secret, response: token });
  if (ip) params.set('remoteip', ip);
  const res = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body: params });
  return (await res.json()) as SiteVerify;
}

/** Checks an Enterprise checkbox token (REST version of the createAssessment sample). Throws if Google refuses the request. */
async function assessChallenge(apiKey: string, token: string, action: string, req: Request, ip: string | null): Promise<boolean> {
  const project = Netlify.env.get('RECAPTCHA_ENTERPRISE_PROJECT') ?? 'pension-mylos';
  const url = `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(project)}/assessments?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: {
        token,
        siteKey: site.recaptchaChallengeSiteKey,
        expectedAction: action,
        userAgent: req.headers.get('user-agent') ?? undefined,
        userIpAddress: ip ?? undefined,
      },
    }),
  });
  const a = (await res.json().catch(() => ({}))) as Assessment;
  if (!res.ok) throw new Error(`createAssessment failed (${res.status}): ${a.error?.message ?? 'no details'}`);
  const t = a.tokenProperties ?? {};
  if (t.valid && t.action === action) return true;
  console.warn(`reCAPTCHA challenge rejected (${action})`, {
    valid: t.valid, invalidReason: t.invalidReason, action: t.action, hostname: t.hostname,
    score: a.riskAnalysis?.score, reasons: a.riskAnalysis?.reasons,
  });
  return false;
}

/**
 * Runs the two-step bot check for a form submission.
 * Throws RecaptchaConfigError (secret missing) or a plain Error (Google unreachable).
 */
export async function checkRecaptcha(opts: { action: string; token: string; challengeToken: string; req: Request }): Promise<RecaptchaOutcome> {
  const { action, req } = opts;
  const v3Secret = Netlify.env.get('RECAPTCHA_SECRET_KEY');
  const enterpriseKey = Netlify.env.get('RECAPTCHA_ENTERPRISE_API_KEY');
  if (!v3Secret) throw new RecaptchaConfigError('RECAPTCHA_SECRET_KEY is not set');
  const ip = req.headers.get('x-nf-client-connection-ip');

  // Step 2: the visitor has answered the checkbox challenge.
  if (opts.challengeToken) {
    if (!enterpriseKey) return { ok: false, error: 'captcha', status: 400 };
    if (await assessChallenge(enterpriseKey, opts.challengeToken, action, req, ip)) return { ok: true };
    return { ok: false, error: 'challenge', status: 403 }; // usually an expired checkbox: ask again
  }

  // Step 1: invisible v3 score.
  if (!opts.token) return { ok: false, error: 'captcha', status: 400 };
  const v = await verifyV3(v3Secret, opts.token, ip);
  const log = (kind: string) => console.warn(`reCAPTCHA ${kind} (${action})`, { success: v.success, score: v.score, action: v.action, hostname: v.hostname, errors: v['error-codes'] });
  if (!v.success || v.action !== action) {
    log('v3 rejected');
    return { ok: false, error: 'captcha', status: 403 };
  }
  const minScore = Number(Netlify.env.get('RECAPTCHA_MIN_SCORE') ?? DEFAULT_MIN_SCORE);
  if ((v.score ?? 0) >= minScore) return { ok: true };
  log('v3 low score');
  return { ok: false, error: enterpriseKey ? 'challenge' : 'captcha', status: 403 };
}
