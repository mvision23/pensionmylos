export const locales = ['en', 'es', 'fr', 'it', 'de', 'ca', 'nl', 'el', 'ja', 'zh', 'ru', 'ro'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

/** Per-language settings. `name` is how the language calls itself (shown in the selector). */
export const localeInfo: Record<Locale, { name: string; htmlLang: string; dateLocale: string; ogLocale: string }> = {
  en: { name: 'English', htmlLang: 'en', dateLocale: 'en-GB', ogLocale: 'en_GB' },
  es: { name: 'Español', htmlLang: 'es', dateLocale: 'es-ES', ogLocale: 'es_ES' },
  fr: { name: 'Français', htmlLang: 'fr', dateLocale: 'fr-FR', ogLocale: 'fr_FR' },
  it: { name: 'Italiano', htmlLang: 'it', dateLocale: 'it-IT', ogLocale: 'it_IT' },
  de: { name: 'Deutsch', htmlLang: 'de', dateLocale: 'de-DE', ogLocale: 'de_DE' },
  ca: { name: 'Català', htmlLang: 'ca', dateLocale: 'ca-ES', ogLocale: 'ca_ES' },
  nl: { name: 'Nederlands', htmlLang: 'nl', dateLocale: 'nl-NL', ogLocale: 'nl_NL' },
  el: { name: 'Ελληνικά', htmlLang: 'el', dateLocale: 'el-GR', ogLocale: 'el_GR' },
  ja: { name: '日本語', htmlLang: 'ja', dateLocale: 'ja-JP', ogLocale: 'ja_JP' },
  zh: { name: '中文', htmlLang: 'zh-Hans', dateLocale: 'zh-CN', ogLocale: 'zh_CN' },
  ru: { name: 'Русский', htmlLang: 'ru', dateLocale: 'ru-RU', ogLocale: 'ru_RU' },
  ro: { name: 'Română', htmlLang: 'ro', dateLocale: 'ro-RO', ogLocale: 'ro_RO' },
};

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (locales as readonly string[]).includes(v);
