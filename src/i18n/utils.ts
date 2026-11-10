import en from './messages/en.json';
import { defaultLocale, isLocale, locales, type Locale } from './config';

export type Messages = typeof en;

// Every messages/<lang>.json, loaded at build time. A missing file or key falls
// back to English, so a half-finished translation never breaks a page.
const files = import.meta.glob<Messages>('./messages/*.json', { eager: true, import: 'default' });

function merge<T>(base: T, over: unknown): T {
  if (Array.isArray(base)) {
    if (!Array.isArray(over)) return base;
    return base.map((b, i) => merge(b, over[i])) as T;
  }
  if (base && typeof base === 'object') {
    const o = (over && typeof over === 'object' ? over : {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(base as Record<string, unknown>)) out[k] = merge(v, o[k]);
    return out as T;
  }
  return (typeof over === typeof base && over !== '' ? over : base) as T;
}

const cache = new Map<Locale, Messages>();
export function getMessages(locale: Locale): Messages {
  if (!cache.has(locale)) cache.set(locale, merge(en, files[`./messages/${locale}.json`]));
  return cache.get(locale)!;
}

/** `/path` for English, `/<locale>/path` otherwise. `path` must start with "/". */
export function localePath(locale: Locale, path = '/'): string {
  if (locale === defaultLocale) return path;
  return `/${locale}${path === '/' ? '/' : path}`;
}

/** Splits a pathname into its locale and the locale-less path. */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const m = pathname.match(/^\/([a-z]{2})(\/.*|$)/);
  if (m && isLocale(m[1]) && m[1] !== defaultLocale) return { locale: m[1], path: m[2] || '/' };
  return { locale: defaultLocale, path: pathname || '/' };
}

/** Replaces {name} placeholders. */
export function fmt(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

/** getStaticPaths helper for pages under src/pages/[...locale]/ (English has no prefix). */
export function localeParams() {
  return locales.map((l) => ({ params: { locale: l === defaultLocale ? undefined : l } }));
}

export function localeFromParam(param: string | undefined): Locale {
  return isLocale(param) ? param : defaultLocale;
}
