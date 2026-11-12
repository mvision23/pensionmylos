/**
 * POST /api/booking/checkout — step 1 of a booking (see netlify/lib/booking.ts).
 *
 * Body (JSON): { arrival, departure, adults, rooms: { roomId: qty }, locale,
 *   guest: { firstName, lastName, email, phone, country2, arrivalTime, comments },
 *   expectedTotal, recaptchaToken | recaptchaChallengeToken }
 * Replies: { ok: true, clientSecret, sessionId, publishableKey, ref, bookingIds, total, currency }
 * or { ok: false, error: 'invalid' | 'captcha' | 'challenge' | 'sold_out' | 'price_changed' (+ total)
 *   | 'not_configured' | 'upstream' }.
 *
 * Bot check first (netlify/lib/recaptcha.ts, action "booking"): a bot that got
 * past it could tie up rooms with 30-minute holds.
 */
import type { Config } from '@netlify/functions';
import {
  BookingError, cancelBookings, createCheckoutSession, createPendingBookings, errorResponse, json, newRef,
  parseCheckoutInput, priceSelection, publishableKey, stripe,
} from '../lib/booking';
import { checkRecaptcha, RecaptchaConfigError } from '../lib/recaptcha';

export default async (req: Request) => {
  try {
    let body: unknown;
    try { body = await req.json(); } catch { throw new BookingError('invalid', 'body is not JSON'); }
    // Honeypot: a filled hidden field means a bot. Pretend all is well.
    if (typeof (body as { _gotcha?: unknown })?._gotcha === 'string' && (body as { _gotcha: string })._gotcha.trim()) {
      return json({ ok: false, error: 'upstream' }, 502);
    }
    const { selection, guest, expectedTotal } = parseCheckoutInput(body);
    const b = body as Record<string, unknown>;
    try {
      const check = await checkRecaptcha({
        action: 'booking',
        token: typeof b.recaptchaToken === 'string' ? b.recaptchaToken : '',
        challengeToken: typeof b.recaptchaChallengeToken === 'string' ? b.recaptchaChallengeToken : '',
        req,
      });
      if (!check.ok) return json({ ok: false, error: check.error }, check.status);
    } catch (err) {
      if (err instanceof RecaptchaConfigError) throw new BookingError('not_configured', err.message, 500);
      throw new BookingError('upstream', `reCAPTCHA verification failed: ${(err as Error).message}`, 502);
    }
    // Fail early (before touching Beds24) if Stripe isn't configured.
    stripe();
    const pk = publishableKey();

    const priced = await priceSelection(selection);
    if (expectedTotal !== null && Math.abs(expectedTotal - priced.total) > 0.005) {
      throw new BookingError('price_changed', `price is now ${priced.total}`, 409, { total: priced.total });
    }

    const ref = newRef();
    const bookingIds = await createPendingBookings(selection, guest, priced, ref);
    let session;
    try {
      session = await createCheckoutSession(new URL(req.url).origin, selection, guest, priced, ref, bookingIds);
    } catch (err) {
      await cancelBookings(bookingIds, 'Auto-cancelled: payment session could not be created').catch(() => {});
      throw err;
    }
    console.log(`checkout ${ref}: bookings ${bookingIds.join(',')} session ${session.id} total ${priced.total} ${priced.currency}`);
    return json({
      ok: true,
      clientSecret: session.client_secret,
      sessionId: session.id,
      publishableKey: pk,
      ref,
      bookingIds,
      total: priced.total,
      currency: priced.currency,
    });
  } catch (err) {
    if (err instanceof BookingError && err.code === 'price_changed') {
      return json({ ok: false, error: 'price_changed', total: (err.details as { total: number }).total }, 409);
    }
    return errorResponse(err);
  }
};

export const config: Config = { path: '/api/booking/checkout', method: 'POST' };
