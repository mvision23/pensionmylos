/**
 * POST /api/booking/cancel { sessionId, ref } — the guest went back to change
 * something before paying: release the rooms right away instead of waiting
 * for the hold to expire. Only works while the Stripe session is still open
 * and only touches "request" bookings, so a paid booking can never be undone.
 */
import type { Config } from '@netlify/functions';
import { BookingError, cancelBookings, errorResponse, json, readMeta, stripe } from '../lib/booking';

export default async (req: Request) => {
  try {
    const body = (await req.json().catch(() => ({}))) as { sessionId?: unknown; ref?: unknown };
    const id = typeof body.sessionId === 'string' ? body.sessionId : '';
    if (!/^cs_[A-Za-z0-9_]{10,}$/.test(id) || typeof body.ref !== 'string') throw new BookingError('invalid', 'sessionId/ref');

    const session = await stripe().checkout.sessions.retrieve(id);
    const meta = readMeta(session);
    if (!meta || meta.ref !== body.ref) throw new BookingError('not_found', 'session/ref mismatch', 404);
    if (session.status !== 'open') return json({ ok: true, cancelled: [], state: session.status });

    await stripe().checkout.sessions.expire(id).catch(() => {});
    const cancelled = await cancelBookings(meta.bookingIds, 'Cancelled by the guest before paying (changed details or rooms).');
    console.log(`cancel ${meta.ref}: session ${id} expired, bookings cancelled ${cancelled.join(',') || 'none'}`);
    return json({ ok: true, cancelled, state: 'expired' });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = { path: '/api/booking/cancel', method: 'POST' };
