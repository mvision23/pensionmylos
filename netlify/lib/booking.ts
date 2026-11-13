/**
 * The booking flow behind /reservations/, shared by the booking-* functions.
 *
 *   1. booking-checkout: the guest's selection is re-priced from Beds24 (never
 *      trusted from the browser), one Beds24 booking per room is created with
 *      status "request" (holds the room, gives us the booking number), and a
 *      Stripe embedded Checkout session is created for the total. The Beds24
 *      ids travel in the session's metadata; our reference (PM-…) is stored
 *      on both sides.
 *   2. The guest pays on the page. Stripe then calls stripe-webhook and sends
 *      the guest to /booking-confirmed/, which asks booking-status. Both run
 *      confirmFromSession(): idempotent — sets the bookings to "confirmed",
 *      records the payment on their invoices, asks Beds24 to email the guest.
 *   3. Unpaid sessions expire after 30 minutes: the webhook (or the hourly
 *      booking-maintenance) cancels the request bookings.
 */
import Stripe from 'stripe';
import { beds24, bookableRooms, site } from '../../src/data/site';
import { defaultLocale, isLocale, type Locale } from '../../src/i18n/config';
import { cents, depositFor, nightsBetween, priceFor, spreadAdults, unitLines, type DepositRule, type UnitLines } from '../../src/lib/booking-math';
import { isCountryCode } from '../../src/lib/countries';
import { formatDMY } from '../../src/lib/dates';
import * as b24 from './beds24';

export const REF_PREFIX = 'PM-';
/** Stripe's minimum session lifetime is 30 minutes; a little margin for clock skew. */
export const HOLD_MINUTES = 31;
const MAX_ADULTS = 6;
const MAX_OCCUPANCY = 3; // adults per room Beds24 prices for
const MAX_NIGHTS = 30;
const MAX_UNITS = 6;
const REFERER = 'pensionmylos.com';

export type ErrorCode = 'invalid' | 'sold_out' | 'price_changed' | 'not_configured' | 'upstream' | 'not_found';
export class BookingError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly status = 400, readonly details?: unknown) {
    super(message);
  }
}

// ---------------------------------------------------------------- input ----
export type Guest = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country2: string;
  arrivalTime: string;
  comments: string;
};
export type Selection = {
  arrival: string;
  departure: string;
  adults: number;
  /** roomId → number of rooms of that type */
  rooms: Record<string, number>;
  locale: Locale;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number, min = 0) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min || s.length > max) throw new BookingError('invalid', `field length (${min}–${max})`);
  return s;
};

/** Today in the pension's time zone (Greece), as YYYY-MM-DD. */
const todayAthens = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date());

export function parseCheckoutInput(body: unknown): { selection: Selection; guest: Guest; expectedTotal: number | null } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const fail = (what: string): never => { throw new BookingError('invalid', what); };

  const arrival = typeof b.arrival === 'string' && DATE.test(b.arrival) ? b.arrival : fail('arrival');
  const departure = typeof b.departure === 'string' && DATE.test(b.departure) ? b.departure : fail('departure');
  const nights = nightsBetween(arrival, departure);
  if (!(nights >= 1 && nights <= MAX_NIGHTS)) fail('nights');
  if (arrival < todayAthens()) fail('arrival in the past');
  const adults = Number(b.adults);
  if (!Number.isInteger(adults) || adults < 1 || adults > MAX_ADULTS) fail('adults');
  const locale = isLocale(b.locale) ? b.locale : defaultLocale;

  const rooms: Record<string, number> = {};
  const raw = (b.rooms && typeof b.rooms === 'object' ? b.rooms : {}) as Record<string, unknown>;
  let units = 0;
  for (const r of bookableRooms) {
    const q = Number(raw[r.id] ?? 0);
    if (!Number.isInteger(q) || q < 0 || q > MAX_UNITS) fail('room quantity');
    if (q > 0) { rooms[r.id] = q; units += q; }
  }
  if (units < 1 || units > MAX_UNITS) fail('rooms');

  const g = (b.guest && typeof b.guest === 'object' ? b.guest : {}) as Record<string, unknown>;
  const email = str(g.email, 254, 3);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('email');
  const guest: Guest = {
    firstName: str(g.firstName, 100, 1),
    lastName: str(g.lastName, 100, 1),
    email,
    phone: str(g.phone, 40, 5),
    country2: isCountryCode(g.country2) ? g.country2 : fail('country'),
    arrivalTime: str(g.arrivalTime, 60),
    comments: str(g.comments, 1000),
  };

  const expectedTotal = typeof b.expectedTotal === 'number' && Number.isFinite(b.expectedTotal) ? b.expectedTotal : null;
  return { selection: { arrival, departure, adults, rooms, locale }, guest, expectedTotal };
}

// -------------------------------------------------------------- pricing ----
export type PricedUnit = { roomId: string; name: string; adults: number; cap: number; lines: UnitLines; deposit: number };
export type Priced = { units: PricedUnit[]; nights: number; total: number; deposit: number; balance: number; rule: DepositRule | null; currency: string };

/** The deposit rule from Beds24; if it can't be read, the whole stay is charged (never nothing). */
export async function depositRule(): Promise<DepositRule | null> {
  try {
    return await b24.getDepositRule();
  } catch (err) {
    console.warn('deposit rule unavailable, charging the full amount:', (err as Error).message);
    return null;
  }
}

/** Re-prices a selection from Beds24 (live availability + prices) and applies the deposit rule. */
export async function priceSelection(sel: Selection): Promise<Priced> {
  const [offers, rule] = await Promise.all([b24.getOffers(sel.arrival, sel.departure, MAX_OCCUPANCY), depositRule()]);
  const nights = nightsBetween(sel.arrival, sel.departure);
  const flat: { roomId: string; name: string; cap: number; offer: b24.Offer }[] = [];
  let currency = 'EUR';
  for (const r of bookableRooms) {
    const q = sel.rooms[r.id];
    if (!q) continue;
    const o = offers[r.id];
    if (!o || o.avail < q) throw new BookingError('sold_out', `room ${r.id} not available`, 409);
    currency = o.currency;
    for (let i = 0; i < q; i++) flat.push({ roomId: r.id, name: r.name, cap: o.cap, offer: o });
  }
  const units = spreadAdults(flat, sel.adults).map((u) => {
    const lines = unitLines(priceFor(u.offer.price, u.adults, u.cap), nights);
    return { roomId: u.roomId, name: u.name, adults: u.adults, cap: u.cap, lines, deposit: depositFor(lines, nights, rule) };
  });
  const total = cents(units.reduce((s, u) => s + u.lines.total, 0));
  const deposit = cents(units.reduce((s, u) => s + u.deposit, 0));
  return { units, nights, total, deposit, balance: cents(total - deposit), rule, currency };
}

// --------------------------------------------------------------- Stripe ----
let stripeClient: Stripe | null = null;
export function stripe(): Stripe {
  const key = Netlify.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new BookingError('not_configured', 'STRIPE_SECRET_KEY is not set', 500);
  return (stripeClient ??= new Stripe(key));
}

export function publishableKey(): string {
  const key = Netlify.env.get('STRIPE_PUBLISHABLE_KEY');
  if (!key) throw new BookingError('not_configured', 'STRIPE_PUBLISHABLE_KEY is not set', 500);
  return key;
}

/** Stripe Checkout languages: ours except Catalan (not offered; Stripe then follows the browser). */
const stripeLocale = (l: Locale): Stripe.Checkout.SessionCreateParams.Locale => (l === 'ca' ? 'auto' : l);

export const localePath = (locale: Locale, path: string) => (locale === defaultLocale ? path : `/${locale}${path}`);

/** Short English label for the Stripe form / Beds24 notes. */
export const describeRule = (rule: DepositRule | null) =>
  !rule ? 'full payment' : rule.type === 'firstNight' ? 'first night as deposit' : `${rule.percentage}% deposit${rule.fixed ? ` + ${rule.fixed.toFixed(2)}` : ''}`;

export const newRef = () => REF_PREFIX + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

export type SessionMeta = {
  ref: string;
  bookingIds: number[];
  /** Paid now, per booking (the deposit, or the whole room). */
  amounts: number[];
  /** Full price per booking. */
  totals: number[];
  locale: Locale;
  arrival: string;
  departure: string;
  adults: number;
  rooms: Record<string, number>;
  email: string;
};

export function readMeta(session: Stripe.Checkout.Session): SessionMeta | null {
  const m = session.metadata ?? {};
  if (!m.ref || !m.bookingIds) return null;
  const rooms: Record<string, number> = {};
  for (const part of (m.rooms ?? '').split(',')) {
    const [id, q] = part.split('x');
    if (id && Number(q) > 0) rooms[id] = Number(q);
  }
  return {
    ref: m.ref,
    bookingIds: m.bookingIds.split(',').map(Number).filter(Boolean),
    amounts: (m.amounts ?? '').split(',').map(Number),
    totals: (m.totals ?? m.amounts ?? '').split(',').map(Number),
    locale: isLocale(m.locale) ? m.locale : defaultLocale,
    arrival: m.arrival ?? '',
    departure: m.departure ?? '',
    adults: Number(m.adults) || 0,
    rooms,
    email: m.email ?? '',
  };
}

export async function createCheckoutSession(origin: string, sel: Selection, guest: Guest, priced: Priced, ref: string, bookingIds: number[]) {
  const meta: Record<string, string> = {
    ref,
    bookingIds: bookingIds.join(','),
    amounts: priced.units.map((u) => u.deposit.toFixed(2)).join(','),
    totals: priced.units.map((u) => u.lines.total.toFixed(2)).join(','),
    locale: sel.locale,
    arrival: sel.arrival,
    departure: sel.departure,
    adults: String(sel.adults),
    rooms: Object.entries(sel.rooms).map(([id, q]) => `${id}x${q}`).join(','),
    email: guest.email,
  };
  const stay = `${formatDMY(sel.arrival)} → ${formatDMY(sel.departure)}`;
  const partial = priced.deposit < priced.total;
  const ruleText = describeRule(priced.rule);
  return stripe().checkout.sessions.create({
    ui_mode: 'embedded_page',
    mode: 'payment',
    submit_type: 'book',
    locale: stripeLocale(sel.locale),
    customer_email: guest.email,
    client_reference_id: ref,
    expires_at: Math.floor(Date.now() / 1000) + HOLD_MINUTES * 60,
    return_url: `${origin}${localePath(sel.locale, '/booking-confirmed/')}?session_id={CHECKOUT_SESSION_ID}`,
    line_items: priced.units.map((u) => ({
      quantity: 1,
      price_data: {
        currency: priced.currency.toLowerCase(),
        unit_amount: Math.round(u.deposit * 100),
        product_data: {
          name: `${u.name} · ${priced.nights} ${priced.nights === 1 ? 'night' : 'nights'}${partial ? ` · ${ruleText}` : ''}`,
          description: partial
            ? `${stay} · ${u.adults} ${u.adults === 1 ? 'adult' : 'adults'} · room total ${u.lines.total.toFixed(2)} ${priced.currency} incl. taxes; the balance of ${cents(u.lines.total - u.deposit).toFixed(2)} ${priced.currency} is paid at the pension`
            : `${stay} · ${u.adults} ${u.adults === 1 ? 'adult' : 'adults'} · taxes included`,
        },
      },
    })),
    metadata: meta,
    payment_intent_data: {
      description: `${site.name} booking ${bookingIds.join('+')} · ${stay}${partial ? ` · ${ruleText}` : ''}`,
      metadata: meta,
      receipt_email: guest.email,
      statement_descriptor_suffix: 'PENSION MYLOS',
    },
  });
}

// --------------------------------------------------------------- Beds24 ----
const countryName = (code: string) => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code; } catch { return code; }
};

/** Creates one "request" booking per room (grouped), holding the rooms while the guest pays. */
export async function createPendingBookings(sel: Selection, guest: Guest, priced: Priced, ref: string): Promise<number[]> {
  const group = priced.units.length > 1;
  const payload: b24.NewBooking[] = priced.units.map((u) => ({
    roomId: Number(u.roomId),
    status: 'request',
    arrival: sel.arrival,
    departure: sel.departure,
    numAdult: u.adults,
    numChild: 0,
    firstName: guest.firstName,
    lastName: guest.lastName,
    email: guest.email,
    phone: guest.phone,
    country: countryName(guest.country2),
    country2: guest.country2,
    arrivalTime: guest.arrivalTime || undefined,
    comments: guest.comments || undefined,
    lang: sel.locale,
    refererEditable: REFERER,
    apiReference: ref,
    notes: `Website booking ${ref} — awaiting online card payment of ${u.deposit.toFixed(2)} ${priced.currency}${u.deposit < u.lines.total ? ` (${describeRule(priced.rule)}; balance ${cents(u.lines.total - u.deposit).toFixed(2)} ${priced.currency} at the pension)` : ''} via Stripe. Confirmed automatically once paid; cancelled automatically if not paid within ${HOLD_MINUTES} min.`,
    price: u.lines.total,
    deposit: u.deposit,
    invoiceItems: [
      { type: 'charge', description: `${u.name} — ${priced.nights} night${priced.nights === 1 ? '' : 's'}`, qty: 1, amount: u.lines.room },
      { type: 'charge', description: `VAT ${Math.round(beds24.taxes.vat * 100)} %`, qty: 1, amount: u.lines.vat },
      { type: 'charge', description: `Municipality tax ${beds24.taxes.municipal * 100} %`, qty: 1, amount: u.lines.municipal },
      { type: 'charge', description: `Climate tax €${beds24.taxes.climatePerRoomNight} per room per night`, qty: priced.nights, amount: beds24.taxes.climatePerRoomNight },
    ],
    actions: { checkAvailability: true, makeGroup: group, notifyGuest: false, notifyHost: false },
  }));

  const results = await b24.postBookings(payload);
  const ids = results.map((r) => (r.success ? Number(r.new?.id ?? r.modified?.id) : NaN));
  const created = ids.filter((id) => Number.isFinite(id) && id > 0);
  if (created.length !== payload.length) {
    const reasons = results.filter((r) => !r.success).map(b24.postErrors).join(' | ');
    if (created.length) await cancelBookings(created, `Auto-cancelled: another room of the same request could not be created (${reasons})`).catch(() => {});
    const soldOut = /avail/i.test(reasons);
    throw new BookingError(soldOut ? 'sold_out' : 'upstream', `Beds24 rejected the booking: ${reasons}`, soldOut ? 409 : 502, results);
  }
  return created;
}

/** Cancels bookings that are still unpaid requests (never a confirmed booking). */
export async function cancelBookings(ids: number[], reason: string): Promise<number[]> {
  const cancelled: number[] = [];
  for (const id of ids) {
    const booking = await b24.getBooking(id, false);
    if (!booking || booking.status !== 'request') continue;
    const [r] = await b24.postBookings([{ id, status: 'cancelled', notes: `${booking.notes ? booking.notes + '\n' : ''}${reason}` }]);
    if (r?.success) cancelled.push(id);
  }
  return cancelled;
}

/**
 * After a successful payment: confirm the bookings, record the payment on
 * each invoice and have Beds24 email the guest. Safe to call repeatedly
 * (webhook + return page + Stripe retries): a booking already carrying this
 * payment is skipped.
 */
export async function confirmFromSession(session: Stripe.Checkout.Session): Promise<{ meta: SessionMeta; confirmed: number[]; skipped: number[] }> {
  if (session.payment_status !== 'paid') throw new BookingError('invalid', `session ${session.id} is not paid`, 409);
  const meta = readMeta(session);
  if (!meta) throw new BookingError('invalid', `session ${session.id} has no booking metadata`, 409);
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? session.id;
  const marker = `Stripe ${pi}`;
  const confirmed: number[] = [];
  const skipped: number[] = [];

  for (const [i, id] of meta.bookingIds.entries()) {
    const booking = await b24.getBooking(id);
    if (!booking) throw new BookingError('not_found', `Beds24 booking ${id} not found`, 502);
    if (booking.status === 'confirmed' && booking.invoiceItems?.some((it) => it.type === 'payment' && it.description?.includes(marker))) {
      skipped.push(id);
      continue;
    }
    const amount = meta.amounts[i] ?? (i === 0 ? (session.amount_total ?? 0) / 100 : 0);
    const roomTotal = meta.totals[i] ?? amount;
    const balance = cents(roomTotal - amount);
    const warn = booking.status === 'cancelled' ? '\nWARNING: this booking was cancelled before the payment arrived — please check the room is still free.' : '';
    const [r] = await b24.postBookings([
      {
        id,
        status: 'confirmed',
        notes: `Website booking ${meta.ref} — PAID online by card: ${amount.toFixed(2)} ${session.currency?.toUpperCase()} (${marker}, ${((session.amount_total ?? 0) / 100).toFixed(2)} for the whole booking).${balance > 0 ? ` Balance of ${balance.toFixed(2)} ${session.currency?.toUpperCase()} to be paid at the pension.` : ''}${warn}`,
        invoiceItems: [{ type: 'payment', description: `${marker} — online card ${balance > 0 ? 'deposit' : 'payment'}`, qty: 1, amount, status: 'paid' }],
        actions: { notifyGuest: true },
      },
    ]);
    if (!r?.success) throw new BookingError('upstream', `Beds24 could not confirm booking ${id}: ${b24.postErrors(r)}`, 502, r);
    confirmed.push(id);
  }
  return { meta, confirmed, skipped };
}

// ---------------------------------------------------------------- HTTP ----
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export function errorResponse(err: unknown): Response {
  if (err instanceof BookingError) {
    if (err.status >= 500) console.error(err.code, err.message, err.details ?? '');
    else console.warn(err.code, err.message);
    return json({ ok: false, error: err.code, message: err.status >= 500 ? undefined : err.message }, err.status);
  }
  if (err instanceof b24.Beds24Error) {
    console.error('Beds24:', err.message, err.body ?? '');
    return json({ ok: false, error: 'upstream' }, 502);
  }
  console.error(err);
  return json({ ok: false, error: 'upstream' }, 502);
}
