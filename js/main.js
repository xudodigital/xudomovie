
const INJECTED = window.XUDO_CONFIG || {};

const CONFIG = {
    AUTHORITY_DOMAIN: INJECTED.authority || window.location.hostname,
    get AUTHORITY_URL() { return 'https://' + this.AUTHORITY_DOMAIN; },
    IS_LOCALHOST: ['localhost', '127.0.0.1'].includes(window.location.hostname),
    isAuthority() { return window.location.hostname === this.AUTHORITY_DOMAIN; }
    // TMDB_API_KEY removed from client config on purpose: the real key now
    // lives only in the Cloudflare Pages env var TMDB_API_KEY, read
    // server-side by functions/api/tmdb/[[path]].js. All TMDB requests below
    // go through that proxy instead of calling api.themoviedb.org directly.
};

const BASE_URL   = '/api/tmdb';
const IMG_HD     = 'https://image.tmdb.org/t/p/original';
const IMG_POSTER = 'https://image.tmdb.org/t/p/w500';
const IMG_THUMB  = 'https://image.tmdb.org/t/p/w92';
const IMG_STILL  = 'https://image.tmdb.org/t/p/w300';
const CURRENT_LANG = localStorage.getItem('xudo_lang') || 'en-US';

const TRANSLATIONS = window.XUDO_I18N.TRANSLATIONS; // moved to js/i18n/translations.js (single source of truth)

const TEXTS = TRANSLATIONS[CURRENT_LANG] || TRANSLATIONS['en-US'];

function trackEvent(eventName, params = {}) {
    try {
        if (typeof gtag === 'function') {
            gtag('event', eventName, params);
        }
    } catch (_) {}
}

function trackPageView(title, path) {
    try {
        if (typeof gtag === 'function') {
            gtag('event', 'page_view', {
                page_title    : title,
                page_location : window.location.origin + (path || window.location.pathname + window.location.search),
                page_path     : path || window.location.pathname + window.location.search,
            });
        }
    } catch (_) {}
}

function initScrollDepthTracking() {
    const thresholds = [25, 50, 75, 100];
    const fired      = new Set();
    window.addEventListener('scroll', () => {
        const total   = document.documentElement.scrollHeight - window.innerHeight;
        if (total <= 0) return;
        const percent = Math.round((window.scrollY / total) * 100);
        thresholds.forEach(t => {
            if (percent >= t && !fired.has(t)) {
                fired.add(t);
                trackEvent('scroll_depth', { percent: t, page_path: window.location.pathname });
            }
        });
    }, { passive: true });
}

(async function autoDetectLanguage() {
    if (localStorage.getItem('xudo_lang')) return;   

    const COUNTRY_LANG = {
        'VN': 'vi-VN',   
        'ID': 'id-ID',   
        'BD': 'bn-BD',   
        'KH': 'km-KH',   
        'TH': 'th-TH',   
        'MY': 'ms-MY',   
        'PH': 'tl-PH',   
        'IN': 'hi-IN',   
        'CN': 'zh-CN',   
        'TW': 'zh-TW',   
        'HK': 'zh-TW',   
        'MO': 'zh-TW',   
        'JP': 'ja-JP',   
        'KR': 'ko-KR',   
        'SA': 'ar-SA',   
        'AE': 'ar-SA',   
        'EG': 'ar-SA',   
        'IQ': 'ar-SA',   
        'KW': 'ar-SA',   
        'QA': 'ar-SA',   
        'BR': 'pt-BR',   
        'ES': 'es-ES',   
        'MX': 'es-ES',   
        'AR': 'es-ES',   
        'CO': 'es-ES',   
        'FR': 'fr-FR',   
        'TR': 'tr-TR',   
        'RU': 'ru-RU',   
    };

    try {
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 3000);   
        const res   = await fetch('https://ipapi.co/country/', { signal: ctrl.signal });
        clearTimeout(timer);
        const country = (await res.text()).trim().toUpperCase();
        const lang    = COUNTRY_LANG[country] || 'en-US';
        localStorage.setItem('xudo_lang', lang);
        if (lang !== 'en-US') location.reload();    
    } catch (_) {
        localStorage.setItem('xudo_lang', 'en-US'); 
    }
})();

const GENRE_HARDCODED = window.XUDO_I18N.GENRE_HARDCODED; // moved to js/i18n/translations.js (single source of truth)

const DEPT_LABELS = {
    'Acting'          : 'Actor',
    'Directing'       : 'Director',
    'Writing'         : 'Writer',
    'Production'      : 'Producer',
    'Editing'         : 'Editor',
    'Camera'          : 'Cinematographer',
    'Sound'           : 'Sound',
    'Art'             : 'Art Director',
    'Visual Effects'  : 'Visual Effects',
    'Costume & Make-Up': 'Costume & Make-Up',
    'Crew'            : 'Crew',
    'Lighting'        : 'Lighting'
};

function deptLabel(dept) {
    return DEPT_LABELS[dept] || dept || 'Actor';
}

let currentPage = 1,
    isLoading = false,
    currentSeason = 1,
    currentEpisode = 1,
    currentServer = 1,
    currentAnimeDubType = 'sub';
let currentBrowseEndpoint = '',
    currentMediaType = 'movie',
    currentGenreId = null,
    _categoryBaseEndpoint = null,   // current toggle-state base for country-browse pages
    searchDebounceTimer;
let LOCAL_SEARCH_INDEX = [];
let searchCurrentPage = 1,
    searchQuery = '',
    searchTotalPages = 1;
let searchAllItems = [];
let searchSortBy  = 'relevance';
let currentSortBy = 'popularity.desc';

function sanitizeHTML(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function updateCanonical() {
    const staticCanonical = document.querySelector("link[rel='canonical']");
    if (staticCanonical && !CONFIG.IS_LOCALHOST && staticCanonical.href.includes(CONFIG.AUTHORITY_DOMAIN)) return;
    let link = document.querySelector("link[rel='canonical']") || document.createElement('link');
    link.rel = 'canonical';
    const relativePath = window.location.pathname + window.location.search;
    link.href = CONFIG.IS_LOCALHOST ? window.location.href : CONFIG.AUTHORITY_URL + relativePath;
    if (!link.parentNode) document.head.appendChild(link);
}

function updateSEOMeta(title, description) {
    document.title = title;
    let meta = document.querySelector('meta[name="description"]') || document.createElement('meta');
    meta.name    = 'description';
    meta.content = sanitizeHTML(description);
    if (!meta.parentNode) document.head.appendChild(meta);
}

function initContentProtection() {
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('dragstart',   e => e.preventDefault());
    document.addEventListener('keydown', e => {
        const blocked = ['F12', 'I', 'i', 'J', 'j', 'U', 'u', 'S', 's', 'P', 'p'];
        if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && blocked.includes(e.key))) {
            e.preventDefault();
            return false;
        }
    });
}

function isFavorite(id) {
    return (JSON.parse(localStorage.getItem('xudo_favs')) || []).some(f => f.id == id);
}

function isWatchLater(id) {
    return (JSON.parse(localStorage.getItem('xudo_watch_later')) || []).some(f => f.id == id);
}

function updateContinueWatching(item) {
    setTimeout(() => {
        let history = JSON.parse(localStorage.getItem('xudo_history')) || [];
        const existing = history.find(x => x.id == item.id);
        history = history.filter(x => x.id !== item.id);

        const s = typeof currentSeason  !== 'undefined' ? currentSeason  : 1;
        const e = typeof currentEpisode !== 'undefined' ? currentEpisode : 1;

        history.unshift({
            id     : item.id,
            type   : item.media_type || (item.title ? 'movie' : 'tv'),
            title  : item.title || item.name,
            poster : item.poster_path
                ? (item.poster_path.startsWith('http') ? item.poster_path : IMG_POSTER + item.poster_path)
                : 'https://via.placeholder.com/500',
            year    : (item.release_date || item.first_air_date || '').split('-')[0],
            rating  : item.vote_average,
            season  : s,
            episode : e,
        });
        if (history.length > 20) history.pop();
        localStorage.setItem('xudo_history', JSON.stringify(history));
    }, 5000);
}

function getTargetUrl(item) {
    const type      = item.media_type || (item.title ? 'movie' : 'tv');
    const localFile = LOCAL_SEARCH_INDEX.find(x => x.id == item.id && x.type == type);
    let extraParams = '';
    if (type === 'tv' && item.season && item.episode) {
        extraParams = `&s=${item.season}&e=${item.episode}`;
    }
    return localFile
        ? `${localFile.folder}/${localFile.slug}.html${extraParams ? '?' + extraParams.substring(1) : ''}`
        : `watch.html?type=${type}&id=${item.id}${extraParams}`;
}

window.clearHistory = () => {
    if (confirm(TEXTS.confirmClear)) {
        localStorage.removeItem('xudo_history');
        document.getElementById('continue-watching-section')?.remove();
    }
};

function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id        = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 3000);
}

function initThemeToggle() {
    const btn      = document.getElementById('theme-toggle');
    if (!btn) return;
    const iconSun  = document.getElementById('theme-icon-sun');
    const iconMoon = document.getElementById('theme-icon-moon');

    function applyTheme(theme) {
        if (theme === 'light') {
            document.body.setAttribute('data-theme', 'light');
            if (iconSun)  iconSun.style.display  = 'block';
            if (iconMoon) iconMoon.style.display = 'none';
        } else {
            document.body.removeAttribute('data-theme');
            if (iconSun)  iconSun.style.display  = 'none';
            if (iconMoon) iconMoon.style.display = 'block';
        }
        localStorage.setItem('xudo_theme', theme);
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) metaTheme.content = theme === 'light' ? '#f5f5f5' : '#0f0f0f';
    }

    const saved = localStorage.getItem('xudo_theme') || 'dark';
    applyTheme(saved);
    btn.addEventListener('click', () => {
        const next = (localStorage.getItem('xudo_theme') || 'dark') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        trackEvent('theme_change', { theme: next });
    });
}

function initHeaderScroll() {
    window.addEventListener('scroll', () => {
        const header = document.querySelector('.movie-header');
        if (header) header.classList.toggle('scrolled', window.scrollY > 50);
    }, { passive: true });
}

(function purgeStalHardcodedGenreCache() {
    if (!GENRE_HARDCODED[CURRENT_LANG]) return;
    const stampKey = `xudo_genre_hc_v1_${CURRENT_LANG}`;
    if (!localStorage.getItem(stampKey)) {
        ['movie', 'tv'].forEach(t => localStorage.removeItem(`xudo_genres_${CURRENT_LANG}_${t}`));
        localStorage.setItem(stampKey, '1');
    }
})();

function initLanguageSelector() {
    const btn      = document.getElementById('lang-btn');
    const dropdown = document.getElementById('lang-dropdown');
    const selector = document.getElementById('lang-selector');
    if (!btn || !dropdown) return;

    const searchInput = document.getElementById('search-input');
    if (searchInput && TEXTS.searchPlaceholder) {
        searchInput.placeholder = TEXTS.searchPlaceholder;
    }

    function closeDropdown() {
        dropdown.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        dropdown.setAttribute('aria-hidden', 'true');
    }

    btn.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = dropdown.classList.toggle('open');
        btn.setAttribute('aria-expanded', String(isOpen));
        dropdown.setAttribute('aria-hidden', String(!isOpen));
    });

    dropdown.addEventListener('click', e => {
        const option = e.target.closest('.lang-option');
        if (!option) return;
        const lang = option.dataset.lang;
        if (lang && lang !== CURRENT_LANG) {
            trackEvent('language_change', { from: CURRENT_LANG, to: lang });
            localStorage.setItem('xudo_lang', lang);
            location.reload();
        } else {
            closeDropdown();
        }
    });

    document.addEventListener('click', e => {
        if (selector && !selector.contains(e.target)) closeDropdown();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeDropdown();
    });
}

function initSearchEvents() {
    const input = document.getElementById('search-input');
    if (!input) return;

    const q = new URLSearchParams(window.location.search).get('search');
    if (q) {
        input.value = sanitizeHTML(q);
        document.getElementById('clear-btn').classList.add('show-flex');
    }

    let drop = document.getElementById('search-dropdown');
    if (!drop) {
        drop = document.createElement('div');
        drop.id        = 'search-dropdown';
        drop.className = 'search-dropdown';
        document.querySelector('.search-wrapper').appendChild(drop);
    }

    input.addEventListener('input', (e) => {
        document.getElementById('clear-btn').classList.toggle('show-flex', e.target.value.trim().length > 0);
        clearTimeout(searchDebounceTimer);
        const query = e.target.value.trim();
        if (query.length < 2) { drop.classList.remove('active'); return; }
        searchDebounceTimer = setTimeout(() => fetchLiveSearch(query), 300);
    });

    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') executeSearch(); });

    document.addEventListener('click', (e) => {
        if (!document.querySelector('.search-wrapper').contains(e.target)) {
            drop.classList.remove('active');
        }
    });

    document.getElementById('clear-btn').addEventListener('click', clearSearch);
    document.querySelector('.search-btn').addEventListener('click', executeSearch);
}

window.toggleClearButton = function () {
    const input = document.getElementById('search-input');
    document.getElementById('clear-btn').classList.toggle('show-flex', input.value.trim().length > 0);
};

window.clearSearch = function () {
    const input = document.getElementById('search-input');
    input.value = '';
    document.getElementById('clear-btn').classList.remove('show-flex');
    document.getElementById('search-dropdown').classList.remove('active');
};

window.executeSearch = function () {
    const q = document.getElementById('search-input').value.trim();
    if (q) {
        trackEvent('search', { search_term: q });
        window.location.href = `index.html?search=${encodeURIComponent(q)}`;
    }
};

async function fetchLiveSearch(query) {
    const dropdown = document.getElementById('search-dropdown');
    try {
        const res  = await fetch(`${BASE_URL}/search/multi?language=${CURRENT_LANG}&query=${encodeURIComponent(query)}`);
        const data = await res.json();
        const seenIds = new Set();
        const results = data.results || [];

        const mediaItems  = [];
        const personItems = [];
        results.forEach(i => {
            if (i.media_type === 'movie' || i.media_type === 'tv') {
                if (i.poster_path && !seenIds.has(i.id)) { mediaItems.push(i); seenIds.add(i.id); }
            } else if (i.media_type === 'person') {
                if (i.profile_path) personItems.push(i);
                if (i.known_for) {
                    i.known_for.forEach(media => {
                        if ((media.media_type === 'movie' || media.media_type === 'tv') && media.poster_path && !seenIds.has(media.id)) {
                            mediaItems.push(media);
                            seenIds.add(media.id);
                        }
                    });
                }
            }
        });

        const topMedia   = mediaItems.slice(0, 6);
        const topPersons = personItems.slice(0, 2);
        if (!topMedia.length && !topPersons.length) { dropdown.classList.remove('active'); return; }

        let html = '';

        html += topPersons.map(p => {
            const name  = sanitizeHTML(p.name);
            const dept  = sanitizeHTML(deptLabel(p.known_for_department));
            const photo = IMG_THUMB + p.profile_path;
            return `<a href="person.html?id=${p.id}" class="search-item search-item-actor">
                <img src="${photo}" alt="${name}" style="border-radius:50%;width:40px;height:40px;object-fit:cover;">
                <div class="search-item-info" style="flex:1;">
                    <span class="search-item-title">${name}</span>
                    <span class="search-item-meta">${dept} · VIEW FILMOGRAPHY</span>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
            </a>`;
        }).join('');

        html += topMedia.map(i => {
            const title      = sanitizeHTML(i.title || i.name);
            const year       = sanitizeHTML((i.release_date || i.first_air_date || '').split('-')[0] || '');
            const poster     = IMG_THUMB + i.poster_path;
            const targetLink = getTargetUrl(i);
            return `<div class="search-item">
                <a href="${targetLink}" class="search-item-link">
                    <img src="${poster}" alt="${title}">
                    <div class="search-item-info">
                        <span class="search-item-title">${title}</span>
                        <span class="search-item-meta">${year} · ${i.media_type === 'movie' ? TEXTS.typeMovie : TEXTS.typeTv}</span>
                    </div>
                </a>
                <button class="search-fav-btn ${isFavorite(i.id) ? 'active' : ''}"
                    onclick="toggleFavoriteCore(${i.id},'${i.media_type}','${title.replace(/'/g,"\\'")}','${(IMG_POSTER+i.poster_path).replace(/'/g,"\\'")}','${year}','${i.vote_average?i.vote_average.toFixed(1):'NR'}',this)">
                    ${isFavorite(i.id) ? '❤️' : '🤍'}
                </button>
            </div>`;
        }).join('');

        html += `<a href="index.html?search=${encodeURIComponent(query)}" class="search-see-all">See all results for "<strong>${sanitizeHTML(query)}</strong>" ›</a>`;
        dropdown.innerHTML = html;
        dropdown.classList.add('active');
    } catch (_) {
        dropdown.classList.remove('active');
    }
}

async function performSearch(q, append = false) {
    const main = document.getElementById('main-content');
    if (!append) {
        searchCurrentPage = 1;
        searchQuery       = q;
        searchAllItems    = [];
        searchSortBy      = 'relevance';
        main.innerHTML = `
            <div class="media-grid-container">
                <h2 class="page-title">Searching...</h2>
                <div class="search-sort-bar" id="search-sort-bar" style="display:none;">
                    <span class="server-label">${TEXTS.sortLabel}</span>
                    <div class="server-control">
                        <button class="server-btn active" onclick="applySortToSearch('relevance',this)">${TEXTS.sortRelevance}</button>
                        <button class="server-btn" onclick="applySortToSearch('popular',this)">${TEXTS.sortPopular}</button>
                        <button class="server-btn" onclick="applySortToSearch('newest',this)">${TEXTS.sortNewest}</button>
                        <button class="server-btn" onclick="applySortToSearch('oldest',this)">${TEXTS.sortOldest}</button>
                        <button class="server-btn" onclick="applySortToSearch('rating',this)">${TEXTS.sortRating}</button>
                    </div>
                </div>
                <div id="actor-cards-container"></div>
                <div id="search-grid" class="media-grid"></div>
                <div class="load-more-container">
                    <button id="search-load-more" class="load-more-btn" style="display:none;">${TEXTS.loadMore}</button>
                </div>
            </div>`;
        renderSkeletons('search-grid', 10);
        attachCardDelegation('#search-grid');
    }

    try {
        const res = await fetch(`${BASE_URL}/search/multi?language=${CURRENT_LANG}&query=${encodeURIComponent(q)}&page=${searchCurrentPage}`);
        if (!res.ok) throw new Error('Search API failed');
        const d = await res.json();
        searchTotalPages = d.total_pages;

        const seenIds = new Set();
        const mediaItems = [], personItems = [];
        (d.results || []).forEach(i => {
            if (i.media_type === 'movie' || i.media_type === 'tv') {
                if (i.poster_path && !seenIds.has(i.id)) { mediaItems.push(i); seenIds.add(i.id); }
            } else if (i.media_type === 'person') {
                if (i.profile_path) personItems.push(i);
                if (i.known_for) {
                    i.known_for.forEach(media => {
                        if ((media.media_type === 'movie' || media.media_type === 'tv') && media.poster_path && !seenIds.has(media.id)) {
                            mediaItems.push(media);
                            seenIds.add(media.id);
                        }
                    });
                }
            }
        });

        if (!append) {
            const titleEl = main.querySelector('.page-title');
            if (titleEl) titleEl.textContent = `Results for: "${sanitizeHTML(q)}"`;
        }

        if (!append && personItems.length > 0) {
            const actorContainer = document.getElementById('actor-cards-container');
            if (actorContainer) {
                actorContainer.innerHTML = personItems.slice(0, 3).map(p => createActorCardHTML(p)).join('');
            }
            const creditFetches   = personItems.slice(0, 3).map(p => fetchPersonCreditsForSearch(p.id, seenIds));
            const allCreditArrays = await Promise.allSettled(creditFetches);
            allCreditArrays.forEach(r => { if (r.status === 'fulfilled' && Array.isArray(r.value)) mediaItems.push(...r.value); });
        }

        const allItems = [...mediaItems];
        if (allItems.length) {
            searchAllItems = [...searchAllItems, ...allItems];
            const sortBar = document.getElementById('search-sort-bar');
            if (sortBar) sortBar.style.display = 'flex';
            renderSearchGrid(searchAllItems);
        } else if (!append) {
            document.getElementById('search-grid').innerHTML = '<div class="no-results">No results found.</div>';
        }

        const lmBtn = document.getElementById('search-load-more');
        if (lmBtn) {
            if (searchCurrentPage < searchTotalPages) {
                lmBtn.style.display = 'inline-block';
                lmBtn.textContent   = TEXTS.loadMore;
                lmBtn.onclick = () => {
                    searchCurrentPage++;
                    lmBtn.textContent = TEXTS.loading;
                    lmBtn.disabled    = true;
                    performSearch(searchQuery, true).then(() => { lmBtn.disabled = false; });
                };
            } else {
                lmBtn.style.display = 'none';
            }
        }
    } catch (error) {
        const grid = document.getElementById('search-grid');
        if (grid) grid.innerHTML = '<div class="no-results" style="color:var(--main-red);">Error fetching results. Please try again.</div>';
    }
}

function createActorCardHTML(person) {
    const name  = sanitizeHTML(person.name);
    const dept  = sanitizeHTML(deptLabel(person.known_for_department));
    const photo = person.profile_path
        ? IMG_POSTER + person.profile_path
        : "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='220' height='330' viewBox='0 0 220 330' fill='%231a1a1a'%3e%3crect width='220' height='330' fill='%231a1a1a'/%3e%3ccircle cx='110' cy='120' r='50' fill='%23333'/%3e%3cellipse cx='110' cy='280' rx='80' ry='60' fill='%23333'/%3e%3c/svg%3e"
    return `<div class="actor-search-card" onclick="location.href='person.html?id=${person.id}'" style="cursor:pointer;">
        <img src="${photo}" alt="${name}" class="actor-search-photo" loading="lazy" onerror="this.onerror=null;this.src='https://via.placeholder.com/80x120?text=?';">
        <div class="actor-search-info">
            <div class="actor-search-name">${name}</div>
            <div class="actor-search-dept">${dept}</div>
        </div>
        <div class="actor-search-cta">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
            ${TEXTS.viewFilmography}
        </div>
    </div>`;
}

async function fetchPersonCreditsForSearch(personId, seenIds) {
    try {
        const res  = await fetch(`${BASE_URL}/person/${personId}/combined_credits?language=${CURRENT_LANG}`);
        if (!res.ok) return [];
        const data = await res.json();
        const credits = (data.cast || []).filter(i => {
            if (seenIds.has(i.id)) return false;
            if (i.media_type !== 'movie' && i.media_type !== 'tv') return false;
            if (!i.poster_path) return false;
            seenIds.add(i.id);
            return true;
        });
        return credits.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    } catch (_) { return []; }
}

function renderSearchGrid(items) {
    const grid = document.getElementById('search-grid');
    if (!grid) return;
    let sorted = [...items];
    switch (searchSortBy) {
        case 'popular': sorted.sort((a, b) => (b.popularity || 0) - (a.popularity || 0)); break;
        case 'newest' : sorted.sort((a, b) => (b.release_date || b.first_air_date || '0') < (a.release_date || a.first_air_date || '0') ? 1 : -1); break;
        case 'oldest' : sorted.sort((a, b) => (a.release_date || a.first_air_date || '9') < (b.release_date || b.first_air_date || '9') ? -1 : 1); break;
        case 'rating' : sorted.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0)); break;
    }
    grid.innerHTML = sorted.map(i => createCardHTML(i, i.media_type || (i.title ? 'movie' : 'tv'))).join('');
    attachCardDelegation('#search-grid');
}

window.applySortToSearch = function (val, btn) {
    searchSortBy = val;
    if (btn) {
        document.querySelectorAll('.search-sort-bar .server-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    renderSearchGrid(searchAllItems);
};

function renderSkeletons(id, count) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = Array(count).fill('<div class="skeleton-card skeleton"></div>').join('');
}

function createCardHTML(item, typeOverride) {
    const t           = item.media_type || typeOverride || (item.title ? 'movie' : 'tv');
    const title       = sanitizeHTML(item.title || item.name);
    const releaseDate = item.release_date || item.first_air_date;
    const year        = releaseDate ? releaseDate.split('-')[0] : '????';

    const fallbackImage = "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='500' height='750' viewBox='0 0 500 750' fill='%231a1a1a'%3e%3crect width='500' height='750' fill='%231a1a1a'/%3e%3cpath d='M250 345c-19.3 0-35 15.7-35 35s15.7 35 35 35 35-15.7 35-35-15.7-35-35-35zm0 60c-13.8 0-25-11.2-25-25s11.2-25 25-25 25 11.2 25 25-11.2 25-25 25z' fill='%23444'/%3e%3cpath d='M330 290H170c-16.5 0-30 13.5-30 30v110c0 16.5 13.5 30 30 30h160c16.5 0 30-13.5 30-30V320c0-16.5-13.5-30-30-30zm10 140c0 5.5-4.5 10-10 10H170c-5.5 0-10-4.5-10-10V320c0-5.5 4.5-10 10-10h160c5.5 0 10 4.5 10 10v110z' fill='%23444'/%3e%3ctext x='50%25' y='490' dominant-baseline='middle' text-anchor='middle' fill='%23444' font-family='sans-serif' font-size='24' font-weight='bold'%3eNO POSTER%3c/text%3e%3c/svg%3e";
    const poster      = item.poster_path
        ? (item.poster_path.startsWith('http') ? item.poster_path : IMG_POSTER + item.poster_path)
        : fallbackImage;
    const rating      = item.vote_average ? item.vote_average.toFixed(1) : 'NR';
    const isFav       = isFavorite(item.id);
    const isWL        = isWatchLater(item.id);
    const targetLink    = getTargetUrl({ id: item.id, media_type: t, season: item.season, episode: item.episode });
    const mediaTypeLabel = t === 'movie' ? 'Movie' : 'TV Show';

    const favIcon = isFav
        ? '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

    const wlIcon = isWL
        ? '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 11H8a1 1 0 0 1 0-2h4V7a1 1 0 0 1 2 0v5a1 1 0 0 1-1 1z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';

    let continueBadge = '';
    if (t === 'tv' && item.season && item.episode) {
        continueBadge = `<span style="display:inline-block;margin-top:6px;background:var(--main-red);color:#fff;font-size:0.75rem;padding:3px 8px;border-radius:4px;font-weight:700;">S${item.season} E${item.episode}</span>`;
    }

    return `
        <div class="content-card" data-href="${targetLink}" data-id="${item.id}" data-type="${t}" role="button" tabindex="0">
            <button class="card-fav-btn ${isFav ? 'active' : ''}"
                data-fav-id="${item.id}" data-fav-type="${t}"
                data-fav-title="${encodeURIComponent(title)}"
                data-fav-poster="${encodeURIComponent(poster)}"
                data-fav-year="${year}" data-fav-rating="${rating}">
                ${favIcon}
            </button>
            <button class="card-wl-btn ${isWL ? 'active' : ''}"
                data-wl-id="${item.id}" data-wl-type="${t}"
                data-wl-title="${encodeURIComponent(title)}"
                data-wl-poster="${encodeURIComponent(poster)}"
                data-wl-year="${year}" data-wl-rating="${rating}">
                ${wlIcon}
            </button>
            <img src="${poster}" alt="${title} (${year}) Full ${mediaTypeLabel} Review & Details"
                 loading="lazy" onerror="this.onerror=null;this.src='${fallbackImage}';">
            <span class="card-rating">★ ${rating}</span>
            <div class="card-info">
                <div class="card-title">${title}</div>
                <div class="card-year">${year} • ${t === 'movie' ? TEXTS.typeMovie : TEXTS.typeTv}</div>
                ${continueBadge}
            </div>
        </div>`;
}

function attachCardDelegation(containerSelector) {
    const container = typeof containerSelector === 'string'
        ? document.querySelector(containerSelector)
        : containerSelector;
    if (!container) return;

    container.addEventListener('click', (e) => {
        const card = e.target.closest('.content-card');
        if (!card) return;

        const btn = e.target.closest('button');
        if (!btn) {
            const href = card.dataset.href;
            if (href) {
                const isContinue = !!container.closest('#continue-watching-section');
                if (isContinue) {
                    trackEvent('continue_watching', { content_id: card.dataset.id || '', href });
                } else {
                    trackEvent('select_content', { content_type: card.dataset.type || '', content_id: card.dataset.id || '', item_url: href });
                }
                location.href = href;
            }
            return;
        }

        if (btn.classList.contains('card-fav-btn')) {
            e.preventDefault();
            toggleFavoriteCore(
                btn.dataset.favId, btn.dataset.favType,
                decodeURIComponent(btn.dataset.favTitle),
                decodeURIComponent(btn.dataset.favPoster),
                btn.dataset.favYear, btn.dataset.favRating, btn
            );
        }

        if (btn.classList.contains('card-wl-btn')) {
            e.preventDefault();
            toggleWatchLaterCore(
                btn.dataset.wlId, btn.dataset.wlType,
                decodeURIComponent(btn.dataset.wlTitle),
                decodeURIComponent(btn.dataset.wlPoster),
                btn.dataset.wlYear, btn.dataset.wlRating, btn
            );
        }
    });
}

function toggleFavoriteCore(id, type, title, poster, year, rating, btnElement) {
    let favs = JSON.parse(localStorage.getItem('xudo_favs')) || [];
    const index = favs.findIndex(f => f.id == id);
    const isFav = index !== -1;
    if (isFav) favs.splice(index, 1);
    else        favs.push({ id, type, title, poster, year, rating });
    localStorage.setItem('xudo_favs', JSON.stringify(favs));
    trackEvent(isFav ? 'remove_from_favorites' : 'add_to_favorites', { content_type: type, content_id: id, movie_title: title });
    updateButtonState(btnElement, 'fav', !isFav);
}

function toggleWatchLaterCore(id, type, title, poster, year, rating, btnElement) {
    let list = JSON.parse(localStorage.getItem('xudo_watch_later')) || [];
    const index = list.findIndex(f => f.id == id);
    const isWL  = index !== -1;
    if (isWL) list.splice(index, 1);
    else       list.push({ id, type, title, poster, year, rating });
    localStorage.setItem('xudo_watch_later', JSON.stringify(list));
    trackEvent(isWL ? 'remove_from_watchlist' : 'add_to_watchlist', { content_type: type, content_id: id, movie_title: title });
    updateButtonState(btnElement, 'wl', !isWL);
}

function updateButtonState(btn, type, active) {
    if (type === 'fav') {
        btn.innerHTML = active
            ? '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    } else if (type === 'wl') {
        btn.innerHTML = active
            ? '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 11H8a1 1 0 0 1 0-2h4V7a1 1 0 0 1 2 0v5a1 1 0 0 1-1 1z"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
    }
    btn.classList.toggle('active', active);
}

async function initHome() {
    initScrollDepthTracking();
    const q = new URLSearchParams(window.location.search).get('search');
    if (q) {
        document.querySelector('.hero-wrapper').style.display = 'none';
        updateSEOMeta(`Search: ${q} | XUDOMovie`, `Search results for "${q}" on XUDOMovie.`);
        trackPageView(`Search: ${q} | XUDOMovie`, `/index.html?search=${encodeURIComponent(q)}`);
        await performSearch(q);
    } else {
        updateSEOMeta(
            'XUDOMovie | Premium HD Streaming for Movies & TV Shows',
            'Discover XUDOMovie, the premier destination for high-definition online streaming. Access an expansive library of blockbuster movies and critically acclaimed TV shows on demand.'
        );
        trackPageView('XUDOMovie | Premium HD Streaming for Movies & TV Shows', '/index.html');
        await loadHeroSlider();
        loadContinueWatching();
        await loadAllSections();
    }
}

async function loadHeroSlider() {
    try {
        const res = await fetch(`${BASE_URL}/trending/all/day?language=${CURRENT_LANG}`);
        if (!res.ok) throw new Error('Trending fetch failed');
        const data   = await res.json();
        const slides = data.results.filter(i => i.media_type === 'movie' || i.media_type === 'tv').slice(0, 10);

        const container = document.getElementById('hero-slider');
        const dots      = document.getElementById('hero-dots');
        if (!container || !slides.length) return;

        // Fetch detail per slide in parallel: tagline, genres, status, number_of_seasons/runtime
        const detailResults = await Promise.allSettled(
            slides.map(i =>
                fetch(`${BASE_URL}/${i.media_type}/${i.id}?language=${CURRENT_LANG}&append_to_response=images`)
                    .then(r => r.ok ? r.json() : {})
                    .catch(() => ({}))
            )
        );
        const enriched = slides.map((item, idx) => ({
            ...item,
            _d: detailResults[idx].status === 'fulfilled' ? detailResults[idx].value : {}
        }));

        const buildSlide = i => {
            const d        = i._d;
            const link     = getTargetUrl(i);
            const title    = sanitizeHTML(i.title || i.name);
            const overview = sanitizeHTML(i.overview);
            const btnLabel = i.media_type === 'tv' ? TEXTS.heroBtnTv : TEXTS.heroBtn;
            const mediaTag = i.media_type === 'tv' ? TEXTS.typeTv : TEXTS.typeMovie;
            const tagline  = d.tagline ? sanitizeHTML(d.tagline) : '';
            const year     = (i.release_date || i.first_air_date || '').slice(0, 4);
            const rating   = i.vote_average ? i.vote_average.toFixed(1) : '';
            const genres   = (d.genres || []).slice(0, 3).map(g => sanitizeHTML(g.name)).join(', ');
            const extra    = i.media_type === 'tv'
                ? (d.number_of_seasons ? `${d.number_of_seasons} Season${d.number_of_seasons !== 1 ? 's' : ''}` : '')
                : (d.runtime           ? `${d.runtime} min`                                                       : '');
            const status   = i.media_type === 'tv' && d.status ? sanitizeHTML(d.status.toUpperCase()) : '';
            const metaParts = [year, extra, genres].filter(Boolean).join(' • ');
            const logos    = d.images?.logos || [];
            const langCode = (CURRENT_LANG || 'en').split('-')[0];
            const logo     = logos.find(l => l.iso_639_1 === langCode)
                          || logos.find(l => l.iso_639_1 === 'en')
                          || logos[0]
                          || null;
            const logoUrl  = logo ? `https://image.tmdb.org/t/p/w500${logo.file_path}` : null;
            const titleHTML = logoUrl
                ? `<img class="hero-logo" src="${logoUrl}" alt="${title}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">`
                  + `<h1 class="hero-title" style="display:none">${title}</h1>`
                : `<h1 class="hero-title">${title}</h1>`;
            return `<a href="${link}" class="hero-slide" data-id="${i.id}" data-type="${i.media_type}" style="background-image:url('${IMG_HD + i.backdrop_path}')">
                <div class="hero-video-preview"></div>
                <div class="hero-content">
                    <div class="hero-tag">${mediaTag}</div>
                    ${tagline ? `<p class="hero-tagline">${tagline}</p>` : ''}
                    ${titleHTML}
                    <div class="hero-meta">
                        ${rating   ? `<span class="hero-rating"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="#f5c518" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> ${rating}</span>` : ''}
                        ${metaParts ? `<span class="hero-attrs">${metaParts}</span>` : ''}
                        ${status    ? `<span class="hero-status-badge">${status}</span>` : ''}
                    </div>
                    <p class="hero-desc">${overview}</p>
                    <div class="hero-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        ${btnLabel}
                    </div>
                </div>
            </a>`;
        };

        container.innerHTML = [enriched[enriched.length - 1], ...enriched, enriched[0]].map(buildSlide).join('');

        if (dots) {
            dots.innerHTML = slides.map((_, i) => `<div class="dot ${i === 0 ? 'active' : ''}" data-index="${i}"></div>`).join('');
            dots.querySelectorAll('.dot').forEach(d =>
                d.addEventListener('click', (e) => { e.stopPropagation(); snapTo(parseInt(d.dataset.index) + 1, true); })
            );
        }

        let idx = 1, busy = false, timer;
        const totalReal  = slides.length;
        const wrapper    = document.getElementById('hero-wrapper') || container;
        const sliderWidth = () => container.parentElement.offsetWidth || window.innerWidth;

        container.style.transition = 'none';
        container.style.transform  = 'translateX(-100%)';

        const updateDots = () => {
            if (!dots) return;
            dots.querySelectorAll('.dot').forEach(d => d.classList.remove('active'));
            let real = idx - 1;
            if (real < 0) real = totalReal - 1;
            if (real >= totalReal) real = 0;
            if (dots.children[real]) dots.children[real].classList.add('active');
        };

        const snapTo = (target, animate = true) => {
            if (busy) return;
            idx  = target;
            busy = true;
            container.style.transition = animate ? 'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94)' : 'none';
            container.style.transform  = `translateX(-${idx * 100}%)`;
            updateDots();
            resetTimer();
            if (!animate) busy = false;
        };

        const next = () => { if (!busy && idx <= totalReal) snapTo(idx + 1); };
        const prev = () => { if (!busy && idx >= 1)         snapTo(idx - 1); };

        container.addEventListener('transitionend', () => {
            busy = false;
            if (idx === totalReal + 1) { idx = 1;         container.style.transition = 'none'; container.style.transform = 'translateX(-100%)'; }
            if (idx === 0)             { idx = totalReal;  container.style.transition = 'none'; container.style.transform = `translateX(-${totalReal * 100}%)`; }
        });

        const startTimer = () => { clearInterval(timer); timer = setInterval(next, 5000); };
        const resetTimer = () => { clearInterval(timer); startTimer(); };
        startTimer();

        let pointerDown = false, startX = 0, startY = 0, dragOffset = 0, didDrag = false, directionLocked = null, lastMoveX = 0, lastMoveTime = 0;
        const DRAG_THRESHOLD = 8, SNAP_THRESHOLD = 0.15, VELOCITY_THRESHOLD = 0.3;

        const onPointerDown = (x, y) => {
            if (busy) return;
            pointerDown = true; startX = x; startY = y; dragOffset = 0; didDrag = false; directionLocked = null; lastMoveX = x; lastMoveTime = Date.now();
            container.style.transition = 'none';
            clearInterval(timer);
        };
        const onPointerMove = (x, y) => {
            if (!pointerDown) return;
            const dx = x - startX, dy = y - startY;
            if (!directionLocked) {
                if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
                    directionLocked = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
                }
            }
            if (directionLocked === 'v') return;
            if (directionLocked === 'h') {
                didDrag    = true;
                dragOffset = dx;
                const basePct = idx * 100;
                const dragPct = (dragOffset / sliderWidth()) * 100;
                let resisted  = dragPct;
                if ((idx === 1 && dragOffset > 0) || (idx === totalReal && dragOffset < 0)) resisted = dragPct * 0.3;
                container.style.transform = `translateX(${-basePct + resisted}%)`;
                lastMoveX = x; lastMoveTime = Date.now();
            }
        };
        const onPointerUp = (x) => {
            if (!pointerDown) return;
            pointerDown = false;
            if (!didDrag || directionLocked !== 'h') { startTimer(); directionLocked = null; return; }
            const dt         = Date.now() - lastMoveTime;
            const velocity   = dt > 0 ? Math.abs(x - lastMoveX) / dt : 0;
            const dragRatio  = Math.abs(dragOffset) / sliderWidth();
            let target       = idx;
            if (velocity > VELOCITY_THRESHOLD || dragRatio > SNAP_THRESHOLD) {
                target = dragOffset > 0 ? idx - 1 : idx + 1;
            }
            target = Math.max(0, Math.min(totalReal + 1, target));
            dragOffset = 0; directionLocked = null; busy = false;
            snapTo(target, true);
        };

        wrapper.addEventListener('touchstart',  e => { const t = e.touches[0]; onPointerDown(t.clientX, t.clientY); }, { passive: true });
        wrapper.addEventListener('touchmove',   e => { const t = e.touches[0]; onPointerMove(t.clientX, t.clientY); if (directionLocked === 'h') e.preventDefault(); }, { passive: false });
        wrapper.addEventListener('touchend',    e => { const t = e.changedTouches[0]; onPointerUp(t.clientX); }, { passive: true });
        wrapper.addEventListener('touchcancel', () => { pointerDown = false; didDrag = false; directionLocked = null; snapTo(idx, true); });

        container.addEventListener('mousedown', e => { e.preventDefault(); onPointerDown(e.clientX, e.clientY); container.style.cursor = 'grabbing'; });
        window.addEventListener('mousemove',    e => { if (pointerDown) onPointerMove(e.clientX, e.clientY); });
        window.addEventListener('mouseup',      e => { if (pointerDown) { onPointerUp(e.clientX); container.style.cursor = 'grab'; } });

        container.querySelectorAll('.hero-slide').forEach(slide => {
            slide.addEventListener('click', e => {
                if (didDrag) { e.preventDefault(); e.stopPropagation(); requestAnimationFrame(() => { didDrag = false; }); }
            }, true);
        });

        // Hover-to-play: show a muted trailer preview after a short hover delay (desktop only).
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            const trailerCache = new Map();
            let hoverTimer  = null;
            let playingSlide = null;

            const stopPreview = () => {
                if (!playingSlide) return;
                const box = playingSlide.querySelector('.hero-video-preview');
                if (box) box.innerHTML = '';
                playingSlide.classList.remove('playing');
                playingSlide = null;
                if (!pointerDown) startTimer();
            };

            container.querySelectorAll('.hero-slide').forEach(slide => {
                slide.addEventListener('mouseenter', () => {
                    clearTimeout(hoverTimer);
                    hoverTimer = setTimeout(async () => {
                        const { id, type } = slide.dataset;
                        if (!id || !type) return;
                        const cacheKey = `${type}-${id}`;
                        const key = trailerCache.has(cacheKey)
                            ? trailerCache.get(cacheKey)
                            : await fetchTrailerKey(type, id);
                        trailerCache.set(cacheKey, key);
                        if (!key || !slide.matches(':hover')) return;

                        if (playingSlide && playingSlide !== slide) stopPreview();
                        clearInterval(timer);
                        playingSlide = slide;
                        const box = slide.querySelector('.hero-video-preview');
                        if (box) {
                            box.innerHTML = `<iframe src="https://www.youtube.com/embed/${key}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&playsinline=1&loop=1&playlist=${key}&cc_load_policy=0" allow="autoplay;encrypted-media" title="${sanitizeHTML(slide.querySelector('.hero-title')?.textContent || '')}"></iframe>`;
                            slide.classList.add('playing');
                        }
                    }, 600);
                });
                slide.addEventListener('mouseleave', () => {
                    clearTimeout(hoverTimer);
                    if (playingSlide === slide) stopPreview();
                });
            });
        }

        document.addEventListener('keydown', e => {
            if (!document.getElementById('hero-wrapper')) return;
            if (e.key === 'ArrowRight') next();
            else if (e.key === 'ArrowLeft') prev();
        });

    } catch (error) {
        console.error('Hero slider error:', error);
    }
}

function loadContinueWatching() {
    const history = JSON.parse(localStorage.getItem('xudo_history')) || [];
    if (!history.length) return;
    const main    = document.getElementById('main-content');
    const section = document.createElement('section');
    section.id        = 'continue-watching-section';
    section.className = 'content-section';
    section.innerHTML = `
        <div class="section-header">
            <h2 class="section-heading">${TEXTS.contWatch}</h2>
            <a href="javascript:void(0)" onclick="clearHistory()" class="section-more-link">${TEXTS.clearHistory}</a>
        </div>
        <div class="horizontal-slider">
            ${history.map(i => createCardHTML({
                id: i.id, media_type: i.type, title: i.title,
                poster_path: i.poster, release_date: i.year,
                vote_average: +i.rating, season: i.season, episode: i.episode
            })).join('')}
        </div>`;
    main.prepend(section);
    attachCardDelegation('#continue-watching-section .horizontal-slider');
}

async function fetchMixedCountrySection(s, today) {
    const [movieSettled, tvSettled] = await Promise.allSettled([
        fetch(`${BASE_URL}/discover/movie?${s.mixedCountry}&sort_by=primary_release_date.desc&primary_release_date.lte=${today}&language=${CURRENT_LANG}`),
        fetch(`${BASE_URL}/discover/tv?${s.mixedCountry}&sort_by=first_air_date.desc&first_air_date.lte=${today}&language=${CURRENT_LANG}`),
    ]);

    let items = [];

    if (movieSettled.status === 'fulfilled' && movieSettled.value.ok) {
        const d = await movieSettled.value.json();
        (d.results || []).forEach(r => {
            if (r.poster_path && r.release_date && r.release_date <= today)
                items.push({ ...r, media_type: 'movie', _sortDate: r.release_date });
        });
    }
    if (tvSettled.status === 'fulfilled' && tvSettled.value.ok) {
        const d = await tvSettled.value.json();
        (d.results || []).forEach(r => {
            if (r.poster_path && r.first_air_date && r.first_air_date <= today)
                items.push({ ...r, media_type: 'tv', _sortDate: r.first_air_date });
        });
    }

    items.sort((a, b) => b._sortDate.localeCompare(a._sortDate));
    items = items.slice(0, 30);

    if (!items.length) throw new Error(`Mixed section ${s.t} empty after filter`);
    return { ...s, results: items };
}

async function loadAllSections() {
    const main = document.getElementById('main-content');
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD", computed at call time
    const sections = [
        { t: TEXTS.movPopular,       tk: 'movPopular',       u: `/discover/movie?sort_by=primary_release_date.desc&primary_release_date.lte=${today}&vote_count.gte=50&with_release_type=3%7C2`, k: 'movie', secId: 'sec-latest',    postFilter: r => !!r.poster_path },
        { t: TEXTS.latestTvSection,  tk: 'latestTvSection',  u: `/discover/tv?sort_by=first_air_date.desc&first_air_date.lte=${today}&vote_count.gte=50`,                                       k: 'tv',    secId: 'sec-latest-tv', postFilter: r => !!r.poster_path },
        { t: TEXTS.animeSection,     tk: 'animeSection',     u: '/discover/tv?with_genres=16&with_origin_country=JP&sort_by=popularity.desc',                                                   k: 'tv',    secId: 'sec-anime',  mixedCountry: 'with_genres=16&with_origin_country=JP' },
        { t: TEXTS.appleSection,     tk: 'appleSection',     u: `/discover/tv?with_networks=2552&sort_by=first_air_date.desc&first_air_date.lte=${today}`,                                      k: 'tv',    secId: 'sec-apple'    },
        { t: TEXTS.disneySection,    tk: 'disneySection',    u: `/discover/tv?with_networks=2739&sort_by=first_air_date.desc&first_air_date.lte=${today}`,                                      k: 'tv',    secId: 'sec-disney'   },
        { t: TEXTS.hboSection,       tk: 'hboSection',       u: `/discover/tv?with_networks=49&sort_by=first_air_date.desc&first_air_date.lte=${today}`,                                        k: 'tv',    secId: 'sec-hbo'      },
        { t: TEXTS.netflixSection,   tk: 'netflixSection',   u: `/discover/tv?with_networks=213&sort_by=first_air_date.desc&first_air_date.lte=${today}`,                                       k: 'tv',    secId: 'sec-netflix'  },
        { t: TEXTS.primeSection,     tk: 'primeSection',     u: `/discover/tv?with_networks=1024&sort_by=first_air_date.desc&first_air_date.lte=${today}`,                                      k: 'tv',    secId: 'sec-prime'    },
        { t: TEXTS.chinese,          tk: 'chinese',          u: '/discover/tv?with_origin_country=CN&sort_by=popularity.desc',                                                                  k: 'tv',    secId: 'sec-chinese',   mixedCountry: 'with_origin_country=CN' },
        { t: TEXTS.indianSection,    tk: 'indianSection',    u: '/discover/tv?with_origin_country=IN&sort_by=popularity.desc',                                                                 k: 'tv',    secId: 'sec-indian',    mixedCountry: 'with_origin_country=IN' },
        { t: TEXTS.korean,           tk: 'korean',           u: '/discover/tv?with_origin_country=KR&sort_by=popularity.desc',                                                                 k: 'tv',    secId: 'sec-korean',    mixedCountry: 'with_origin_country=KR' },
    ];

    const promises = sections.map(async (s) => {
        if (s.mixedCountry) return fetchMixedCountrySection(s, today);
        const sep = s.u.includes('?') ? '&' : '?';
        const res = await fetch(`${BASE_URL}${s.u}${sep}language=${CURRENT_LANG}`);
        if (!res.ok) throw new Error(`Section ${s.t} failed`);
        const d = await res.json();
        return { ...s, results: d.results };
    });

    const settled = await Promise.allSettled(promises);
    settled.forEach((result, i) => {
        if (result.status === 'rejected') { console.error(`Section error: ${sections[i].t}`, result.reason); return; }
        const { t, tk, u, k, results, postFilter, secId } = result.value;
        const items = postFilter ? results.filter(postFilter) : results;
        if (!items.length) return;
        const link    = `browse.html?endpoint=${encodeURIComponent(u)}&titleKey=${encodeURIComponent(tk || '')}&title=${encodeURIComponent(t)}&type=${k}&lang=${CURRENT_LANG}`;
        const section = document.createElement('section');
        section.className = 'content-section';
        if (secId) section.id = secId;
        section.innerHTML = `
            <div class="section-header">
                <h2 class="section-heading"><a href="${link}">${t}</a></h2>
                <a href="${link}" class="section-more-link">${TEXTS.viewMore} ›</a>
            </div>
            <div class="horizontal-slider">
                ${items.map(item => createCardHTML(item, k)).join('')}
            </div>`;
        main.appendChild(section);
        attachCardDelegation(section.querySelector('.horizontal-slider'));
    });
}

async function initBrowse() {
    initScrollDepthTracking();
    const params = new URLSearchParams(window.location.search);
    const ep       = params.get('endpoint');
    const titleKey = params.get('titleKey');
    const title    = (titleKey && TEXTS[titleKey]) || sanitizeHTML(params.get('title') || '');
    const type     = params.get('type');
    trackPageView(`${title || 'Browse'} | XUDOMovie`, window.location.pathname + window.location.search);

    if (type === 'favorites') {
        document.getElementById('page-title').innerText = TEXTS.myFavorites;
        document.getElementById('genre-list').style.display = 'none';
        document.getElementById('load-more-btn').style.display = 'none';
        const favs = JSON.parse(localStorage.getItem('xudo_favs')) || [];
        document.getElementById('browse-grid').innerHTML = favs.length
            ? favs.map(f => createCardHTML({ id: f.id, media_type: f.type, title: f.title, poster_path: f.poster, release_date: f.year, vote_average: parseFloat(f.rating) })).join('')
            : `<div class="no-results">${TEXTS.noFavorites}</div>`;
        attachCardDelegation('#browse-grid');
        return;
    }

    if (type === 'watchlater') {
        document.getElementById('page-title').innerText = TEXTS.watchLater;
        document.getElementById('genre-list').style.display = 'none';
        document.getElementById('load-more-btn').style.display = 'none';
        const wl = JSON.parse(localStorage.getItem('xudo_watch_later')) || [];
        document.getElementById('browse-grid').innerHTML = wl.length
            ? wl.map(f => createCardHTML({ id: f.id, media_type: f.type, title: f.title, poster_path: f.poster, release_date: f.year, vote_average: parseFloat(f.rating) })).join('')
            : `<div class="no-results">${TEXTS.noWatchLater}</div>`;
        attachCardDelegation('#browse-grid');
        return;
    }

    if (!ep) return (window.location.href = 'index.html');

    document.getElementById('page-title').innerText = title;
    const lmBtn = document.getElementById('load-more-btn');
    lmBtn.textContent = TEXTS.loadMore;
    lmBtn.onclick = () => {
        trackEvent('load_more', { endpoint: ep, page: currentPage + 1, media_type: type });
        loadBrowseContent();
    };
    // Toggle-able: has with_origin_country (country & anime) but not with_networks (platform)
    const _epSp = new URLSearchParams(ep.includes('?') ? ep.split('?')[1] : '');
    const _isCountryBrowse = _epSp.has('with_origin_country') &&
                             !_epSp.has('with_networks');

    if (_isCountryBrowse) {
        // Default to Movie — swap /discover/tv → /discover/movie, keep all query params
        const movieEp     = ep.replace('/discover/tv', '/discover/movie');
        const normMovieEp = _normBrowseEp(movieEp, 'movie');
        _categoryBaseEndpoint = normMovieEp;
        currentBrowseEndpoint = normMovieEp;
        currentMediaType      = 'movie';
        _renderMediaTypeToggle('movie');
        window.addEventListener('resize', _updateToggleIndicator);
        renderSkeletons('browse-grid', 15);
        attachCardDelegation('#browse-grid');
        await fetchGenres('movie');
        await loadBrowseContent();
    } else {
        const normEp          = _normBrowseEp(ep, type);
        currentMediaType      = type;
        currentBrowseEndpoint = normEp;
        _categoryBaseEndpoint = normEp;   // set (not null) so filterByGenre uses normalized base
        renderSkeletons('browse-grid', 15);
        attachCardDelegation('#browse-grid');
        await fetchGenres(type);
        await loadBrowseContent();
    }
}

// Normalise a browse endpoint: swap popularity sort → date-based sort + date.lte guard.
// Leaves endpoints that already have a non-popularity sort (e.g. platform sections) untouched.
function _normBrowseEp(ep, mediaType) {
    const today = new Date().toISOString().slice(0, 10);
    const qIdx  = ep.indexOf('?');
    const path  = qIdx >= 0 ? ep.slice(0, qIdx) : ep;
    const sp    = new URLSearchParams(qIdx >= 0 ? ep.slice(qIdx + 1) : '');
    if (sp.get('sort_by') === 'popularity.desc') {
        if (mediaType === 'movie') {
            sp.set('sort_by', 'primary_release_date.desc');
            sp.set('primary_release_date.lte', today);
        } else {
            sp.set('sort_by', 'first_air_date.desc');
            sp.set('first_air_date.lte', today);
        }
    }
    if (!sp.has('vote_count.gte')) sp.set('vote_count.gte', '20');
    return `${path}?${sp.toString()}`;
}

function _updateToggleIndicator() {
    const tog = document.getElementById('media-type-toggle');
    if (!tog) return;
    const active = tog.querySelector('.server-btn.active');
    if (!active) return;
    tog.style.setProperty('--ind-left',  active.offsetLeft  + 'px');
    tog.style.setProperty('--ind-width', active.offsetWidth + 'px');
}

function _renderMediaTypeToggle(activeType) {
    const existing = document.getElementById('media-type-toggle');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.id        = 'media-type-toggle';
    div.className = 'server-control';
    div.dataset.active = activeType;
    div.innerHTML =
        `<button class="server-btn${activeType === 'movie' ? ' active' : ''}" id="mtoggle-movie" onclick="window.switchMediaType('movie')">${TEXTS.tabMovies}</button>` +
        `<button class="server-btn${activeType === 'tv'    ? ' active' : ''}" id="mtoggle-tv"    onclick="window.switchMediaType('tv')">${TEXTS.tabTV}</button>`;
    const genreList = document.getElementById('genre-list');
    if (genreList) genreList.parentNode.insertBefore(div, genreList);
    requestAnimationFrame(_updateToggleIndicator);
}

window.switchMediaType = async function (newType) {
    if (newType === currentMediaType) return;

    // Rebuild base from original URL endpoint — always has the country/language params
    const urlEp     = new URLSearchParams(window.location.search).get('endpoint');
    const qIdx      = urlEp.indexOf('?');
    const origQuery = qIdx >= 0 ? urlEp.slice(qIdx + 1) : '';
    const rawBase   = `/discover/${newType}?${origQuery}`;
    const newBase   = _normBrowseEp(rawBase, newType);   // normalize sort field for new type

    _categoryBaseEndpoint = newBase;
    currentBrowseEndpoint = newBase;
    currentMediaType      = newType;
    currentGenreId        = null;
    currentPage           = 1;

    document.getElementById('mtoggle-movie')?.classList.toggle('active', newType === 'movie');
    document.getElementById('mtoggle-tv')?.classList.toggle('active', newType === 'tv');
    const tog = document.getElementById('media-type-toggle');
    if (tog) tog.dataset.active = newType;
    _updateToggleIndicator();

    // Re-fetch genre list: movie/tv genres differ, must match new type
    await fetchGenres(newType);

    document.getElementById('browse-grid').innerHTML = '';
    renderSkeletons('browse-grid', 15);
    await loadBrowseContent();
};

async function loadBrowseContent() {
    if (isLoading) return;
    isLoading = true;
    const btn = document.getElementById('load-more-btn');
    btn.innerText = TEXTS.loading;
    btn.disabled  = true;
    try {
        const sep = currentBrowseEndpoint.includes('?') ? '&' : '?';
        const res = await fetch(`${BASE_URL}${currentBrowseEndpoint}${sep}language=${CURRENT_LANG}&page=${currentPage}`);
        if (!res.ok) throw new Error('Browse content fetch failed');
        const d = await res.json();

        if (currentPage === 1) document.getElementById('browse-grid').innerHTML = '';
        document.getElementById('browse-grid').insertAdjacentHTML('beforeend',
            d.results.filter(i => i.poster_path).map(i => createCardHTML(i, currentMediaType)).join('')
        );

        currentPage++;
        if (d.page >= d.total_pages) {
            btn.style.display = 'none';
        } else {
            btn.innerText     = TEXTS.loadMore;
            btn.disabled      = false;
            btn.style.display = 'inline-block';
        }
    } catch (error) {
        console.error('Browse fetch error:', error);
        btn.innerText = 'Retry';
        btn.disabled  = false;
    } finally {
        isLoading = false;
    }
}

async function fetchGenres(type) {
    const list = document.getElementById('genre-list');
    if (!list) return;
    list.innerHTML = `<button class="genre-btn active" onclick="filterByGenre(null,this)">${TEXTS.allGenres}</button>`;

    const addGenreBtn = (g) => {
        const b      = document.createElement('button');
        b.className  = 'genre-btn';
        b.innerText  = g.name;
        b.onclick    = () => filterByGenre(g.id, b);
        list.appendChild(b);
    };

    const genreMap  = GENRE_HARDCODED[CURRENT_LANG];  
    const fetchLang = genreMap ? 'en-US' : CURRENT_LANG;
    const cacheKey  = `xudo_genres_${CURRENT_LANG}_${type}`;
    const cached    = localStorage.getItem(cacheKey);

    if (cached) {
        JSON.parse(cached).forEach(addGenreBtn);
    } else {
        try {
            const res = await fetch(`${BASE_URL}/genre/${type}/list?language=${fetchLang}`);
            if (!res.ok) throw new Error('Failed to fetch genres');
            const d = await res.json();
            if (d.genres) {
                const genres = genreMap
                    ? d.genres.map(g => ({ id: g.id, name: genreMap[g.id] || g.name }))
                    : d.genres;
                localStorage.setItem(cacheKey, JSON.stringify(genres));
                genres.forEach(addGenreBtn);
            }
        } catch (error) { console.error('Fetch genres error:', error); }
    }
}

window.filterByGenre = function (id, btn) {
    document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentGenreId = id;
    trackEvent('genre_filter', { genre_id: id || 'all', genre_name: btn.textContent.trim(), media_type: currentMediaType });
    if (typeof window.applyAdvancedFilters === 'function' && document.querySelector('.modern-filters-container')) {
        window.applyAdvancedFilters();
    } else {
        currentPage = 1;
        document.getElementById('browse-grid').innerHTML = '';
        renderSkeletons('browse-grid', 10);
        // Use toggle-aware base when available; fall back to URL param for non-toggle pages
        const baseEndpoint = _categoryBaseEndpoint || new URLSearchParams(window.location.search).get('endpoint');
        if (!id) {
            // "All Genres" — restore current toggle-state base exactly
            currentBrowseEndpoint = baseEndpoint;
        } else {
            // Preserve all original category constraints; only merge with_genres
            const qMark = baseEndpoint.indexOf('?');
            const basePath  = qMark >= 0 ? baseEndpoint.slice(0, qMark) : baseEndpoint;
            const baseQuery = qMark >= 0 ? baseEndpoint.slice(qMark + 1) : '';
            const sp = new URLSearchParams(baseQuery);
            const existing = sp.get('with_genres');
            // AND-combine genres (comma = TMDB AND): e.g. Anime already has 16 → becomes 16,35
            sp.set('with_genres', existing ? `${existing},${id}` : String(id));
            currentBrowseEndpoint = `${basePath}?${sp.toString()}`;
        }
        loadBrowseContent();
    }
};

window.applyAdvancedFilters = async function () {
    const year    = document.getElementById('filter-year')?.value.trim() || '';
    const country = document.getElementById('filter-country')?.value || '';
    let sort      = document.getElementById('filter-sort')?.value || currentSortBy;
    if (currentMediaType === 'tv' && sort === 'primary_release_date.desc') sort = 'first_air_date.desc';
    currentSortBy = sort;

    currentPage = 1;
    document.getElementById('browse-grid').innerHTML = '';
    renderSkeletons('browse-grid', 10);

    let params = `?sort_by=${sort}`;
    if (currentGenreId) params += `&with_genres=${currentGenreId}`;
    if (year)    params += `&${currentMediaType === 'movie' ? 'primary_release_year' : 'first_air_date_year'}=${year}`;
    if (country) params += `&with_origin_country=${country}`;
    const today = new Date().toISOString().slice(0, 10);
    params += currentMediaType === 'movie' ? `&primary_release_date.lte=${today}` : `&first_air_date.lte=${today}`;

    currentBrowseEndpoint = `/discover/${currentMediaType}${params}`;

    const sortLabels = { 'popularity.desc': TEXTS.sortPopular, 'vote_average.desc': TEXTS.sortTopRated, 'primary_release_date.desc': TEXTS.sortNewest, 'first_air_date.desc': TEXTS.sortNewest, 'title.asc': TEXTS.sortAZ };
    trackEvent('browse_filter', { year: year || 'all', country: country || 'all', sort, media_type: currentMediaType });
    renderFilterBadges(year, country, sortLabels[sort] || '');
    loadBrowseContent();
};

function renderFilterBadges(year, country, sortLabel) {
    let container = document.getElementById('active-filter-badges');
    if (!container) {
        container = document.createElement('div');
        container.id        = 'active-filter-badges';
        container.className = 'active-filter-badges';
        const refNode = document.querySelector('.modern-filters-container') || document.getElementById('browse-grid');
        if (refNode) refNode.before(container);
    }
    const badges = [];
    if (year)                                        badges.push(`<span class="filter-badge">${TEXTS.badgeYear}: ${sanitizeHTML(year)} <button onclick="clearFilterBadge('year')">✕</button></span>`);
    if (country)                                     badges.push(`<span class="filter-badge">${TEXTS.badgeCountry}: ${sanitizeHTML(country)} <button onclick="clearFilterBadge('country')">✕</button></span>`);
    if (sortLabel && sortLabel !== TEXTS.sortPopular) badges.push(`<span class="filter-badge">${TEXTS.badgeSort}: ${sanitizeHTML(sortLabel)} <button onclick="clearFilterBadge('sort')">✕</button></span>`);
    container.innerHTML = badges.join('');
}

window.clearFilterBadge = function (type) {
    if (type === 'year') {
        const el = document.getElementById('filter-year');
        if (el) el.value = '';
    } else if (type === 'country') {
        const input   = document.getElementById('filter-country');
        const trigger = document.getElementById('country-trigger');
        if (input)   input.value = '';
        if (trigger) trigger.textContent = TEXTS.allCountries;
        document.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
    } else if (type === 'sort') {
        const select = document.getElementById('filter-sort');
        if (select) select.value = 'popularity.desc';
        currentSortBy = 'popularity.desc';
    }
    window.applyAdvancedFilters();
};

function initCustomSelect() {
    const wrapper = document.getElementById('country-dropdown');
    if (!wrapper) return;
    const trigger = document.getElementById('country-trigger');
    const options = wrapper.querySelectorAll('.custom-option');
    const hidden  = document.getElementById('filter-country');

    trigger.addEventListener('click', (e) => { e.stopPropagation(); wrapper.classList.toggle('open'); });
    options.forEach(opt => {
        opt.addEventListener('click', function (e) {
            e.stopPropagation();
            trigger.textContent = this.textContent;
            hidden.value        = this.dataset.value;
            options.forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
            wrapper.classList.remove('open');
        });
    });
    document.addEventListener('click', (e) => { if (!wrapper.contains(e.target)) wrapper.classList.remove('open'); });
}

async function initWatchPage() {
    initScrollDepthTracking();
    const p    = new URLSearchParams(window.location.search);
    const type = p.get('type'), id = p.get('id');
    currentSeason  = parseInt(p.get('s')) || 1;
    currentEpisode = parseInt(p.get('e')) || 1;
    if (!id || !type) return (window.location.href = 'index.html');

    // Movies load the player immediately. TV defers one step: the anime route
    // (resolved inside fetchMovieDetails) changes the embed URL, so loading now
    // would double-load the iframe for anime titles.
    if (type !== 'tv') {
        updatePlayer(type, id);
    } else {
        const el = document.getElementById('player-container');
        if (el) el.innerHTML = '<div style="display:grid;place-items:center;height:100%;background:#000;color:#fff"><div class="loader">Loading Player...</div></div>';
    }

    const _s = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    _s('btn-share-text',     TEXTS.share);
    _s('btn-trailer-text',   TEXTS.trailer);
    _s('cast-title',           TEXTS.topCast);
    _s('rec-title',            TEXTS.youMayAlsoLike);
    _s('select-episode-title', TEXTS.selectEpisode);

    const noteEl = document.getElementById('ublock-note-text');
    if (noteEl) noteEl.innerHTML = TEXTS.ublockNote
        .replace('uBlock Origin', '<a href="https://ublockorigin.com" rel="nofollow noopener noreferrer" target="_blank"><strong>uBlock Origin</strong></a>')
        .replace(/([.。।។])\s+/, '$1<br>');
    if (type === 'tv') {
        const c = document.getElementById('tv-controls');
        if (c) c.style.display = 'block';
        await loadTVSeasons(id);
    }
    await fetchMovieDetails(type, id);
    if (type === 'tv') {
        renderAnimeDubToggle(window._animeRoute?.route === 'use_anime');
        updatePlayer(type, id);   // single load, after anime route is known
    } else {
        renderAnimeDubToggle(false);
    }
    await fetchCertification(type, id);
    await fetchCast(type, id);
    await fetchSimilarMovies(type, id);
}

function updatePlayer(type, id) {
    const el = document.getElementById('player-container');
    if (!el) return;

    window._playerReadyTime = null;

    el.innerHTML = '<div style="display:grid;place-items:center;height:100%;background:#000;color:#fff"><div class="loader">Loading Player...</div></div>';

    let src = '';
    if (type === 'movie') {
        switch (currentServer) {
            case 1: src = `https://vidlink.pro/movie/${id}?autoplay=true`; break;
            case 2: src = `https://vsembed.ru/embed/movie/${id}?autoplay=1`; break;
            case 3: src = `https://www.2embed.cc/embed/${id}`; break;
            case 4: src = `https://multiembed.mov/?video_id=${id}&tmdb=1`; break;
            case 5: src = `https://vidcore.org/embed/movie/${id}?autoPlay=true`; break;
            default: src = `https://vidlink.pro/movie/${id}?autoplay=true`;
        }
    } else {
        const animeRoute = window._animeRoute;
        const useAnime   = animeRoute?.route === 'use_anime' && animeRoute.mal_id;
        switch (currentServer) {
            case 1:
                src = useAnime
                    ? `https://vidlink.pro/anime/${animeRoute.mal_id}/${currentEpisode}/${currentAnimeDubType}?fallback=true&autoplay=true`
                    : `https://vidlink.pro/tv/${id}/${currentSeason}/${currentEpisode}?autoplay=true&nextbutton=true`;
                break;
            case 2: src = `https://vsembed.ru/embed/tv/${id}/${currentSeason}/${currentEpisode}?autoplay=1`; break;
            case 3: src = `https://www.2embed.cc/embedtv/${id}&s=${currentSeason}&e=${currentEpisode}`; break;
            case 4: src = `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${currentSeason}&e=${currentEpisode}`; break;
            case 5: src = `https://vidcore.org/embed/tv/${id}/${currentSeason}/${currentEpisode}?autoPlay=true`; break;
            default:
                src = useAnime
                    ? `https://vidlink.pro/anime/${animeRoute.mal_id}/${currentEpisode}/${currentAnimeDubType}?fallback=true&autoplay=true`
                    : `https://vidlink.pro/tv/${id}/${currentSeason}/${currentEpisode}?autoplay=true&nextbutton=true`;
        }
    }

    const iframe = document.createElement('iframe');
    iframe.src          = src;
    iframe.className    = 'player-frame';
    iframe.allowFullscreen = true;
    iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
    iframe.scrolling    = 'no';
    iframe.frameBorder  = '0';
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    iframe.addEventListener('load', () => {
        window._playerReadyTime = Date.now();
    }, { once: true });
    iframe.addEventListener('error', () => {
        trackEvent('player_error', { server: currentServer, content_type: type, content_id: id });
    }, { once: true });

    el.innerHTML = '';
    el.appendChild(iframe);
}

window.changeServer = function (serverNum) {
    currentServer = serverNum;
    trackEvent('server_select', { server_number: serverNum });
    document.querySelectorAll('.server-btn').forEach((btn, idx) => btn.classList.toggle('active', idx === serverNum - 1));
    const p = new URLSearchParams(window.location.search);
    const type = p.get('type'), id = p.get('id');
    if (type && id) updatePlayer(type, id);
};

// Shows or removes the Sub/Dub toggle inside #control-bar.
// Only called when _animeRoute.route === "use_anime" and type === "tv".
function renderAnimeDubToggle(show) {
    const bar = document.getElementById('control-bar');
    if (!bar) return;
    const existing = document.getElementById('anime-dub-control');
    if (!show) { if (existing) existing.remove(); return; }
    if (existing) return;
    const div = document.createElement('div');
    div.id        = 'anime-dub-control';
    div.className = 'server-control';
    div.innerHTML =
        `<span class="server-label">Audio:</span>` +
        `<button class="server-btn${currentAnimeDubType === 'sub' ? ' active' : ''}" onclick="window.changeAnimeDub('sub')">Sub</button>` +
        `<button class="server-btn${currentAnimeDubType === 'dub' ? ' active' : ''}" onclick="window.changeAnimeDub('dub')">Dub</button>`;
    bar.appendChild(div);
}

window.changeAnimeDub = function (dubType) {
    currentAnimeDubType = dubType;
    document.querySelectorAll('#anime-dub-control .server-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.toLowerCase() === dubType);
    });
    const p = new URLSearchParams(window.location.search);
    const type = p.get('type'), id = p.get('id');
    if (type && id) updatePlayer(type, id);
};

async function loadTVSeasons(id) {
    const btn   = document.getElementById('season-dropdown-btn');
    const label = document.getElementById('season-dropdown-label');
    const list  = document.getElementById('season-dropdown-list');
    const wrap  = document.getElementById('season-dropdown');
    if (!btn || !list) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = wrap.classList.toggle('open');
        btn.setAttribute('aria-expanded', isOpen);
    });

    document.addEventListener('click', () => {
        wrap.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
    });

    function selectSeason(num) {
        currentSeason  = num;
        currentEpisode = 1;
        label.textContent = `${TEXTS.season} ${num}`;
        trackEvent('select_season', { content_id: id, season_number: num });
        list.querySelectorAll('.season-option').forEach(el =>
            el.classList.toggle('active', parseInt(el.dataset.value) === num)
        );
        wrap.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        loadEpisodesForSeason(id, currentSeason);
        updatePlayer('tv', id);
        let history = JSON.parse(localStorage.getItem('xudo_history')) || [];
        const idx   = history.findIndex(x => x.id == id);
        if (idx > -1) { history[idx].season = currentSeason; history[idx].episode = currentEpisode; localStorage.setItem('xudo_history', JSON.stringify(history)); }
    }

    try {
        const res = await fetch(`${BASE_URL}/tv/${id}?language=${CURRENT_LANG}`);
        if (!res.ok) throw new Error('TV details failed');
        const d = await res.json();
        list.innerHTML = '';
        d.seasons.forEach(x => {
            if (x.season_number > 0) {
                const li = document.createElement('li');
                li.className  = `season-option${x.season_number === currentSeason ? ' active' : ''}`;
                li.dataset.value = x.season_number;
                li.textContent   = `${TEXTS.season} ${x.season_number}`;
                li.setAttribute('role', 'option');
                li.addEventListener('click', (e) => { e.stopPropagation(); selectSeason(x.season_number); });
                list.appendChild(li);
            }
        });
        label.textContent = `${TEXTS.season} ${currentSeason}`;
        loadEpisodesForSeason(id, currentSeason);
    } catch (error) { console.error('TV seasons load error:', error); }
}

async function loadEpisodesForSeason(id, sn) {
    const grid = document.getElementById('episodes-grid');
    grid.innerHTML = '<div style="color:#888;font-size:0.85rem;padding:10px;">Loading episodes...</div>';
    try {
        const res = await fetch(`${BASE_URL}/tv/${id}/season/${sn}?language=${CURRENT_LANG}`);
        if (!res.ok) throw new Error(`Season ${sn} fetch failed`);
        const d = await res.json();
        grid.className = 'episodes-grid episodes-grid-rich';
        grid.innerHTML = '';
        const PLAY_ICON = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon points="5,3 19,12 5,21"/></svg>`;
        d.episodes.forEach(ep => {
            const thumb    = ep.still_path ? IMG_STILL + ep.still_path : '';
            const epTitle  = sanitizeHTML(ep.name || `Episode ${ep.episode_number}`);
            const epDate   = ep.air_date ? ep.air_date.split('-')[0] : '';
            const isActive = ep.episode_number === currentEpisode;
            const noImg    = !ep.still_path;

            const card      = document.createElement('div');
            card.className  = `ep-card ${isActive ? 'active' : ''}`;
            card.innerHTML  = `
                <div class="ep-card-thumb${noImg ? ' ep-card-thumb--empty' : ''}">
                    ${thumb
                        ? `<img src="${thumb}" alt="Episode ${ep.episode_number}" loading="lazy" onerror="this.style.display='none';this.parentElement.classList.add('ep-card-thumb--empty')">`
                        : ''}
                    <span class="ep-card-num">Ep ${ep.episode_number}</span>
                    <div class="ep-card-play">${PLAY_ICON}</div>
                </div>
                <div class="ep-card-info">
                    <div class="ep-card-title">${epTitle}</div>
                    ${epDate ? `<div class="ep-card-date">${epDate}</div>` : ''}
                </div>
                `;
            card.addEventListener('click', () => {
                currentEpisode = ep.episode_number;
                document.querySelectorAll('.ep-card').forEach(x => x.classList.remove('active'));
                card.classList.add('active');
                trackEvent('select_episode', { content_id: id, season_number: currentSeason, episode_number: ep.episode_number, episode_title: ep.name || '' });
                updatePlayer('tv', id);
                let history = JSON.parse(localStorage.getItem('xudo_history')) || [];
                const hi    = history.findIndex(x => x.id == id);
                if (hi > -1) { history[hi].season = currentSeason; history[hi].episode = currentEpisode; localStorage.setItem('xudo_history', JSON.stringify(history)); }
            });
            grid.appendChild(card);
        });
    } catch (error) {
        console.error('Episodes load error:', error);
        grid.innerHTML = '<span style="color:red;padding:10px;">Failed to load episodes.</span>';
    }
}

// Returns true only when BOTH conditions hold:
//   1. genres includes Animation (TMDB genre id 16)
//   2. origin is Japan — TV uses origin_country (string[]), movie uses production_countries ({iso_3166_1}[])
// Result is written to window._isAnimeContent for downstream slices.
function detectAnime(type, d) {
    const hasAnimation = (d.genres || []).some(g => g.id === 16);
    if (!hasAnimation) return false;
    return type === 'tv'
        ? (d.origin_country || []).includes('JP')
        : (d.production_countries || []).some(c => c.iso_3166_1 === 'JP');
}

// Tokens in candidate titles that signal a multi-season anime series.
// Matches: "Season 2+", "2nd/3rd/Nth Season", "Part 2+", "Final Season",
//          "Cour 2+", and standalone Roman numerals II–IX.
const _MULTI_SEASON_RE = /\b(season\s*[2-9\d]|\d+(?:nd|rd|th)\s+season|part\s*[2-9\d]|final\s+season|cour\s*[2-9]|II|III|IV|VI|VII|VIII|IX)\b/i;

// Resolves whether to use the anime embed route or fall back to standard TV.
// Returns { route: "use_anime", mal_id } or { route: "fallback_tv" }.
// Always falls back on any error — the anime route must never crash the page.
// Result is stored in window._animeRoute for downstream slices.
async function resolveAnimeRoute(tmdbTitle) {
    if (!window._isAnimeContent) return { route: 'fallback_tv' };

    let candidates;
    try {
        const res = await fetch(`/api/mal/search?title=${encodeURIComponent(tmdbTitle)}`);
        if (!res.ok) return { route: 'fallback_tv' };
        const json = await res.json();
        candidates = json.candidates;
    } catch (_) {
        return { route: 'fallback_tv' };
    }

    if (!Array.isArray(candidates) || candidates.length === 0) return { route: 'fallback_tv' };

    // Collect every string title form for a candidate.
    const allTitlesOf = c => {
        const at = c.alternative_titles || {};
        return [c.title, at.en, at.ja, ...(at.synonyms || [])].filter(Boolean);
    };

    // Any candidate carrying a multi-season marker → entire show is multi-season.
    const isMultiSeason = candidates.some(c => allTitlesOf(c).some(t => _MULTI_SEASON_RE.test(t)));
    if (isMultiSeason) return { route: 'fallback_tv' };

    return { route: 'use_anime', mal_id: candidates[0].mal_id };
}

async function fetchMovieDetails(type, id) {
    try {
        const res = await fetch(`${BASE_URL}/${type}/${id}?language=${CURRENT_LANG}`);
        if (!res.ok) return (document.querySelector('.watch-container').innerHTML = '<div class="error-message">Not Found</div>');
        const d = await res.json();
        window._isAnimeContent = detectAnime(type, d);
        try { updateContinueWatching(d); } catch (_) {}

        let overviewClean = (d.overview || '').trim();
        if (!overviewClean && CURRENT_LANG !== 'en-US') {
            try {
                const enRes = await fetch(`${BASE_URL}/${type}/${id}?language=en-US`);
                if (enRes.ok) { const enD = await enRes.json(); overviewClean = (enD.overview || '').trim(); }
            } catch (_) {}
        }

        const title = d.title || d.name;
        window._animeRoute = await resolveAnimeRoute(title);
        const year  = (d.release_date || d.first_air_date || '').split('-')[0] || '----';
        const rt    = type === 'movie' && d.runtime
            ? `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m`
            : (type === 'tv' && d.episode_run_time?.[0] ? `${d.episode_run_time[0]}m / ep` : 'N/A');
        updateSEOMeta(`${title} (${year}) - Reviews & Details | XUDOMovie`, `Read reviews and watch the trailer for ${title}.`);
        trackPageView(`${title} (${year}) | XUDOMovie`, window.location.pathname + window.location.search);

        const seoBlurb = TEXTS.seoBlurb
            .replace('{title}', `<strong>${sanitizeHTML(title)}</strong>`)
            .replace('{host}', `<strong>${sanitizeHTML(window.location.hostname)}</strong>`);
        trackEvent('movie_view', { content_type: type, content_id: id, movie_title: title, release_year: year });
        document.getElementById('detail-title').textContent    = title;
        document.getElementById('detail-overview').innerHTML   = sanitizeHTML(overviewClean || TEXTS.noSynopsis) + `<br><br><span style="color:#888;font-size:0.9rem;">${seoBlurb}</span>`;
        document.getElementById('detail-year').textContent     = year;
        document.getElementById('detail-rating').textContent   = `⭐ ${d.vote_average?.toFixed(1) || 'NR'}`;
        document.getElementById('detail-runtime').textContent  = rt;

        const taglineEl = document.getElementById('detail-tagline');
        if (taglineEl && d.tagline) { taglineEl.textContent = d.tagline; taglineEl.style.display = 'block'; }

        const statusEl = document.getElementById('detail-status');
        if (statusEl && type === 'tv' && d.status) { statusEl.textContent = d.status.toUpperCase(); statusEl.style.display = 'inline-block'; }

        const img = document.getElementById('detail-poster');
        if (img) { img.src = d.poster_path ? IMG_POSTER + d.poster_path : 'https://via.placeholder.com/500x750?text=No+Poster'; img.alt = title; }

        const genres = document.getElementById('detail-genres');
        if (genres && d.genres) genres.innerHTML = d.genres.map(g => `<span class="genre-tag">${sanitizeHTML(g.name)}</span>`).join('');

        window.initPageActionButtons(id, type, title, d.poster_path ? IMG_POSTER + d.poster_path : '', year, d.vote_average?.toFixed(1) || 'NR');
    } catch (error) {
        trackEvent('api_error', { context: 'movie_details', content_type: type, content_id: id, error: error?.message || 'unknown' });
        console.error('Movie details fetch error:', error);
    }
}

async function fetchCertification(type, id) {
    const el = document.getElementById('detail-cert');
    if (!el) return;
    try {
        const res = await fetch(type === 'movie'
            ? `${BASE_URL}/movie/${id}/release_dates`
            : `${BASE_URL}/tv/${id}/content_ratings`
        );
        if (!res.ok) throw new Error('Certification API failed');
        const d = await res.json();
        const c = type === 'movie'
            ? d.results.find(r => r.iso_3166_1 === 'US')?.release_dates.find(x => x.certification)?.certification
            : d.results.find(r => r.iso_3166_1 === 'US')?.rating;
        if (c) { el.textContent = sanitizeHTML(c); el.style.display = 'inline-block'; }
    } catch (error) { console.warn('Could not fetch certification:', error); }
}

async function fetchCast(type, id) {
    try {
        const res = await fetch(`${BASE_URL}/${type}/${id}/credits?language=${CURRENT_LANG}`);
        if (!res.ok) throw new Error('Credits fetch failed');
        const d    = await res.json();
        const list = document.getElementById('cast-list');
        const castWithPhoto = (d.cast || []).filter(a => a.profile_path);
        if (castWithPhoto.length) {
            list.innerHTML = castWithPhoto.slice(0, 10).map(a => {
                const name      = sanitizeHTML(a.name);
                const character = sanitizeHTML(a.character);
                return `<div class="cast-card" onclick="location.href='person.html?id=${a.id}'" style="cursor:pointer;">
                    <img src="https://image.tmdb.org/t/p/w200${a.profile_path}" class="cast-img">
                    <div class="cast-name">${name}</div>
                    <div class="cast-character">${character}</div>
                </div>`;
            }).join('');
        } else {
            list.innerHTML = '<div style="color:#666;font-size:0.8rem;">No cast info available.</div>';
        }
    } catch (error) { console.error('Cast fetch error:', error); }
}

async function fetchSimilarMovies(type, id) {
    try {
        const res = await fetch(`${BASE_URL}/${type}/${id}/recommendations?language=${CURRENT_LANG}`);
        if (!res.ok) throw new Error('Recommendations failed');
        const d = await res.json();
        if (d.results.length) {
            document.getElementById('rec-slider').innerHTML = d.results.map(i => createCardHTML(i, type)).join('');
        } else {
            const fallback = await fetch(`${BASE_URL}/${type}/${id}/similar?language=${CURRENT_LANG}`);
            const fd       = await fallback.json();
            document.getElementById('rec-slider').innerHTML = fd.results?.length ? fd.results.map(i => createCardHTML(i, type)).join('') : '';
        }
        attachCardDelegation('#rec-slider');
    } catch (error) { console.error('Similar content error:', error); }
}

const pickTrailerVideo = results =>
    results.find(v => v.type === 'Trailer' && v.site === 'YouTube') ||
    results.find(v => v.site === 'YouTube');

async function fetchTrailerKey(type, id) {
    try {
        let res  = await fetch(`${BASE_URL}/${type}/${id}/videos?language=${CURRENT_LANG}`);
        let d    = await res.json();
        let trailer = pickTrailerVideo(d.results || []);

        if (!trailer && CURRENT_LANG !== 'en-US') {
            res     = await fetch(`${BASE_URL}/${type}/${id}/videos?language=en-US`);
            d       = await res.json();
            trailer = pickTrailerVideo(d.results || []);
        }
        return trailer ? trailer.key : null;
    } catch (e) {
        console.error('Trailer error', e);
        return null;
    }
}

window.openTrailer = async function () {
    const p    = new URLSearchParams(window.location.search);
    const type = p.get('type'), id = p.get('id');
    if (!type || !id) return;
    trackEvent('trailer_click', { content_type: type, content_id: id });

    const key = await fetchTrailerKey(type, id);
    if (key) {
        document.getElementById('trailer-video-container').innerHTML =
            `<iframe src="https://www.youtube.com/embed/${key}?autoplay=1&cc_load_policy=0"
                     allow="autoplay;encrypted-media" allowfullscreen
                     style="border:none;width:100%;height:100%;"></iframe>`;
        document.getElementById('trailer-modal').classList.add('show');
    } else {
        showToast('Trailer not available for this title.');
    }
};

window.openTrailerModal = function (videoKey) {
    if (!videoKey || videoKey.includes('{{')) return;
    document.getElementById('trailer-video-container').innerHTML = `<iframe src="https://www.youtube.com/embed/${videoKey}?autoplay=1&cc_load_policy=0" allow="autoplay;encrypted-media" allowfullscreen style="border:none;"></iframe>`;
    document.getElementById('trailer-modal').classList.add('show');
};

window.closeTrailer = function () {
    document.getElementById('trailer-modal').classList.remove('show');
    document.getElementById('trailer-video-container').innerHTML = '';
};

window.shareMovie = () => {
    trackEvent('share', { method: navigator.share ? 'native' : 'clipboard', content_type: 'movie', item_id: location.href });
    if (navigator.share) {
        navigator.share({ title: document.title, text: `Watch ${document.title}`, url: location.href }).catch(() => {});
    } else {
        navigator.clipboard.writeText(location.href).catch(() => prompt('Copy link:', location.href));
    }
};

async function initPersonPage() {
    initScrollDepthTracking();
    const p  = new URLSearchParams(window.location.search);
    const id = p.get('id');
    if (!id) return (window.location.href = 'index.html');
    const container = document.getElementById('person-container');
    if (!container) return;
    container.innerHTML = `<div style="color:var(--text-muted);padding:60px 0;text-align:center;">${TEXTS.loading}</div>`;

    try {
        const [detailRes, creditRes] = await Promise.all([
            fetch(`${BASE_URL}/person/${id}?language=${CURRENT_LANG}`),
            fetch(`${BASE_URL}/person/${id}/combined_credits?language=${CURRENT_LANG}`)
        ]);
        if (!detailRes.ok) throw new Error('Person not found');
        const d       = await detailRes.json();
        const credits = creditRes.ok ? await creditRes.json() : { cast: [], crew: [] };

        updateSEOMeta(`${d.name} — Filmography & Biography | XUDOMovie`, `Explore the filmography, biography, and career of ${d.name} on XUDOMovie.`);
        trackPageView(`${d.name} — Filmography & Biography | XUDOMovie`, window.location.pathname + window.location.search);
        trackEvent('person_view', { person_id: id, person_name: d.name, department: d.known_for_department || '' });

        const badges = [];
        if (d.known_for_department) badges.push(`<span class="person-badge person-known-for">${deptLabel(d.known_for_department)}</span>`);
        if (d.birthday)             badges.push(`<span class="person-badge">Born: ${d.birthday}</span>`);
        if (d.place_of_birth)       badges.push(`<span class="person-badge">${d.place_of_birth}</span>`);
        if (d.deathday)             badges.push(`<span class="person-badge">Died: ${d.deathday}</span>`);

        const photo       = d.profile_path ? IMG_POSTER + d.profile_path : "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='220' height='330' viewBox='0 0 220 330' fill='%231a1a1a'%3e%3crect width='220' height='330' fill='%231a1a1a'/%3e%3ccircle cx='110' cy='120' r='50' fill='%23333'/%3e%3cellipse cx='110' cy='280' rx='80' ry='60' fill='%23333'/%3e%3c/svg%3e";
        let bioClean      = (d.biography || '').trim();
        if (!bioClean && CURRENT_LANG !== 'en-US') {
            try {
                const enRes = await fetch(`${BASE_URL}/person/${id}?language=en-US`);
                if (enRes.ok) { const enD = await enRes.json(); bioClean = (enD.biography || '').trim(); }
            } catch (_) {}
        }
        const bioText     = sanitizeHTML(bioClean || TEXTS.noBio);
        const needsToggle = bioClean.length > 400;

        container.innerHTML = `
            <div class="person-hero">
                <div class="person-photo-wrap">
                    <img src="${photo}" alt="${sanitizeHTML(d.name)}" class="person-photo" loading="lazy">
                </div>
                <div class="person-details">
                    <h1 class="person-name">${sanitizeHTML(d.name)}</h1>
                    <div class="person-meta-row">${badges.join('')}</div>
                    <div class="person-bio" id="person-bio">${bioText}</div>
                    ${needsToggle ? `<button class="person-bio-toggle" id="bio-toggle" onclick="togglePersonBio()">${TEXTS.readMore}</button>` : ''}
                </div>
            </div>
            <div>
                <h2 class="person-section-title">${TEXTS.filmography}</h2>
                <div class="person-tabs">
                    <button id="tab-movie" class="person-tab-btn active" onclick="filterPersonCredits('movie')">${TEXTS.tabMovies}</button>
                    <button id="tab-tv" class="person-tab-btn" onclick="filterPersonCredits('tv')">${TEXTS.tabTV}</button>
                </div>
                <div class="person-filmography-grid" id="filmography-grid"></div>
                <div class="load-more-container">
                    <button id="filmography-load-more" class="load-more-btn" style="display:none;" onclick="loadMorePersonCredits()">${TEXTS.loadMore}</button>
                </div>
            </div>`;

        attachCardDelegation('#filmography-grid');

        const seen        = new Set();
        const creditDate  = i => i.release_date || i.first_air_date || '';
        const allCredits  = (credits.cast || []).filter(i => {
            if ((i.media_type !== 'movie' && i.media_type !== 'tv') || !i.poster_path) return false;
            const key = `${i.media_type}:${i.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).sort((a, b) => {
            const da = creditDate(a), db = creditDate(b);
            if (da !== db) {
                if (!da) return 1;   // tanpa tanggal -> taruh paling bawah
                if (!db) return -1;
                return db < da ? -1 : 1;   // terbaru -> terlama
            }
            return (b.popularity || 0) - (a.popularity || 0);
        });

        container._credits = allCredits;
        renderPersonCredits(allCredits.filter(i => i.media_type === 'movie'));

    } catch (err) {
        trackEvent('api_error', { context: 'person_page', person_id: id, error: err?.message || 'unknown' });
        container.innerHTML = `<div style="color:var(--main-red);padding:60px 0;text-align:center;">${TEXTS.errorPerson}</div>`;
    }
}

const FILMOGRAPHY_PAGE_SIZE = 60;

function renderPersonCredits(credits) {
    const grid = document.getElementById('filmography-grid');
    const btn  = document.getElementById('filmography-load-more');
    if (!grid) return;

    grid._list  = credits;
    grid._shown = 0;

    if (!credits.length) {
        grid.innerHTML = `<div class="no-results">${TEXTS.noFilmography}</div>`;
        if (btn) btn.style.display = 'none';
        return;
    }
    grid.innerHTML = '';
    appendPersonCredits();
}

function appendPersonCredits() {
    const grid = document.getElementById('filmography-grid');
    const btn  = document.getElementById('filmography-load-more');
    if (!grid || !grid._list) return;

    const next = grid._list.slice(grid._shown, grid._shown + FILMOGRAPHY_PAGE_SIZE);
    if (next.length) {
        grid.insertAdjacentHTML('beforeend', next.map(i => createCardHTML(i, i.media_type)).join(''));
        grid._shown += next.length;
    }

    if (btn) {
        btn.textContent   = TEXTS.loadMore;
        btn.style.display = grid._shown < grid._list.length ? 'inline-block' : 'none';
    }
}

window.loadMorePersonCredits = function () {
    const grid = document.getElementById('filmography-grid');
    appendPersonCredits();
    if (grid) trackEvent('load_more', { endpoint: 'person_filmography', shown: grid._shown, total: grid._list?.length || 0 });
};

window.filterPersonCredits = function (type) {
    document.querySelectorAll('.person-tab-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`tab-${type}`) || document.querySelector('.person-tab-btn:first-child');
    if (activeBtn) activeBtn.classList.add('active');
    const container = document.getElementById('person-container');
    if (!container?._credits) return;
    renderPersonCredits(container._credits.filter(i => i.media_type === type));
};

window.togglePersonBio = function () {
    const bio = document.getElementById('person-bio');
    const btn = document.getElementById('bio-toggle');
    if (!bio || !btn) return;
    const expanded   = bio.classList.toggle('expanded');
    btn.textContent  = expanded ? TEXTS.showLess : TEXTS.readMore;
};

let _page = null;

window.initPageActionButtons = function (id, type, title, poster, year, rating) {
    _page = { id: +id, type, title, poster, year: String(year), rating: String(rating) };
    _refreshPageButtons();
};

function _refreshPageButtons() {
    const favBtn = document.getElementById('page-fav-btn');
    const wlBtn  = document.getElementById('page-wl-btn');
    if (!favBtn || !wlBtn || !_page) return;

    const isFav  = isFavorite(_page.id);
    favBtn.classList.toggle('active', isFav);
    const favLabel = favBtn.querySelector('span') || favBtn.appendChild(document.createElement('span'));
    favLabel.textContent = isFav ? 'SAVED ✓' : 'FAVORITE';
    const favIcon = favBtn.querySelector('svg');
    if (favIcon) { favIcon.style.fill = isFav ? '#e50914' : 'none'; favIcon.style.stroke = isFav ? '#e50914' : 'currentColor'; }

    const isWL  = isWatchLater(_page.id);
    wlBtn.classList.toggle('active', isWL);
    const wlLabel = wlBtn.querySelector('span') || wlBtn.appendChild(document.createElement('span'));
    wlLabel.textContent = isWL ? 'IN LIST ✓' : 'WATCH LATER';
}

window.togglePageFav = function () {
    if (!_page) return;
    let favs  = JSON.parse(localStorage.getItem('xudo_favs')) || [];
    const idx = favs.findIndex(f => f.id == _page.id);
    if (idx === -1) favs.push({ id: _page.id, type: _page.type, title: _page.title, poster: _page.poster, year: _page.year, rating: _page.rating });
    else            favs.splice(idx, 1);
    localStorage.setItem('xudo_favs', JSON.stringify(favs));
    _refreshPageButtons();
};

window.togglePageWatchLater = function () {
    if (!_page) return;
    let list  = JSON.parse(localStorage.getItem('xudo_watch_later')) || [];
    const idx = list.findIndex(f => f.id == _page.id);
    if (idx === -1) list.push({ id: _page.id, type: _page.type, title: _page.title, poster: _page.poster, year: _page.year, rating: _page.rating });
    else            list.splice(idx, 1);
    localStorage.setItem('xudo_watch_later', JSON.stringify(list));
    _refreshPageButtons();
};

function initBackToTop() {
    const btn       = document.createElement('button');
    btn.className   = 'back-to-top';
    btn.setAttribute('aria-label', 'Back to top');
    btn.innerHTML   = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"></polyline></svg>`;
    document.body.appendChild(btn);

    window.addEventListener('scroll', () => { btn.classList.toggle('visible', window.scrollY > 400); }, { passive: true });
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function initAdBlockDetection() {
    const dismissed = localStorage.getItem('xudo_adblock_dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 86400000) return;

    const bait = document.createElement('div');
    bait.className = 'adsbygoogle ad-banner adsbox doubleclick ad-placement';
    bait.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;pointer-events:none;';
    bait.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bait);

    requestAnimationFrame(() => {
        setTimeout(() => {
            const blocked = bait.offsetHeight === 0 || bait.offsetWidth === 0 || bait.style.display === 'none' || !document.body.contains(bait);
            bait.remove();
            if (blocked) showAdBlockBanner();
        }, 150);
    });
}

function showAdBlockBanner() {
    if (document.getElementById('adblock-banner')) return;
    const banner      = document.createElement('div');
    banner.id         = 'adblock-banner';
    banner.className  = 'adblock-banner';
    banner.innerHTML  = `
        <div class="adblock-banner-text">
            <div class="adblock-banner-title">❤️ We noticed you're using an ad blocker</div>
            <div class="adblock-banner-sub">Ads keep <strong>${sanitizeHTML(window.location.hostname)}</strong> free. No pop-ups, no autoplay audio. Please whitelist us.</div>
        </div>
        <div class="adblock-banner-actions">
            <button class="adblock-dismiss-btn" onclick="dismissAdBlockBanner()">Maybe later</button>
            <button class="adblock-whitelist-btn" onclick="dismissAdBlockBanner(true)">I've whitelisted ✓</button>
        </div>`;
    document.body.appendChild(banner);
    requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('show')));
}

window.dismissAdBlockBanner = function () {
    const banner = document.getElementById('adblock-banner');
    if (banner) {
        banner.classList.remove('show');
        banner.addEventListener('transitionend', () => banner.remove(), { once: true });
    }
    localStorage.setItem('xudo_adblock_dismissed', Date.now().toString());
};


document.addEventListener('DOMContentLoaded', () => {
    updateCanonical();
    initContentProtection();
    initCustomSelect();
    initThemeToggle();
    initHeaderScroll();
    initBackToTop();
    initAdBlockDetection();

    const pageRouter = () => {
        if      (document.getElementById('hero-slider'))      initHome();
        else if (document.getElementById('browse-grid'))      initBrowse();
        else if (document.getElementById('player-container')) initWatchPage();
        else if (document.getElementById('person-container')) initPersonPage();
    };

    const initHeaderDependent = () => {
        initSearchEvents();
        initLanguageSelector();
    };

    if (document.getElementById('search-input')) {
        
        initHeaderDependent();
        pageRouter();
    } else {
        document.addEventListener('header-loaded', () => {
            initHeaderDependent();
            pageRouter();
        });
    }
});
