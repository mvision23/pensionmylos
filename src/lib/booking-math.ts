/**
 * Booking arithmetic shared by the reservations page (browser) and the
 * Netlify functions (server), so the total a guest sees is exactly the total
 * they are charged and the total written to the Beds24 invoice.
 *
 * Prices from Beds24 are per room for the whole stay, before taxes. On top
 * of them come VAT, the municipal tax and the climate fee (src/data/site.ts →
 * beds24.taxes). Each room is priced on its own and rounded to the cent; the
 * booking total is the sum of the rooms.
 */
import { beds24 } from '../data/site';

export type Taxes = typeof beds24.taxes;

/** Rounds to cents, avoiding 1.005 → 1.00 float surprises. */
export const cents = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Nights between two YYYY-MM-DD dates. */
export const nightsBetween = (arrival: string, departure: string) =>
  Math.round((Date.parse(`${departure}T12:00:00Z`) - Date.parse(`${arrival}T12:00:00Z`)) / 864e5);

/** One room of a booking, priced for the stay. */
export type UnitLines = {
  /** Room price for the stay, before taxes (what Beds24 quotes). */
  room: number;
  vat: number;
  municipal: number;
  /** Climate fee: per room and night. */
  climate: number;
  /** What the guest pays for this room. */
  total: number;
};

export function unitLines(net: number, nights: number, taxes: Taxes = beds24.taxes): UnitLines {
  const room = cents(net);
  const vat = cents(room * taxes.vat);
  const municipal = cents(room * taxes.municipal);
  const climate = cents(taxes.climatePerRoomNight * nights);
  return { room, vat, municipal, climate, total: cents(room + vat + municipal + climate) };
}

/**
 * Spreads the adults searched for over the chosen rooms: at least one adult
 * per room, then the rest fill the rooms in order up to their capacity.
 * `units` are the rooms in the order they are listed, one entry per room.
 */
export function spreadAdults<T extends { cap: number }>(units: T[], adults: number): (T & { adults: number })[] {
  const out = units.map((u) => ({ ...u, adults: 1 }));
  let left = adults - out.length;
  for (const u of out) while (left > 0 && u.adults < u.cap) { u.adults++; left--; }
  return out;
}

/** Price for n adults: the nearest occupancy Beds24 quoted (prices here don't depend on it). */
export function priceFor(prices: Record<number, number>, n: number, cap: number): number {
  for (let a = n; a <= cap; a++) if (prices[a] != null) return prices[a];
  return prices[cap];
}

/**
 * Beds24's deposit rule (Settings → Payment collection → Deposit 1): a fixed
 * amount plus either a percentage of the booking or its first night.
 */
export type DepositRule = { fixed: number; type: 'percentage' | 'firstNight'; percentage: number };

/**
 * What the guest pays now for one room. A rule that works out to nothing (or
 * more than the room) means the whole room is paid at booking.
 */
export function depositFor(lines: UnitLines, nights: number, rule: DepositRule | null): number {
  if (!rule) return lines.total;
  const variable = rule.type === 'percentage' ? (lines.total * rule.percentage) / 100 : lines.total / Math.max(1, nights);
  const d = cents(rule.fixed + variable);
  return d > 0 && d < lines.total ? d : lines.total;
}
