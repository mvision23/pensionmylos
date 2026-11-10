import { beds24 } from '../data/site';

export type Beds24Opening = { arrival: string; departure: string };

/**
 * The default stay Beds24's own booking page proposes (its `checkindefault` /
 * `checkoutdefault`) — i.e. the first arrival the property accepts, e.g. the
 * start of next season. Read at build time (server side; the page has no CORS
 * headers, so browsers can't read it) and embedded in the booking forms.
 * Rebuild the site regularly (e.g. a daily build hook) to keep it current.
 * Returns null if Beds24 can't be reached — the forms then start from today.
 */
let cached: { at: number; value: Promise<Beds24Opening | null> } | null = null;

export function getBeds24Opening(): Promise<Beds24Opening | null> {
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.value;
  const value = (async () => {
    try {
      const res = await fetch(`${beds24.bookingPage}?propid=${beds24.propid}`, {
        headers: { 'User-Agent': 'pensionmylos.com site build' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const html = await res.text();
      const read = (name: string) => {
        const m = html.match(new RegExp(`${name}\\s*=\\s*new Date\\((\\d{4}),\\s*(\\d{1,2}),\\s*(\\d{1,2})`));
        if (!m) return null;
        const [y, mo, d] = [Number(m[1]), Number(m[2]) + 1, Number(m[3])]; // JS months are 0-based
        return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      };
      const arrival = read('checkindefault');
      const departure = read('checkoutdefault');
      return arrival && departure ? { arrival, departure } : null;
    } catch {
      return null;
    }
  })();
  cached = { at: Date.now(), value };
  return value;
}
