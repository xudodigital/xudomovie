const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const catalog = require('../js/catalog-policy.js');
const cutoff = '2026-10-17';
const movie = { id: 1, title: 'Released movie', media_type: 'movie', release_date: '2020-01-01', vote_average: 7.2, vote_count: 10, poster_path: '/poster.jpg' };
const tv = { id: 2, name: 'Aired TV', media_type: 'tv', first_air_date: '2020-01-01', vote_average: 8, vote_count: 12, poster_path: '/poster.jpg' };

function loadApp(elements = {}) {
    const saved = new Map([['xudo_lang', 'en-US']]);
    const context = vm.createContext({
        window: { location: { hostname: 'localhost', search: '' } }, URLSearchParams, AbortController, setTimeout, clearTimeout,
        localStorage: { getItem: k => saved.get(k) || null, setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) },
        document: { addEventListener() {}, getElementById: id => elements[id] || null },
    });
    for (const file of ['js/i18n/translations.js', 'js/player-progress.js', 'js/catalog-policy.js', 'js/main.js'])
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
    return { context, saved };
}

for (const [label, changes] of [
    ['zero rating', { vote_average: 0 }], ['missing rating', { vote_average: undefined }],
    ['null rating', { vote_average: null }], ['NaN rating', { vote_average: NaN }],
    ['infinite rating', { vote_average: Infinity }], ['text rating', { vote_average: '7.2' }],
    ['negative rating', { vote_average: -1 }], ['rating above ten', { vote_average: 11 }],
    ['zero votes despite a score', { vote_count: 0 }], ['future release', { release_date: '2026-10-18' }],
    ['missing release date', { release_date: undefined }], ['year-only release', { release_date: '2020' }],
    ['invalid calendar date', { release_date: '2025-02-29' }], ['malformed date', { release_date: '2020-1-1' }],
    ['unreleased status despite past date', { status: 'Post Production' }],
]) test(`Catalogue rejects ${label}`, () => assert.equal(catalog.isEligible({ ...movie, ...changes }, null, cutoff), false));

test('Catalogue accepts rated releases today and earlier, including low-rated films and returning TV', () => {
    assert.equal(catalog.isEligible({ ...movie, release_date: cutoff, status: 'Released', vote_average: 1 }, null, cutoff), true);
    assert.equal(catalog.isEligible({ ...tv, status: 'Returning Series' }, null, cutoff), true);
    assert.equal(catalog.isEligible({ ...tv, first_air_date: '2026-10-18' }, null, cutoff), false);
    assert.equal(catalog.isEligible({ ...tv, first_air_date: undefined, release_date: '2020-01-01' }, null, cutoff), false);
    assert.equal(catalog.isEligible({ ...movie, media_type: 'person' }, null, cutoff), false);
    assert.equal(catalog.isEligible({ ...movie, vote_count: undefined }, null, cutoff), true);
    assert.equal(catalog.isEligible({ ...movie, release_date: '2024-02-29' }, null, cutoff), true);
});

test('Discover requests enforce dates and votes while retaining stricter existing filters', () => {
    for (const type of ['movie', 'tv']) {
        const key = type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte';
        const endpoint = catalog.discoverEndpoint(`/discover/${type}?sort_by=popularity.desc&with_genres=16`, type, cutoff);
        const params = new URLSearchParams(endpoint.split('?')[1]);
        assert.equal(params.get(key), cutoff);
        assert.equal(params.get('vote_count.gte'), '1');
        assert.equal(params.get('vote_average.gte'), '0.1');
        assert.equal(params.get('with_genres'), '16');
    }
    const strict = new URLSearchParams(catalog.discoverEndpoint('/discover/movie?vote_count.gte=50&vote_average.gte=7&primary_release_date.lte=2025-01-01', 'movie', cutoff).split('?')[1]);
    assert.equal(strict.get('vote_count.gte'), '50');
    assert.equal(strict.get('vote_average.gte'), '7');
    assert.equal(strict.get('primary_release_date.lte'), '2025-01-01');
    assert.equal(catalog.discoverEndpoint('/search/multi?query=robot', 'movie', cutoff), '/search/multi?query=robot');
});

test('Card renderer suppresses unrated and upcoming items without hiding valid progress cards', () => {
    const { context } = loadApp();
    for (const input of [{ ...movie, vote_average: 0 }, { ...movie, release_date: '2099-01-01' }, { ...tv, first_air_date: '' }])
        assert.equal(context.createCardHTML(input), '');
    const html = context.createCardHTML({ ...tv, season: 1, episode: 2, server: 2, progress: { position: 120, duration: 600 } });
    assert.match(html, /value="20"/);
    assert.match(html, /server=2/);
    assert.doesNotMatch(html, /★ NR/);
});

test('Mixed home sections discard invalid items before taking the newest thirty', async () => {
    const { context } = loadApp();
    const invalid = Array.from({ length: 30 }, (_, i) => ({ ...movie, id: 100 + i, vote_average: 0, release_date: '2026-10-17' }));
    const requested = [];
    context.fetch = async url => { requested.push(url); return { ok: true, json: async () => ({ results: url.includes('/movie?') ? [...invalid, movie] : [tv, { ...tv, id: 3, first_air_date: '2099-01-01' }] }) }; };
    const result = await context.fetchMixedCountrySection({ mixedCountry: 'with_origin_country=JP', t: 'Anime' }, cutoff);
    assert.deepEqual(Array.from(result.results, i => i.id), [1, 2]);
    assert.ok(requested.every(url => url.includes('vote_average.gte=0.1') && url.includes('vote_count.gte=1')));
});

test('Browse requests retain eligibility guards after advanced filters and reject invalid results', async () => {
    const grid = { innerHTML: '', insertAdjacentHTML(_position, html) { this.innerHTML += html; } };
    const button = { style: {} };
    const { context } = loadApp({ 'browse-grid': grid, 'load-more-btn': button });
    vm.runInContext("currentBrowseEndpoint = '/discover/movie?primary_release_year=2020&sort_by=vote_average.desc'; currentMediaType = 'movie'; currentPage = 1;", context);
    let requested;
    context.fetch = async url => { requested = url; return { ok: true, json: async () => ({ page: 1, total_pages: 1,
        results: [movie, { ...movie, id: 2, title: 'Unrated', vote_average: 0 }, { ...movie, id: 3, title: 'Future', release_date: '2099-01-01' }] }) }; };
    await context.loadBrowseContent();
    assert.match(requested, /vote_average.gte=0.1/);
    assert.match(requested, /vote_count.gte=1/);
    assert.match(requested, /primary_release_date.lte=\d{4}-\d{2}-\d{2}/);
    assert.match(requested, /primary_release_year=2020/);
    assert.match(grid.innerHTML, /Released movie/);
    assert.doesNotMatch(grid.innerHTML, /Unrated|Future/);
    assert.equal(button.style.display, 'none');
});

test('Legacy saved collections fetch exact dates and current ratings without deleting stored data', async () => {
    const { context, saved } = loadApp();
    const entries = [
        { id: 1, type: 'movie', year: '2020', rating: 'NR', server: 2, season: 1, episode: 1, progress: { position: 120, duration: 600 } },
        { id: 2, type: 'tv', year: '2020', rating: '8' },
        { id: 3, type: 'movie', year: '2020', rating: '8' },
        { id: 1, type: 'movie', year: '2020', rating: 'NR', server: 3 },
    ];
    const original = JSON.stringify(entries);
    saved.set('xudo_history', original);
    const calls = [];
    context.fetch = async url => { calls.push(url); return { ok: true, json: async () => url.includes('/movie/1?') ? movie : url.includes('/tv/2?') ? { ...tv, vote_average: 0 } : { ...movie, id: 3, release_date: '2099-01-01' } }; };
    const items = await context.hydrateSavedCatalogItems(entries);
    assert.deepEqual(Array.from(items, i => i.id), [1, 1]);
    assert.equal(items[0].release_date, '2020-01-01');
    assert.equal(items[0].server, 2);
    assert.equal(items[0].progress.position, 120);
    assert.equal(items[1].server, 3);
    assert.equal(calls.filter(url => url.includes('/movie/1?')).length, 1);
    assert.equal(saved.get('xudo_history'), original);
});

test('Unavailable saved metadata is not treated as proof of a released, rated title', async () => {
    const { context } = loadApp();
    context.fetch = async () => { throw Error('Offline'); };
    assert.equal((await context.hydrateSavedCatalogItems([{ id: 1, type: 'movie', year: '2020', rating: '7' }])).length, 0);
});

test('Recommendations fall back when the primary response contains only excluded titles', async () => {
    const target = { innerHTML: '' };
    const { context } = loadApp({ 'rec-slider': target });
    vm.runInContext('attachCardDelegation = () => {};', context);
    context.fetch = async url => ({ ok: true, json: async () => ({ results: url.includes('/recommendations?') ? [{ ...movie, vote_average: 0 }] : [{ ...movie, title: 'Valid fallback' }] }) });
    await context.fetchSimilarMovies('movie', 10);
    assert.match(target.innerHTML, /Valid fallback/);
    assert.doesNotMatch(target.innerHTML, /★ NR/);
});

test('Movie and TV cards both carry a hidden quality badge slot', () => {
    const { context } = loadApp();
    for (const item of [movie, tv]) assert.match(context.createCardHTML(item), /<span class="card-quality" hidden><\/span>/);
});

test('Movie cards check the movie index and TV cards check the whole series', async () => {
    const { context } = loadApp();
    const requests = [];
    context.window.XUDO_STREAM_AVAILABILITY = { check: async content => { requests.push(content); return { state: 'unknown' }; } };
    for (const type of ['movie', 'tv'])
        await context.resolveCardQuality({ dataset: { id: '7', type }, querySelector: () => ({ hidden: true, dataset: {} }) });
    assert.deepEqual(requests.map(r => r.type), ['movie', 'show']);
});

test('Quality badge shows only a verified quality and stays hidden otherwise', async () => {
    const { context } = loadApp();
    const cardFor = id => { const badge = { hidden: true, dataset: {}, textContent: '' };
        return { badge, card: { dataset: { id }, querySelector: () => badge } }; };
    const outcomes = { 1: { state: 'available', quality: 'CAM' }, 2: { state: 'available', quality: '' },
        3: { state: 'unavailable' }, 4: { state: 'unknown' } };
    const requests = [];
    context.window.XUDO_STREAM_AVAILABILITY = { check: async content => {
        requests.push(content);
        if (content.id === '5') throw Error('Offline');
        return outcomes[content.id]; } };
    const results = {};
    for (const id of ['1', '2', '3', '4', '5']) { results[id] = cardFor(id); await context.resolveCardQuality(results[id].card); }
    assert.equal(requests[0].type, 'movie');
    assert.equal(requests[0].id, '1');
    assert.equal(results[1].badge.hidden, false);
    assert.equal(results[1].badge.textContent, 'CAM');
    assert.equal(results[1].badge.dataset.quality, 'CAM');
    for (const id of ['2', '3', '4', '5']) assert.equal(results[id].badge.hidden, true, `id ${id} stays hidden`);
    context.window.XUDO_STREAM_AVAILABILITY = undefined;
    await context.resolveCardQuality(results[3].card);
});

test('Quality checks never run more than four at a time and skip cards that leave view', async () => {
    const { context } = loadApp();
    let observed;
    context.IntersectionObserver = function (callback) {
        observed = callback;
        this.observe = () => {}; this.unobserve = () => {};
    };
    const cards = Array.from({ length: 7 }, (_, i) => ({ dataset: { id: String(i + 1) },
        querySelector: () => ({ hidden: true, dataset: {} }) }));
    const root = { querySelectorAll: () => cards };
    let running = 0, peak = 0; const release = [];
    context.window.XUDO_STREAM_AVAILABILITY = { check: () => { running++; peak = Math.max(peak, running);
        return new Promise(resolve => release.push(() => { running--; resolve({ state: 'unknown' }); })); } };
    context.observeCardQuality(root);
    observed(cards.map(target => ({ target, isIntersecting: true })));
    observed([{ target: cards[6], isIntersecting: false }]);
    assert.equal(release.length, 4);
    while (release.length) { release.shift()(); await new Promise(setImmediate); }
    assert.equal(peak, 4);
    assert.equal(cards.filter(card => card.dataset.qualitySeen === '1').length, 7);
    assert.equal(running, 0);
});

test('Short drama row is catalogue-only: info link, TMDB keywords and all 19 translations', () => {
    const { context } = loadApp();
    const params = new URLSearchParams(vm.runInContext('SHORT_DRAMA_ENDPOINT', context).split('?')[1]);
    assert.equal(params.get('with_keywords'), '383994|356983');
    const drama = { ...tv, id: 293371 };
    const card = context.createCardHTML({ ...drama, _info: true }, 'tv');
    assert.match(card, /data-href="watch\.html\?type=tv&id=293371&info=1"/);
    assert.doesNotMatch(context.createCardHTML(drama, 'tv'), /info=1/);
    const translations = context.window.XUDO_I18N.TRANSLATIONS;
    assert.equal(Object.keys(translations).length, 19);
    for (const [locale, labels] of Object.entries(translations))
        for (const key of ['shortDramaSection', 'shortDramaInfoNotice']) assert.ok(labels[key], `${locale}:${key}`);
});

test('Info-only notice replaces the player and hides server controls', () => {
    const container = { style: { cssText: '' }, innerHTML: '' }, bar = { style: {} };
    const { context } = loadApp({ 'player-container': container, 'control-bar': bar });
    context.showInfoOnlyNotice();
    assert.match(container.innerHTML, /info-only-notice/);
    assert.doesNotMatch(container.innerHTML, /<iframe/);
    assert.equal(bar.style.display, 'none');
});

test('Every language has the short drama row, info row and unavailable labels', () => {
    const { context } = loadApp();
    for (const [locale, labels] of Object.entries(context.window.XUDO_I18N.TRANSLATIONS))
        for (const key of ['shortDramaSection', 'shortDramaInfoSection', 'shortDramaUnavailable']) assert.ok(labels[key], `${locale}:${key}`);
});

test('Anime uses the Latest Movies / Latest TV gates: 50+ votes and, for movies, a theatrical or digital release', async () => {
    const { context } = loadApp();
    const requested = [];
    context.fetch = async url => { requested.push(url); return { ok: true, json: async () => ({ results: url.includes('/movie?') ? [movie] : [tv] }) }; };
    await context.fetchMixedCountrySection({ mixedCountry: 'with_genres=16&with_origin_country=JP', t: 'Anime', latestRules: true }, cutoff);
    const movieUrl = requested.find(url => url.includes('/discover/movie')), tvUrl = requested.find(url => url.includes('/discover/tv'));
    assert.match(movieUrl, /vote_count\.gte=50/); assert.match(movieUrl, /with_release_type=3%7C2/);
    assert.match(tvUrl, /vote_count\.gte=50/); assert.doesNotMatch(tvUrl, /with_release_type/);
});

test('Anime browse (both tabs) keeps the same gates; other country rows keep their own defaults', () => {
    const { context } = loadApp();
    const anime = '?with_genres=16&with_origin_country=JP&sort_by=popularity.desc&vote_count.gte=50';
    const movieEp = context._normBrowseEp(`/discover/movie${anime}`, 'movie'), tvEp = context._normBrowseEp(`/discover/tv${anime}`, 'tv');
    assert.match(movieEp, /vote_count\.gte=50/); assert.match(movieEp, /with_release_type=3%7C2/); assert.match(movieEp, /primary_release_date\.desc/);
    assert.match(tvEp, /vote_count\.gte=50/); assert.doesNotMatch(tvEp, /with_release_type/);
    const korean = context._normBrowseEp('/discover/movie?with_origin_country=KR&sort_by=popularity.desc', 'movie');
    assert.match(korean, /vote_count\.gte=20/); assert.doesNotMatch(korean, /with_release_type/);
});

test('Availability gate hides only titles VidSrc reports as missing and fails open otherwise', async () => {
    const { context } = loadApp();
    const states = { 1: 'available', 2: 'unavailable', 3: 'unknown', 4: 'available' };
    const asked = [];
    context.window.XUDO_STREAM_AVAILABILITY = { check: async content => { asked.push(`${content.type}:${content.id}`); return { state: states[content.id] }; } };
    const items = [1, 2, 3, 4].map(id => ({ ...movie, id }));
    const kept = await context.filterAvailable(items, 'movie');
    assert.deepEqual(Array.from(kept, i => i.id), [1, 3, 4]);
    assert.deepEqual(asked.sort(), ['movie:1', 'movie:2', 'movie:3', 'movie:4']);
    // TV items (and mixed anime items carrying media_type) are checked against the whole-series index.
    asked.length = 0;
    await context.filterAvailable([{ ...tv, id: 1 }, { ...movie, id: 4, media_type: 'movie' }], 'tv');
    assert.deepEqual(asked.sort(), ['movie:4', 'show:1']);
    // A mass 404 (index outage) must not empty the section.
    context.window.XUDO_STREAM_AVAILABILITY = { check: async () => ({ state: 'unavailable' }) };
    const many = Array.from({ length: 8 }, (_, i) => ({ ...movie, id: 100 + i }));
    assert.equal((await context.filterAvailable(many, 'movie')).length, 8);
    assert.equal((await context.filterAvailable(many.slice(0, 3), 'movie')).length, 0);
    // No client available: nothing is filtered.
    delete context.window.XUDO_STREAM_AVAILABILITY;
    assert.equal((await context.filterAvailable(items, 'movie')).length, 4);
});

test('Availability checks that outlive their time budget count as unknown, not missing', async () => {
    const { context } = loadApp();
    context.window.XUDO_STREAM_AVAILABILITY = { check: (content, { signal }) => new Promise(resolve => signal.addEventListener('abort', () => resolve({ state: 'unknown' }))) };
    const kept = await context.filterAvailable([{ ...movie, id: 1 }, { ...movie, id: 2 }], 'movie', { budget: 20 });
    assert.equal(kept.length, 2);
});

test('Only Latest Movies, Latest TV Shows and Anime use the availability gate', () => {
    const { context } = loadApp();
    assert.deepEqual([...vm.runInContext('AVAILABILITY_GATE_KEYS', context)].sort(), ['animeSection', 'latestTvSection', 'movPopular']);
});
