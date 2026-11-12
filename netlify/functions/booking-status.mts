/**
 * GET /api/booking/status?session_id=cs_… — what /booking-confirmed/ asks
 * when Stripe sends the guest back.
 *
 * Replies { ok: true, state, … } where state is:
 *   confirmed   paid; bookings confirmed in Beds24 (or being confirmed by the
 *               webhook if Beds24 was unreachable just now: synced=false)
 *   processing  the guest paid with a method that settles later
 *   open        no payment yet (the guest came back without paying)
 *   expired     the 30-minute hold ran out; nothing was charged
 * plus ref, bookingIds, arrival, departure, adults, rooms, total, currency, email.
 */
import type { Config } from '@netlify/functions';
import { BookingError, confirmFromSession, errorResponse, json, readMeta, stripe } from '../lib/booking';

export default async (req: Request) => {
  try {
    const id = new URL(req.url).searchParams.get('session_id') ?? '';
    if (!/^cs_[A-Za-z0-9_]{10,}$/.test(id)) throw new BookingError('invalid', 'session_id');

    const session = await stripe().checkout.sessions.retrieve(id).catch((e: { statusCode?: number }) => {
      if (e.statusCode === 404) throw new BookingError('not_found', 'no such session', 404);
      throw e;
    });
    const meta = readMeta(session);
    if (!meta) throw new BookingError('not_found', 'not a booking session', 404);

    const base = {
      ok: true,
      ref: meta.ref,
      bookingIds: meta.bookingIds,
      arrival: meta.arrival,
      departure: meta.departure,
      adults: meta.adults,
      rooms: meta.rooms,
      total: (session.amount_total ?? 0) / 100,
      currency: (session.currency ?? 'eur').toUpperCase(),
      email: session.customer_details?.email ?? meta.email,
    };

    if (session.status === 'expired') return json({ ...base, state: 'expired' });
    if (session.status === 'open') return json({ ...base, state: 'open' });
    if (session.payment_status !== 'paid') return json({ ...base, state: 'processing' });

    let synced = true;
    try {
      await confirmFromSession(session);
    } catch (err) {
      // The webhook retries this for up to three days; the guest still gets the number now.
      console.error('confirm on return page failed (webhook will retry):', err);
      synced = false;
    }
    return json({ ...base, state: 'confirmed', synced });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = { path: '/api/booking/status', method: 'GET' };
