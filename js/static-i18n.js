/**
 * static-i18n.js — Translations for static pages (about, contact, dmca, privacy-policy, 404)
 * Detects current page via location.pathname, applies translated text by element ID.
 */
(function () {
    'use strict';

    const lang = localStorage.getItem('xudo_lang') || 'en-US';
    const path = location.pathname;

    const ABOUT = window.XUDO_I18N.STATIC.ABOUT; // moved to js/i18n/translations.js (single source of truth)

    function applyAbout() {
        const t = ABOUT[lang] || ABOUT['en-US'];
        const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
        set('sp-title', t.title);
        set('sp-lead', t.lead);
        set('sp-h-offer', t.hOffer);
        const list = document.getElementById('sp-offer-list');
        if (list) list.innerHTML = t.offer.map(i => `<li>${i}</li>`).join('');
        set('sp-h-data', t.hData);
        set('sp-data', t.data);
        set('sp-h-policy', t.hPolicy);
        set('sp-policy', t.policy);
        set('sp-h-contact', t.hContact);
        set('sp-contact', `${t.contactPre} <a href="contact.html">${t.contactLinkText}</a>.`);
    }

    if (path.includes('about.html')) applyAbout();

    const CONTACT = window.XUDO_I18N.STATIC.CONTACT; // moved to js/i18n/translations.js (single source of truth)

    function applyContact() {
        const t = CONTACT[lang] || CONTACT['en-US'];
        const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
        set('sp-title', t.title);
        set('sp-lead', t.lead);
        set('sp-h-general', t.hGeneral);
        set('sp-general', `${t.generalPre} <a href="mailto:hello@xudomovie.us">hello@xudomovie.us</a>`);
        set('sp-h-dmca', t.hDmca);
        set('sp-dmca', `${t.dmcaPre} <a href="dmca.html">${t.dmcaLinkText}</a> ${t.dmcaMid} <a href="mailto:dmca@xudomovie.us">dmca@xudomovie.us</a>`);
        set('sp-h-partnership', t.hPartnership);
        set('sp-partnership', `${t.partnershipPre} <a href="mailto:business@xudomovie.us">business@xudomovie.us</a>`);
        set('sp-h-response', t.hResponse);
        set('sp-response', t.response);
    }

    if (path.includes('contact.html')) applyContact();

    const DMCA = window.XUDO_I18N.STATIC.DMCA; // moved to js/i18n/translations.js (single source of truth)

    function applyDmca() {
        const t = DMCA[lang] || DMCA['en-US'];
        const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
        set('sp-title', t.title);
        set('sp-lead', t.lastUpdated);
        set('sp-intro', t.intro);
        set('sp-h-1', t.h1); set('sp-1', t.p1);
        set('sp-h-2', t.h2); set('sp-2', t.p2);
        set('sp-h-3', t.h3);
        set('sp-3', `${t.p3Pre} <a href="mailto:dmca@xudomovie.us">dmca@xudomovie.us</a>:`);
        set('sp-h-4', t.h4);
        set('sp-4', `${t.p4Pre} <a href="mailto:dmca@xudomovie.us">dmca@xudomovie.us</a> ${t.p4Suffix}`);
        set('sp-h-5', t.h5); set('sp-5', t.p5);
        set('sp-h-6', t.h6); set('sp-6', t.p6);
        set('sp-h-7', t.h7);
        set('sp-7', `${t.p7Pre} <a href="mailto:dmca@xudomovie.us">dmca@xudomovie.us</a>`);
    }

    if (path.includes('dmca.html')) applyDmca();

    const PRIVACY = window.XUDO_I18N.STATIC.PRIVACY; // moved to js/i18n/translations.js (single source of truth)

    const PRIVACY_LIST_EN = window.XUDO_I18N.STATIC.PRIVACY_LIST_EN; // moved to js/i18n/translations.js (single source of truth)

    function applyPrivacy() {
        const t = PRIVACY[lang] || PRIVACY['en-US'];
        const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
        set('sp-title', t.title);
        set('sp-lead', t.lastUpdated);
        set('sp-intro', t.intro);
        set('sp-h-1', t.h1);
        set('sp-1a', `<strong>${t.p1aLabel}</strong> ${t.p1aRest}`);
        set('sp-1b', `<strong>${t.p1bLabel}</strong> ${t.p1bRest}`);
        set('sp-1c', `<strong>${t.p1cLabel}</strong> ${t.p1cRest}`);
        set('sp-h-2', t.h2); set('sp-2', t.p2);
        set('sp-h-3', t.h3);
        set('sp-3-list', PRIVACY_LIST_EN); // kept in English — dense legal/technical third-party citations
        set('sp-h-4', t.h4); set('sp-4', t.p4);
        set('sp-h-5', t.h5); set('sp-5', t.p5);
        set('sp-h-6', t.h6); set('sp-6', t.p6);
        set('sp-h-7', t.h7);
        set('sp-7', `${t.p7Pre} <a href="contact.html">${t.p7LinkText}</a>.`);
    }

    if (path.includes('privacy-policy.html')) applyPrivacy();

    const NOT_FOUND = window.XUDO_I18N.STATIC.NOT_FOUND; // moved to js/i18n/translations.js (single source of truth)

    function applyNotFound() {
        const t = NOT_FOUND[lang] || NOT_FOUND['en-US'];
        const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
        set('sp-desc', t.desc);
        set('sp-home', t.home);
    }

    if (path.includes('404.html')) applyNotFound();
})();
