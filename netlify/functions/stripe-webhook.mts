/**
 * POST /api/stripe/webhook — Stripe tells us what happened to a Checkout
 * session. Register https://pensionmylos.com/api/stripe/webhook in the Stripe
 * Dashboard (Developers → Webhooks) for the events below and put its signing
 * secret in STRIPE_WEBHOOK_SECRET.
 *
 *   checkout.session.completed / async_payment_succeeded → confirm the bookings
 *   checkout.session.expired / async_payment_failed      → cancel the request bookings
 *
 * A non-2xx reply makes Stripe retry (for up to three days), which is what we
 * want when Beds24 is unreachable.
 */
import type { Config } from '@netlify/functions';
import type Stripe from 'stripe';
import { cancelBookings, confirmFromSession, json, readMeta, stripe } from '../lib/booking';

export default async (req: Request) => {
  const secret = Netlify.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set');
    return json({ ok: false, error: 'not_configured' }, 500);
  }
  const signature = req.headers.get('stripe-signature') ?? '';
  const raw = await req.text(); // the signature covers the exact bytes
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    console.warn('webhook signature rejected:', (err as Error).message);
    return json({ ok: false, error: 'signature' }, 400);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        if (!readMeta(session)) break; // not one of our booking sessions
        if (session.payment_status !== 'paid') break; // completed but settling later: wait for async_payment_succeeded
        const { meta, confirmed, skipped } = await confirmFromSession(session);
        console.log(`webhook ${event.type} ${meta.ref}: confirmed ${confirmed.join(',') || '-'} (already done: ${skipped.join(',') || '-'})`);
        break;
      }
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object;
        const meta = readMeta(session);
        if (!meta) break;
        const cancelled = await cancelBookings(meta.bookingIds, event.type === 'checkout.session.expired'
          ? 'Auto-cancelled: not paid within the time limit.'
          : 'Auto-cancelled: the online payment failed.');
        console.log(`webhook ${event.type} ${meta.ref}: cancelled ${cancelled.join(',') || 'none'}`);
        break;
      }
      default:
        break;
    }
    return json({ received: true });
  } catch (err) {
    console.error(`webhook ${event.type} failed, Stripe will retry:`, err);
    return json({ ok: false, error: 'upstream' }, 502);
  }
};

export const config: Config = { path: '/api/stripe/webhook', method: 'POST' };
