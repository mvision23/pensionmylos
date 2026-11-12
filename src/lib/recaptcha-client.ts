/**
 * Browser side of Google reCAPTCHA, shared by the contact form and the
 * booking form. Nothing is loaded at page load: each form calls loadV3() when
 * it is about to be used, and loadChallenge() only after the server reported
 * a low score (the Enterprise "I'm not a robot" checkbox).
 */
export type Grecaptcha = {
  ready: (cb: () => void) => void;
  execute: (siteKey: string, opts: { action: string }) => Promise<string>;
  render: (el: HTMLElement, opts: Record<string, unknown>) => number;
  getResponse: (widgetId?: number) => string;
  reset: (widgetId?: number) => void;
};

const LOAD_TIMEOUT = 20_000;
const loads = new Map<string, Promise<Grecaptcha>>();

/** Injects a reCAPTCHA script once and resolves with its API object once ready. A failed load is forgotten so the next attempt retries. */
function loadScript(src: string, pick: (w: any) => Grecaptcha | undefined): Promise<Grecaptcha> {
  let p = loads.get(src);
  if (!p) {
    p = new Promise<Grecaptcha>((resolve, reject) => {
      const fail = () => {
        clearTimeout(timer);
        loads.delete(src);
        reject(new Error(`failed to load ${src}`));
      };
      const timer = setTimeout(fail, LOAD_TIMEOUT);
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onerror = fail;
      script.onload = () => {
        const g = pick(window);
        if (!g) return fail();
        g.ready(() => { clearTimeout(timer); resolve(g); });
      };
      document.head.appendChild(script);
    });
    loads.set(src, p);
  }
  return p;
}

/** Invisible v3 (classic api.js). */
export const loadV3 = (siteKey: string, hl: string) =>
  loadScript(`https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}&hl=${encodeURIComponent(hl)}`, (w) => w.grecaptcha);

/** Enterprise checkbox (enterprise.js), for the low-score challenge. */
export const loadChallenge = (hl: string) =>
  loadScript(`https://www.google.com/recaptcha/enterprise.js?render=explicit&hl=${encodeURIComponent(hl)}`, (w) => w.grecaptcha?.enterprise);

/** Google's language code for one of ours. */
export const recaptchaLang = (locale: string) => (locale === 'zh' ? 'zh-CN' : locale);
