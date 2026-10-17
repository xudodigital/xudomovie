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
        window: { location: { hostname: 'localhost', search: '' } }, URLSearchParams,
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
