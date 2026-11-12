/**
 * Runs every hour (Netlify scheduled function; no URL):
 *
 *  1. Refreshes the Beds24 access token so the refresh token in
 *     BEDS24_REFRESH_TOKEN never goes 30 days unused (it would expire).
 *  2. Cancels website "request" bookings that are still unpaid after two
 *     hours — a safety net in case Stripe's expiry webhook never reached us.
 *     (Only bookings with our PM-… reference; a paid booking is "confirmed"
 *     and never touched.)
 *
 * Test locally: netlify functions:invoke booking-maintenance
 */
import type { Config } from '@netlify/functions';
import { beds24 } from '../../src/data/site';
import * as b24 from '../lib/beds24';
import { cancelBookings, REF_PREFIX } from '../lib/booking';

const STALE_AFTER_H = 2;
const LOOK_BACK_DAYS = 7;

export default async () => {
  await b24.getToken(true);
  console.log('Beds24 token refreshed');

  const iso = (d: Date) => d.toISOString().slice(0, 19);
  const now = Date.now();
  const stale = await b24.getBookings({
    propertyId: beds24.propid,
    status: 'request',
    bookingTimeFrom: iso(new Date(now - LOOK_BACK_DAYS * 864e5)),
    bookingTimeTo: iso(new Date(now - STALE_AFTER_H * 3600e3)),
  });
  // Beds24 ignores apiReference on API-created bookings, so ours are recognised by the
  // note createPendingBookings() writes first ("Website booking PM-…").
  const ours = stale.filter((b) => b.notes?.startsWith(`Website booking ${REF_PREFIX}`)).map((b) => b.id);
  if (!ours.length) {
    console.log('no stale unpaid website bookings');
    return;
  }
  const cancelled = await cancelBookings(ours, `Auto-cancelled by the website: not paid within ${STALE_AFTER_H} hours.`);
  console.log(`stale unpaid bookings cancelled: ${cancelled.join(',') || 'none'} (candidates ${ours.join(',')})`);
};

export const config: Config = { schedule: '@hourly' };
