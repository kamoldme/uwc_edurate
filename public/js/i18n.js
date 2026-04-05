// Oasis Internationalization System
const I18n = {
  locale: 'en',
  translations: {},
  loaded: {},

  async init() {
    this.locale = localStorage.getItem('oasis_lang') || 'en';
    await this.loadLocale(this.locale);
  },

  async loadLocale(lang) {
    if (this.loaded[lang]) return;
    try {
      const res = await fetch(`/locales/${lang}.json`);
      if (!res.ok) throw new Error(`Failed to load ${lang}`);
      this.translations[lang] = await res.json();
      this.loaded[lang] = true;
    } catch (err) {
      console.error(`i18n: failed to load locale ${lang}`, err);
      if (lang !== 'en') await this.loadLocale('en');
    }
  },

  t(key, params) {
    const dict = this.translations[this.locale] || this.translations['en'] || {};
    let value = dict[key];
    if (value === undefined) return key;
    if (params) {
      Object.keys(params).forEach(k => {
        value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]);
      });
    }
    return value;
  },

  async setLocale(lang) {
    if (!['en', 'ru'].includes(lang)) return;
    await this.loadLocale(lang);
    this.locale = lang;
    localStorage.setItem('oasis_lang', lang);
    // Sync to server if logged in
    const token = localStorage.getItem('oasis_token');
    if (token) {
      try {
        await fetch('/api/auth/language', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ language: lang })
        });
      } catch (e) { /* silent */ }
    }
  },

  getLocale() {
    return this.locale;
  },

  getAvailableLocales() {
    return [
      { code: 'en', label: 'English', flag: '🇬🇧' },
      { code: 'ru', label: 'Русский', flag: '🇷🇺' }
    ];
  }
};

function t(key, params) {
  return I18n.t(key, params);
}
