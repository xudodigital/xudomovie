/* DramaTap catalogue on the homepage, native/HLS playback in the existing watch.html layout. */
(function (root) {
    'use strict';
    const ID = /^[1-9]\d{0,11}$/;
    const providers = { dramatap: 'DramaTap' };
    const FALLBACK = { shortDramaSection: 'Short Drama', viewMore: 'View More', loading: 'Loading…', noSynopsis: '', loadMore: 'Load More', contWatch: 'Continue Watching', selectEpisode: 'Select Episode', share: 'Share', youMayAlsoLike: 'You May Also Like', sdTrending: 'Trending', sdLatest: 'Latest', sdEpisodes: 'episodes', sdViews: 'views', sdEpisode: 'Episode {n}', sdRetry: 'Try again', sdPrev: 'Previous episode', sdNext: 'Next episode', sdPrevShort: 'Prev', sdNextShort: 'Next', sdEmpty: 'No dramas found.', sdUnavailable: 'Short dramas are temporarily unavailable. Please try again later.', sdPlayError: 'This video could not be played. Try again to refresh the stream or select another episode.', sdNoStream: 'No playable stream is available for this episode.', sdNoEpisodes: 'No episodes are available yet.' };
    // Same language source as js/main.js (TRANSLATIONS[xudo_lang]); missing keys fall back to English.
    function texts() {
        let language = 'en-US';
        try { language = localStorage.getItem('xudo_lang') || language; } catch (_) {}
        const all = root.XUDO_I18N?.TRANSLATIONS || {};
        return { ...FALLBACK, ...all['en-US'], ...all[language] };
    }
    const episodeLabel = (t, number) => t.sdEpisode.replace('{n}', number);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    function mediaURL(value) {
        try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
    }
    const HEART_OUTLINE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    const HEART_FILLED = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    // isFavorite() lives in js/main.js; without it (tests, other pages) cards simply render unsaved.
    const isSaved = id => typeof isFavorite === 'function' && isFavorite(id, 'shortdrama');
    function progressHTML(item, t) {
        if (!ID.test(String(item.episode || ''))) return '';
        const { position, duration } = item.progress || {};
        const percent = Number.isFinite(position) && Number.isFinite(duration) && duration > 0 ? Math.max(0, Math.min(100, Math.round(position / duration * 100))) : null;
        return `<div class="card-watch-progress">${percent === null ? '' : `<progress max="100" value="${percent}" aria-label="${esc(t.contWatch)}"></progress>`}<span>${esc(episodeLabel(t, item.episode))}${percent === null ? '' : ` · ${percent}%`}</span></div>`;
    }
    const EYE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    function viewsHTML(item, t) {
        if (!Number.isFinite(item.views) || item.views <= 0) return '';
        let language = 'en-US';
        try { language = localStorage.getItem('xudo_lang') || language; } catch (_) {}
        let compact;
        try { compact = new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(item.views); } catch (_) { compact = String(item.views); }
        return `<span class="card-rating sd-views" title="${esc(`${item.views.toLocaleString()} ${t.sdViews}`)}">${EYE} ${esc(compact)}</span>`;
    }
    function card(item) {
        if (!item || !Object.hasOwn(providers, item.provider) || !ID.test(item.id || '') || !item.title) return '';
        const t = texts(), href = watchURL(item.id, item.episode);
        const poster = mediaURL(item.poster), saved = isSaved(item.id);
        const count = Number.isFinite(item.episodeCount) && item.episodeCount > 0 ? item.episodeCount : 0;
        return `<div class="content-card sd-serial-card" data-sd-id="${item.id}"><a class="sd-card-link" href="${esc(href)}"><div class="sd-serial-poster">${poster ? `<img src="${esc(poster)}" alt="${esc(item.title)}" loading="lazy" referrerpolicy="no-referrer">` : '<span class="sd-poster-placeholder" aria-hidden="true">▶</span>'}${count ? `<span class="sd-duration">${count} ${t.sdEpisodes}</span>` : ''}${viewsHTML(item, t)}</div><div class="card-info"><div class="card-title">${esc(item.title)}</div><div class="card-year">${esc(t.shortDramaSection)}</div>${progressHTML(item, t)}</div></a><button type="button" class="card-fav-btn ${saved ? 'active' : ''}" data-fav-id="${item.id}" data-fav-type="shortdrama" data-fav-title="${encodeURIComponent(item.title)}" data-fav-poster="${encodeURIComponent(poster)}" data-fav-episodes="${count}" aria-pressed="${saved}" aria-label="${esc(item.title)}">${saved ? HEART_FILLED : HEART_OUTLINE}</button></div>`;
    }
    // Rows that main.js does not delegate (homepage row, watch-page recommendations) toggle favourites here.
    function bindFavorites(container) {
        container.addEventListener('click', event => {
            const button = event.target.closest('.card-fav-btn');
            if (!button || !container.contains(button) || typeof root.toggleFavoriteCore !== 'function') return;
            event.preventDefault(); event.stopPropagation();
            const d = button.dataset;
            root.toggleFavoriteCore(d.favId, 'shortdrama', decodeURIComponent(d.favTitle), decodeURIComponent(d.favPoster), '', '', button, { episodes: Number(d.favEpisodes) || 0 });
            button.setAttribute('aria-pressed', String(button.classList.contains('active')));
        });
    }
    async function request(route, params, signal) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        if (signal?.aborted) abort();
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, 15000);
        try {
            const res = await fetch(`/api/shortdrama/${route}?${new URLSearchParams(params)}`, { signal: controller.signal });
            const data = await res.json();
            if (!res.ok) throw Object.assign(new Error(data.code || 'PROVIDER_UNAVAILABLE'), { code: data.code });
            return data;
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    }
    let hlsPromise;
    function loadHls() {
        if (root.Hls) return Promise.resolve(root.Hls);
        if (!hlsPromise) hlsPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/js/vendor/hls.light.min.js?v=1.7.3';
            script.onload = () => root.Hls ? resolve(root.Hls) : reject(new Error('HLS unavailable'));
            script.onerror = () => { script.remove(); hlsPromise = null; reject(new Error('HLS unavailable')); };
            document.head.appendChild(script);
        });
        return hlsPromise;
    }
    function watchURL(id, episode = '1') {
        return `watch.html?type=shortdrama&id=${encodeURIComponent(id)}&e=${ID.test(String(episode)) ? episode : '1'}`;
    }
    const BROWSE_URL = 'browse.html?type=shortdrama&titleKey=shortDramaSection';
    // Same markup as the other homepage rows: heading and "View More" both open the browse page.
    function mount(page, { items = [], title } = {}) {
        const t = texts();
        page.classList.add('sd-serial-page');
        page.innerHTML = `<div class="section-header"><h2 class="section-heading"><a href="${BROWSE_URL}">${esc(title || t.shortDramaSection)}</a></h2><a href="${BROWSE_URL}" class="section-more-link">${esc(t.viewMore)} ›</a></div>
            <div class="horizontal-slider">${items.map(item => card(item)).join('')}</div>`;
        bindFavorites(page.querySelector('.horizontal-slider'));
    }
    // Browse page: one feed per tab (latest first). Latest is paginated upstream and uses Load More; trending is a single page.
    async function browse(grid, feed = 'latest') {
        const t = texts(), loadMore = document.getElementById('load-more-btn');
        const token = grid.dataset.feed = `${feed}:${Date.now()}`;
        const current = () => grid.dataset.feed === token;
        let page = 0;
        if (loadMore) { loadMore.style.display = 'none'; loadMore.textContent = t.loadMore; loadMore.disabled = false; loadMore.onclick = null; }
        grid.innerHTML = `<div class="no-results" role="status">${esc(t.loading)}</div>`;
        async function load() {
            if (loadMore) loadMore.disabled = true;
            try {
                const data = await request('catalog', feed === 'latest' ? { provider: 'dramatap', feed, page: page + 1 } : { provider: 'dramatap', feed });
                if (!current()) return;
                if (!page) grid.replaceChildren();
                page += 1;
                const shown = new Set([...grid.querySelectorAll('[data-sd-id]')].map(el => el.dataset.sdId));
                grid.insertAdjacentHTML('beforeend', (data.items || []).filter(item => !shown.has(item.id)).map(item => card(item)).join(''));
                if (!grid.children.length) grid.innerHTML = `<div class="no-results" role="status">${esc(t.sdEmpty)}</div>`;
                if (loadMore) loadMore.style.display = data.hasMore ? '' : 'none';
            } catch (_) {
                if (!current()) return;
                if (!page) grid.innerHTML = `<div class="no-results" role="status">${esc(t.sdUnavailable)}</div>`;
                else if (loadMore) loadMore.style.display = '';
            } finally { if (loadMore && current()) loadMore.disabled = false; }
        }
        if (loadMore) loadMore.onclick = load;
        if (!grid.dataset.favBound) { grid.dataset.favBound = '1'; bindFavorites(grid); }
        await load();
    }
    async function initWatch({ onView, history } = {}) {
        const t = texts(), provider = 'dramatap';
        const params = new URLSearchParams(root.location.search), id = params.get('id');
        const player = document.getElementById('player-container'), controls = document.getElementById('control-bar');
        document.body.classList.add('sd-watch-page'); player.classList.add('sd-watch-player');
        // One row: previous · current episode · next. The server picker / settings area of watch.html is unused here.
        document.getElementById('server-selector').innerHTML = `<button type="button" class="sd-episode-nav sd-prev" aria-label="${esc(t.sdPrev)}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg><span>${esc(t.sdPrevShort)}</span></button><div class="sd-now"><span class="sd-play-status" role="status">${esc(t.loading)}</span><button type="button" class="sd-stream-retry" hidden>${esc(t.sdRetry)}</button></div><button type="button" class="sd-episode-nav sd-episode-nav-next sd-next" aria-label="${esc(t.sdNext)}"><span>${esc(t.sdNextShort)}</span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></button>`;
        const tools = document.getElementById('watch-tools'); tools.hidden = true;
        const status = controls.querySelector('.sd-play-status'), retry = controls.querySelector('.sd-stream-retry'), previous = controls.querySelector('.sd-prev'), next = controls.querySelector('.sd-next');
        previous.disabled = next.disabled = true;
        const tv = document.getElementById('tv-controls'), grid = document.getElementById('episodes-grid');
        tv.style.display = 'block'; document.getElementById('season-dropdown').style.display = 'none';
        document.getElementById('select-episode-title').textContent = t.selectEpisode;
        document.getElementById('btn-share-text').textContent = t.share;
        document.querySelector('.cast-section').hidden = true;
        for (const key of ['detail-rating', 'detail-cert', 'detail-status']) document.getElementById(key).hidden = true;
        document.querySelectorAll('.metadata > .quality').forEach(el => { if (el.id !== 'detail-runtime') el.style.display = 'none'; });
        // The static "HD" chip becomes the real stream resolution once the video reports it.
        const resolution = [...document.querySelectorAll('.metadata > .quality')].find(el => !el.id);
        const showResolution = () => {
            // Vertical video is labelled by its short side (720x1280 is 720p).
            const height = Math.min(video.videoWidth || Infinity, video.videoHeight || Infinity);
            if (!resolution || !Number.isFinite(height)) return;
            resolution.textContent = `${[2160, 1440, 1080, 720, 480, 360].find(h => height >= h * 0.9) || height}p`; resolution.style.display = '';
        };
        document.getElementById('detail-year').textContent = t.shortDramaSection;
        document.getElementById('detail-runtime').textContent = '';
        document.getElementById('detail-title').textContent = t.loading;
        document.getElementById('detail-overview').textContent = '';
        document.querySelector('.recommendations-section').hidden = true;
        if (!ID.test(id || '')) { status.textContent = t.sdUnavailable; document.getElementById('detail-title').textContent = t.shortDramaSection; return; }
        const video = document.createElement('video'); video.className = 'player-frame sd-watch-video'; video.controls = true; video.playsInline = true; video.preload = 'metadata'; player.replaceChildren(video);
        video.addEventListener('loadedmetadata', showResolution); video.addEventListener('resize', showResolution);
        let hls, controller, version = 0, episodeList = [], selectedIndex = -1, drama = null, lastSave = 0;
        // Continue Watching: save position every 5 s, on pause and on leaving; finishing an episode points to the next one.
        function persist(finished = false) {
            const episode = episodeList[selectedIndex];
            if (!history || !drama || !episode) return;
            const next = episodeList[selectedIndex + 1];
            if (finished) return next ? history.save(drama, next.id) : history.save(drama, episode.id, { position: video.duration, duration: video.duration, completed: true });
            const { currentTime: position, duration } = video;
            if (Number.isFinite(duration) && duration > 0 && position >= 1) history.save(drama, episode.id, { position, duration, completed: duration - position <= 3 });
        }
        video.addEventListener('timeupdate', () => { if (Date.now() - lastSave > 5000) { lastSave = Date.now(); persist(); } });
        video.addEventListener('pause', () => persist());
        const stop = () => { if (resolution) resolution.style.display = 'none'; hls?.destroy(); hls = null; video.pause(); video.removeAttribute('src'); video.load(); };
        const error = message => { status.textContent = message; retry.hidden = false; };
        async function setSource(source, token, autoplay = false, position = 0) {
            stop(); if (!source || !mediaURL(source.url)) return error(t.sdNoStream);
            video.onloadedmetadata = () => { if (token !== version) return; if (position && Number.isFinite(video.duration)) video.currentTime = Math.min(position, video.duration); if (autoplay) video.play().catch(() => {}); };
            video.onerror = () => { if (token === version) error(t.sdPlayError); };
            try {
                const nativeHls = /Apple/.test(root.navigator?.vendor || '') && video.canPlayType('application/vnd.apple.mpegurl');
                if (source.type === 'hls' && !nativeHls) {
                    const Hls = await loadHls(); if (token !== version) return;
                    if (Hls.isSupported()) {
                        hls = new Hls(); hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal && token === version) error(t.sdPlayError); }); hls.loadSource(source.url); hls.attachMedia(video);
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = source.url; video.load(); } else error(t.sdPlayError);
                } else { video.src = source.url; video.load(); }
            } catch (_) { if (token === version) error(t.sdPlayError); }
        }
        async function selectEpisode(index, autoplay = false, refresh = false, position = 0) {
            if (!episodeList[index]) return;
            selectedIndex = index; const token = ++version; controller?.abort(); controller = new AbortController(); stop();
            retry.hidden = true; status.textContent = `${episodeLabel(t, episodeList[index].number)} · ${t.loading}`;
            grid.querySelectorAll('button').forEach((button, i) => { button.classList.toggle('active', i === index); button.setAttribute('aria-pressed', String(i === index)); });
            previous.disabled = index === 0; next.disabled = index === episodeList.length - 1;
            const url = new URL(root.location.href); url.searchParams.set('e', episodeList[index].id); root.history.replaceState(null, '', url);
            try {
                if (refresh) {
                    const data = await request('episodes', { provider, id }, controller.signal); if (token !== version) return;
                    episodeList[index] = data.episodes?.find(e => e.id === episodeList[index].id) || { ...episodeList[index], sources: [] };
                }
                if (token !== version) return;
                const sources = episodeList[index].sources;
                if (!sources?.length) return error(t.sdNoStream);
                status.textContent = episodeLabel(t, episodeList[index].number);
                await setSource(sources[0], token, autoplay, position);
            } catch (e) { if (token === version) error(t.sdPlayError); }
        }
        async function load() {
            const token = ++version; controller?.abort(); controller = new AbortController(); stop(); retry.hidden = true; status.textContent = t.loading;
            try {
                drama = await request('detail', { provider, id }, controller.signal); if (token !== version) return;
                document.title = `${drama.title} | XUDOMovie`; document.getElementById('detail-title').textContent = drama.title;
                document.getElementById('detail-overview').textContent = /^[A-Z]{1,6}\d{2,}$/.test(drama.synopsis || '') ? '' : drama.synopsis || t.noSynopsis;
                document.getElementById('detail-runtime').textContent = drama.episodeCount ? `${drama.episodeCount} ${t.sdEpisodes}` : '';
                const poster = document.getElementById('detail-poster'); poster.alt = drama.title;
                if (mediaURL(drama.poster)) { poster.src = mediaURL(drama.poster); video.poster = mediaURL(drama.poster); } else poster.removeAttribute('src');
                document.querySelector('meta[name="description"]')?.setAttribute('content', drama.synopsis || drama.title);
                onView?.(drama);
                const data = await request('episodes', { provider, id }, controller.signal); if (token !== version) return;
                episodeList = data.episodes || []; grid.replaceChildren();
                if (!episodeList.length) { status.textContent = t.sdNoEpisodes; return; }
                for (const [i, episode] of episodeList.entries()) {
                    const button = document.createElement('button'); button.type = 'button'; button.className = 'ep-btn'; button.textContent = String(episode.number); button.title = episode.title; button.setAttribute('aria-label', episodeLabel(t, episode.number)); button.onclick = () => selectEpisode(i, true); grid.append(button);
                }
                previous.onclick = () => selectEpisode(selectedIndex - 1, true); next.onclick = () => selectEpisode(selectedIndex + 1, true);
                retry.onclick = () => selectEpisode(selectedIndex, true, true, video.currentTime || 0); video.onended = () => { persist(true); selectEpisode(selectedIndex + 1, true); };
                const wanted = new URLSearchParams(root.location.search).get('e') || '1';
                const index = Math.max(0, episodeList.findIndex(e => e.id === wanted)), saved = history?.get(id);
                const resume = saved?.episode === episodeList[index].id && saved.progress && !saved.progress.completed && saved.progress.position > 5 ? saved.progress.position : 0;
                await selectEpisode(index, false, false, resume);
            } catch (e) { if (token === version) { error(t.sdUnavailable); retry.onclick = load; } }
        }
        root.addEventListener('pagehide', () => { persist(); ++version; controller?.abort(); stop(); }, { once: true });
        await load();
        // Recommendations reuse the existing watch-page slider and normal watch.html links.
        bindFavorites(document.getElementById('rec-slider'));
        request('catalog', { provider, feed: 'trending' }).then(data => {
            const recommendations = data.items?.filter(item => item.id !== id) || [];
            if (!recommendations.length || !player.isConnected) return;
            document.getElementById('rec-title').textContent = t.youMayAlsoLike;
            document.getElementById('rec-slider').innerHTML = recommendations.map(item => card(item)).join(''); document.querySelector('.recommendations-section').hidden = false;
        }).catch(() => {});
    }
    root.XUDO_SHORT_SERIAL = { card, request, mount, browse, initWatch, watchURL, mediaURL };
})(window);
