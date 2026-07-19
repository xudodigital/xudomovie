

const _LANG_OPTIONS = [
    
    { code: 'en-US', flagSrc: 'https://flagcdn.com/us.svg', label: 'EN', name: 'English'    },  
    
    { code: 'ar-SA', flagSrc: 'https://flagcdn.com/sa.svg', label: 'AR', name: 'العربية'    },  
    { code: 'bn-BD', flagSrc: 'https://flagcdn.com/bd.svg', label: 'BN', name: 'বাংলা'      },  
    { code: 'zh-CN', flagSrc: 'https://flagcdn.com/cn.svg', label: 'CN', name: '中文(简)'   },  
    { code: 'zh-TW', flagSrc: 'https://flagcdn.com/tw.svg', label: 'TW', name: '中文(繁)'   },  
    { code: 'tl-PH', flagSrc: 'https://flagcdn.com/ph.svg', label: 'PH', name: 'Filipino'   },  
    { code: 'fr-FR', flagSrc: 'https://flagcdn.com/fr.svg', label: 'FR', name: 'Français'   },  
    { code: 'hi-IN', flagSrc: 'https://flagcdn.com/in.svg', label: 'HI', name: 'हिन्दी'     },  
    { code: 'id-ID', flagSrc: 'https://flagcdn.com/id.svg', label: 'ID', name: 'Indonesia'  },  
    { code: 'ja-JP', flagSrc: 'https://flagcdn.com/jp.svg', label: 'JP', name: '日本語'      },  
    { code: 'km-KH', flagSrc: 'https://flagcdn.com/kh.svg', label: 'KH', name: 'ខ្មែរ'      },  
    { code: 'ko-KR', flagSrc: 'https://flagcdn.com/kr.svg', label: 'KR', name: '한국어'      },  
    { code: 'ms-MY', flagSrc: 'https://flagcdn.com/my.svg', label: 'MY', name: 'Melayu'     },  
    { code: 'pt-BR', flagSrc: 'https://flagcdn.com/br.svg', label: 'PT', name: 'Português'  },  
    { code: 'ru-RU', flagSrc: 'https://flagcdn.com/ru.svg', label: 'RU', name: 'Русский'    },  
    { code: 'es-ES', flagSrc: 'https://flagcdn.com/es.svg', label: 'ES', name: 'Español'    },  
    { code: 'th-TH', flagSrc: 'https://flagcdn.com/th.svg', label: 'TH', name: 'ภาษาไทย'   },  
    { code: 'tr-TR', flagSrc: 'https://flagcdn.com/tr.svg', label: 'TR', name: 'Türkçe'     },  
    { code: 'vi-VN', flagSrc: 'https://flagcdn.com/vn.svg', label: 'VI', name: 'Tiếng Việt' },  
];

const _currentLangCode = localStorage.getItem('xudo_lang') || 'en-US';
const _currentLangData = _LANG_OPTIONS.find(l => l.code === _currentLangCode) || _LANG_OPTIONS[0];

const ICON_CHEVRON = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;

const _langDropdownHTML = `
<div class="lang-selector" id="lang-selector">
    <button class="lang-btn" id="lang-btn" aria-label="Select language" aria-expanded="false" aria-haspopup="listbox">
        <img class="lang-flag" src="${_currentLangData.flagSrc}" alt="${_currentLangData.name}" loading="lazy">
        <span class="lang-code">${_currentLangData.label}</span>
        ${ICON_CHEVRON}
    </button>
    <div class="lang-dropdown" id="lang-dropdown" role="listbox" aria-label="Select language" aria-hidden="true">
        <button class="lang-option lang-option--featured${_LANG_OPTIONS[0].code === _currentLangCode ? ' active' : ''}" data-lang="${_LANG_OPTIONS[0].code}" role="option" aria-selected="${_LANG_OPTIONS[0].code === _currentLangCode}">
            <img class="lang-flag" src="${_LANG_OPTIONS[0].flagSrc}" alt="${_LANG_OPTIONS[0].name}" loading="lazy">
            ${_LANG_OPTIONS[0].name}
        </button>
        <div class="lang-divider" role="separator"></div>
        ${_LANG_OPTIONS.slice(1).map(l => `
        <button class="lang-option${l.code === _currentLangCode ? ' active' : ''}" data-lang="${l.code}" role="option" aria-selected="${l.code === _currentLangCode}">
            <img class="lang-flag" src="${l.flagSrc}" alt="${l.name}" loading="lazy">
            ${l.name}
        </button>`).join('')}
    </div>
</div>`;

const ICON_SEARCH = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

const ICON_HEART = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;

const ICON_CLOCK = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

const GLOBAL_HEADER_CONTENT = `
<header class="movie-header" role="banner">

    <!-- Logo (left column) -->
    <a href="index.html" class="logo" aria-label="XUDOMovie Home">XUDO<span>Movie</span></a>

    <!-- Search (centre column) -->
    <div class="search-wrapper" role="search">
        <input
            type="search"
            id="search-input"
            class="search-input"
            placeholder="Search movies or TV shows…"
            autocomplete="off"
            aria-label="Search movies or TV shows"
        >
        <button id="clear-btn" class="search-clear" aria-label="Clear search" title="Clear">✕</button>
        <button class="search-btn" aria-label="Submit search">${ICON_SEARCH}</button>
        <div id="search-dropdown" class="search-dropdown" role="listbox" aria-label="Search suggestions"></div>
    </div>

    <!-- Right icons (right column) -->
    <div class="header-icons">
        <a href="browse.html?type=favorites" class="header-fav-btn" aria-label="My Favorites" title="Favorites">
            ${ICON_HEART}
        </a>
        <a href="browse.html?type=watchlater" class="header-fav-btn" aria-label="Watch Later" title="Watch Later">
            ${ICON_CLOCK}
        </a>
        ${_langDropdownHTML}
    </div>

</header>
`;

(function () {
    const placeholder = document.getElementById('global-header-placeholder');
    if (!placeholder) return;

    placeholder.outerHTML = GLOBAL_HEADER_CONTENT;

    
    document.dispatchEvent(new CustomEvent('header-loaded'));
})();
