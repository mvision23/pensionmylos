/**
 * Beds24 API clients used by the Netlify functions.
 *
 *  - API v2 (bookings): https://api.beds24.com/v2 — needs a token. We keep a
 *    long-lived REFRESH token in the Netlify environment (BEDS24_REFRESH_TOKEN,
 *    created from an invite code: Beds24 → Settings → Marketplace → API) and
 *    exchange it for 24-hour access tokens, cached in memory per function
 *    instance. Refresh tokens die after 30 days unused, so the scheduled
 *    function booking-maintenance.mts refreshes one every hour.
 *  - JSON API v1 (availability + prices): public endpoint, no token; the same
 *    one the reservations page calls from the browser, so server-side prices
 *    match what the guest saw.
 */
import { beds24 } from '../../src/data/site';
import type { DepositRule } from '../../src/lib/booking-math';

const V2 = 'https://api.beds24.com/v2';

export class Beds24Error extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) {
    super(message);
  }
}

// ---------------------------------------------------------------- auth ----
let cached: { token: string; expiresAt: number } | null = null;

/** A valid access token (refreshed when missing or within 5 minutes of expiry). */
export async function getToken(force = false): Promise<string> {
  if (!force && cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached.token;
  const refreshToken = Netlify.env.get('BEDS24_REFRESH_TOKEN');
  if (!refreshToken) throw new Beds24Error('BEDS24_REFRESH_TOKEN is not set');
  const res = await fetch(`${V2}/authentication/token`, { headers: { refreshToken, Accept: 'application/json' } });
  const data = (await res.json().catch(() => ({}))) as { token?: string; expiresIn?: number; error?: string };
  if (!res.ok || !data.token) throw new Beds24Error(`Beds24 token refresh failed: ${data.error ?? res.status}`, res.status, data);
  cached = { token: data.token, expiresAt: Date.now() + (data.expiresIn ?? 86400) * 1000 };
  return cached.token;
}

// ------------------------------------------------------------ requests ----
type Json = Record<string, unknown>;

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, query?: Record<string, string | string[]>): Promise<T> {
  const url = new URL(`${V2}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, item);
  const attempt = async (token: string) =>
    fetch(url, {
      method,
      headers: { token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  let res = await attempt(await getToken());
  if (res.status === 401) res = await attempt(await getToken(true)); // token revoked/expired early: refresh once
  const data = (await res.json().catch(() => null)) as T | (Json & { error?: string; code?: number }) | null;
  if (!res.ok) {
    const err = data && typeof data === 'object' && 'error' in data ? String((data as Json).error) : `HTTP ${res.status}`;
    throw new Beds24Error(`Beds24 ${method} ${path}: ${err}`, res.status, data);
  }
  return data as T;
}

// ------------------------------------------------------------ bookings ----
export type BookingStatus = 'confirmed' | 'request' | 'new' | 'cancelled' | 'black' | 'inquiry';

export type InvoiceItem = {
  id?: number;
  type: 'charge' | 'payment';
  description: string;
  qty?: number;
  amount: number;
  status?: string;
  lineTotal?: number;
  createTime?: string;
};

export type Booking = {
  id: number;
  propertyId?: number;
  roomId: number;
  status: BookingStatus;
  arrival: string;
  departure: string;
  numAdult?: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  apiReference?: string;
  bookingTime?: string;
  price?: number;
  notes?: string;
  invoiceItems?: InvoiceItem[];
  bookingGroup?: { master: number; ids: number[] };
};

export type NewBooking = Partial<Omit<Booking, 'id' | 'invoiceItems'>> & {
  id?: number;
  roomId?: number;
  invoiceItems?: InvoiceItem[];
  actions?: {
    notifyGuest?: boolean;
    notifyHost?: boolean;
    checkAvailability?: boolean;
    makeGroup?: boolean;
    allowWebhooks?: boolean;
  };
  [key: string]: unknown;
};

type PostResult = {
  success: boolean;
  new?: { id?: number } & Json;
  modified?: { id?: number } & Json;
  errors?: { action?: string; field?: string; message?: string }[];
  warnings?: { message?: string }[];
};

type ListResponse<T> = { success: boolean; type?: string; count?: number; data: T[]; pages?: { nextPageExists?: boolean } };

/** Creates (no `id`) or updates (`id`) bookings in one request. */
export async function postBookings(bookings: NewBooking[]): Promise<PostResult[]> {
  return call<PostResult[]>('POST', '/bookings', bookings);
}

export async function getBookings(query: Record<string, string | string[]>): Promise<Booking[]> {
  const res = await call<ListResponse<Booking>>('GET', '/bookings', undefined, query);
  return res.data ?? [];
}

export async function getBooking(id: number, includeInvoiceItems = true): Promise<Booking | null> {
  const list = await getBookings({
    id: String(id),
    includeInvoiceItems: String(includeInvoiceItems),
    status: ['confirmed', 'request', 'new', 'cancelled', 'black', 'inquiry'],
  });
  return list[0] ?? null;
}

/** Human-readable reasons from a failed item of POST /bookings. */
export const postErrors = (r: PostResult) => (r.errors ?? []).map((e) => [e.field, e.message].filter(Boolean).join(': ')).join('; ') || 'unknown error';

// ------------------------------------------------------- property ----
type PropertyPayment = {
  depositNonPayment?: string;
  depositPayment1?: { fixedAmount?: number; variableAmount?: { type?: 'percentage' | 'firstNight'; percentageValue?: number | null } };
};
let depositCache: { at: number; rule: DepositRule | null } | null = null;

/**
 * The deposit rule set in Beds24 (Settings → Payment collection → Deposit 1),
 * cached for an hour. null = not configured (then the whole stay is charged).
 * Throws if Beds24 can't be read (callers decide the fallback).
 */
export async function getDepositRule(): Promise<DepositRule | null> {
  if (depositCache && Date.now() - depositCache.at < 60 * 60 * 1000) return depositCache.rule;
  const res = await call<ListResponse<{ id: number; paymentCollection?: PropertyPayment }>>('GET', '/properties', undefined, { id: beds24.propid });
  const pc = res.data?.[0]?.paymentCollection?.depositPayment1;
  const fixed = Number(pc?.fixedAmount ?? 0) || 0;
  const type = pc?.variableAmount?.type === 'firstNight' ? 'firstNight' : 'percentage';
  const percentage = type === 'percentage' ? Number(pc?.variableAmount?.percentageValue ?? 0) || 0 : 0;
  const rule: DepositRule | null = fixed > 0 || percentage > 0 || type === 'firstNight' ? { fixed, type, percentage } : null;
  depositCache = { at: Date.now(), rule };
  return rule;
}

// ------------------------------------------------- availability (v1) ----
export type Offer = { avail: number; cap: number; price: Record<number, number>; currency: string };

/**
 * Availability and price per room for a stay, asked once per occupancy
 * (1…maxAdults) so we know each room's capacity — exactly what the
 * reservations page does in the browser.
 */
export async function getOffers(arrival: string, departure: string, maxAdults: number): Promise<Record<string, Offer>> {
  const ask = async (n: number) => {
    const res = await fetch(beds24.availabilityApi, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        propId: beds24.propid,
        checkIn: arrival.replace(/-/g, ''),
        checkOut: departure.replace(/-/g, ''),
        numAdult: String(n),
        numChild: '0',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Beds24Error(`Beds24 availability: HTTP ${res.status}`, res.status);
    return (await res.json()) as Record<string, { roomId?: string; roomsavail?: string | number; price?: number; currency?: string } | unknown>;
  };
  const replies = await Promise.all(Array.from({ length: maxAdults }, (_, i) => ask(i + 1)));
  const offers: Record<string, Offer> = {};
  replies.forEach((data, i) => {
    for (const v of Object.values(data)) {
      const r = v as { roomId?: string; roomsavail?: string | number; price?: number; currency?: string };
      if (!r || typeof r !== 'object' || !r.roomId || typeof r.price !== 'number' || !(Number(r.roomsavail) > 0)) continue;
      const o = (offers[r.roomId] ??= { avail: Number(r.roomsavail), cap: 0, price: {}, currency: r.currency || 'EUR' });
      o.price[i + 1] = r.price;
      o.cap = Math.max(o.cap, i + 1);
    }
  });
  return offers;
}
