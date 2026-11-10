// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://pensionmylos.com',
  integrations: [
    sitemap({
      // The thank-you pages are conversion URLs, not content.
      filter: (page) => !/\/(thanks|booking-confirmed)\/$/.test(page),
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en', es: 'es', fr: 'fr', it: 'it', de: 'de', ca: 'ca', nl: 'nl', el: 'el', ja: 'ja', zh: 'zh-Hans', ru: 'ru', ro: 'ro' },
      },
    }),
  ],
  image: {
    // Generate srcset/sizes for images without explicit widths — including the
    // photos inside blog Markdown, so phones don't download the 1536px version.
    layout: 'constrained',
  },
  server: {
    // Listen on all interfaces and accept requests addressed to this machine's
    // hostname (applies to `astro dev` and `astro preview`).
    host: true,
    allowedHosts: ['rosepetal-dev-tx'],
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
