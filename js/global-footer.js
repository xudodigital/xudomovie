

const _FOOTER_LANG = localStorage.getItem('xudo_lang') || 'en-US';

const _FOOTER_TRANS = window.XUDO_I18N.FOOTER_TRANS; // moved to js/i18n/translations.js (single source of truth)

const _ft = _FOOTER_TRANS[_FOOTER_LANG] || _FOOTER_TRANS['en-US'];

const FOOTER_COLS = [
    {
        heading : _ft.colMovies,
        links   : [
            { label: _ft.popMovies,  href: `browse.html?endpoint=/movie/popular&title=${encodeURIComponent(_ft.popMovies)}&type=movie`       },
            { label: _ft.nowPlay,    href: `browse.html?endpoint=/movie/now_playing&title=${encodeURIComponent(_ft.nowPlay)}&type=movie`      },
            { label: _ft.upcoming,   href: `browse.html?endpoint=/movie/upcoming&title=${encodeURIComponent(_ft.upcoming)}&type=movie`        },
            { label: _ft.topMovies,  href: `browse.html?endpoint=/movie/top_rated&title=${encodeURIComponent(_ft.topMovies)}&type=movie`      },
        ],
    },
    {
        heading : _ft.colTV,
        links   : [
            { label: _ft.popTV,    href: `browse.html?endpoint=/tv/popular&title=${encodeURIComponent(_ft.popTV)}&type=tv`          },
            { label: _ft.airToday, href: `browse.html?endpoint=/tv/airing_today&title=${encodeURIComponent(_ft.airToday)}&type=tv`  },
            { label: _ft.onAir,    href: `browse.html?endpoint=/tv/on_the_air&title=${encodeURIComponent(_ft.onAir)}&type=tv`       },
            { label: _ft.topTV,    href: `browse.html?endpoint=/tv/top_rated&title=${encodeURIComponent(_ft.topTV)}&type=tv`        },
        ],
    },
    {
        heading : _ft.colCompany,
        links   : [
            { label: _ft.about,   href: 'about.html'          },
            { label: _ft.contact, href: 'contact.html'        },
            { label: _ft.privacy, href: 'privacy-policy.html' },
            { label: _ft.dmca,    href: 'dmca.html'           },
        ],
    },
];

const colsHTML = FOOTER_COLS.map(col => `
    <div class="sk-col">
        <div class="sk-head-xs">${col.heading}</div>
        ${col.links.map(l =>
            `<a href="${l.href}" class="sk-li"${l.blank ? ' target="_blank" rel="noopener noreferrer"' : ''}>${l.label}</a>`
        ).join('\n        ')}
    </div>`).join('');

const ICON_STAR = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="#ffd700" aria-hidden="true"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;

const GLOBAL_FOOTER_CONTENT = `
<div id="xudo-visitor-count" class="visitor-floating" style="display:none;" aria-live="polite" aria-label="Live visitor count"></div>

<footer class="sk-footer">

    <!-- Top bar: branding + app store badges -->
    <div class="sk-footer-top">
        <div class="sk-top-left">
            <h2>${_ft.poweredBy}<br>
                <span class="sk-brand-name">XUDODigital</span>
            </h2>
        </div>
        <div class="sk-top-right">
            <div class="sk-app-icon" aria-hidden="true">X+</div>
            <div class="style-text">
                <div style="font-weight:700; font-size:0.9rem;">${_ft.findUsOn}</div>
                <div style="font-size:0.75rem; color:#ccc; display:flex; align-items:center; gap:5px; margin-top:3px;">
                    4.5 ${ICON_STAR}
                    <span style="color:#666">• ${_ft.downloads}</span>
                </div>
            </div>
            <div class="sk-dl-group">
                <a href="#PlayStore" class="sk-store-link" aria-label="Download on Google Play">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg"
                         alt="Get it on Google Play" class="sk-store-img" loading="lazy">
                </a>
                <a href="#AppStore" class="sk-store-link" aria-label="Download on the App Store">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/3/3c/Download_on_the_App_Store_Badge.svg"
                         alt="Download on the App Store" class="sk-store-img" loading="lazy">
                </a>
            </div>
        </div>
    </div>

    <!-- Link columns -->
    <div class="sk-footer-grid">
        ${colsHTML}
    </div>

    <!-- Brand row (logo) -->
    <div class="sk-brand-row">
        <a href="index.html" class="sk-logo-big" aria-label="XUDOMovie Home">XUDO<span>Movie</span></a>
    </div>

    <!-- Legal / attribution -->
    <div class="sk-bottom-info">
        <div class="sk-office-box">
            <div class="sk-office-title">${_ft.tmdbTitle}</div>
            <p>${_ft.tmdbText}</p>
        </div>
        <div class="sk-about-box">
            <div class="sk-office-title">${_ft.quickLinks}</div>
            <p>
                <a href="about.html" style="color:inherit; margin-right:14px;">${_ft.about}</a>
                <a href="contact.html" style="color:inherit; margin-right:14px;">${_ft.contactShort}</a>
                <a href="privacy-policy.html" style="color:inherit; margin-right:14px;">${_ft.privacy}</a>
                <a href="dmca.html" style="color:inherit;">${_ft.dmca}</a>
            </p>
            <p style="margin-top:10px;">${_ft.disclaimer}
               &copy; ${new Date().getFullYear()} XUDODigital. ${_ft.rights}</p>
        </div>
    </div>

</footer>`;

(function () {
    const placeholder = document.getElementById('global-footer-placeholder');
    if (placeholder) {
        placeholder.outerHTML = GLOBAL_FOOTER_CONTENT;
    }
})();
