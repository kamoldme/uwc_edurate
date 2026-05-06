// Oasis Internationalization — English-only.
// Multilingual scaffolding (RU/UZ) removed; UWC pilot is English-only.
// `t()` is preserved as the lookup function so all the existing call sites
// keep working; new strings can be added directly to public/locales/en.json.
const I18n = {
  locale: 'en',
  translations: {},

  async init() {
    try {
      const res = await fetch('/locales/en.json');
      if (res.ok) this.translations.en = await res.json();
    } catch (err) {
      console.error('i18n: failed to load en.json', err);
      this.translations.en = {};
    }
  },

  t(key, params) {
    const dict = this.translations.en || {};
    let value = dict[key];
    if (value === undefined) return key;
    if (params) {
      Object.keys(params).forEach(k => {
        value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]);
      });
    }
    return value;
  },

  // Kept as no-ops so any legacy callers don't blow up.
  async setLocale() { /* English only */ },
  getLocale() { return 'en'; },
  getAvailableLocales() { return [{ code: 'en', label: 'English' }]; },
};

function t(key, params) {
  return I18n.t(key, params);
}
