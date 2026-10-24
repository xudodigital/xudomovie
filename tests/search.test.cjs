const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const movie = { id: 123, title: 'Captain Movie', media_type: 'movie', release_date: '2020-01-01', vote_average: 7, vote_count: 50, poster_path: '/poster.jpg' };
const drama = { id: '123', title: 'Captain Drama', provider: 'dramatap', episodeCount: 50, poster: 'https://img.dramatap.app/poster.jpg' };
const reply = data => ({ ok: true, json: async () => data });
function element() {
    const classes = new Set();
    return { innerHTML: '', textContent: '', value: '', style: {}, hidden: false, disabled: false,
        addEventListener() {}, classList: { add: s => classes.add(s), remove: s => classes.delete(s), contains: s => classes.has(s) } };
}
function app() {
    const ids = Object.fromEntries(['main-content', 'search-grid', 'search-sort-bar', 'actor-cards-container', 'search-load-more', 'search-source-notice', 'search-dropdown', 'search-input', 'clear-btn', 'page-title'].map(id => [id, element()]));
    ids['main-content'].querySelector = () => ids['page-title'];
    const context = vm.createContext({ window: { location: { hostname: 'localhost', search: '' } }, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
        localStorage: { getItem: key => key === 'xudo_lang' ? 'en-US' : null, setItem() {}, removeItem() {} },
        document: { addEventListener() {}, getElementById: id => ids[id], querySelector: selector => ids[selector.slice(1)] },
    });
    for (const file of ['js/i18n/translations.js', 'js/player-progress.js', 'js/catalog-policy.js', 'js/short-serial.js', 'js/main.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    return { context, ids };
}
const isDrama = url => String(url).startsWith('/api/shortdrama/');

test('Global suggestions include short dramas even when the movie/TV service fails', async () => {
    const { context, ids } = app();
    context.fetch = async url => isDrama(url) ? reply({ items: [drama] }) : { ok: false };
    await context.fetchLiveSearch('Captain');
    assert.match(ids['search-dropdown'].innerHTML, /watch.html\?type=shortdrama&id=123&e=1/);
    assert.match(ids['search-dropdown'].innerHTML, /search-item-meta">Short Drama</);
    assert.equal(ids['search-dropdown'].classList.contains('active'), true);
});

test('Global results merge namespaces, retain short dramas when sorting, and do not duplicate them on Load More', async () => {
    const { context, ids } = app(); let dramaCalls = 0;
    context.fetch = async url => {
        if (isDrama(url)) { dramaCalls++; return reply({ items: [drama, drama] }); }
        const page = new URL(url, 'https://local.example').searchParams.get('page');
        return reply({ results: page === '2' ? [movie, { ...movie, id: 456 }] : [movie], total_pages: 2 });
    };
    await context.performSearch('Captain');
    assert.match(ids['search-grid'].innerHTML, /type=movie&id=123/);
    assert.match(ids['search-grid'].innerHTML, /type=shortdrama&amp;id=123/);
    assert.equal(vm.runInContext('searchAllItems.length', context), 2);
    context.window.applySortToSearch('rating');
    assert.match(ids['search-grid'].innerHTML, /type=shortdrama&amp;id=123/);
    await ids['search-load-more'].onclick();
    assert.equal(dramaCalls, 1);
    assert.equal(vm.runInContext('searchAllItems.length', context), 3);
    assert.equal(vm.runInContext('searchAllItems.find(i => i.provider).vote_average', context), undefined);
});

test('Movie/TV results remain usable and get a partial-results notice during a DramaTap outage', async () => {
    const { context, ids } = app();
    context.fetch = async url => isDrama(url) ? { ok: false } : reply({ results: [movie], total_pages: 1 });
    await context.performSearch('Captain');
    assert.match(ids['search-grid'].innerHTML, /Captain Movie/);
    assert.equal(ids['search-source-notice'].hidden, false);
    assert.match(ids['search-source-notice'].textContent, /temporarily unavailable/);
});

test('A failed later page preserves existing mixed results and rolls the page back for retry', async () => {
    const { context, ids } = app();
    context.fetch = async url => isDrama(url) ? reply({ items: [drama] }) : String(url).includes('page=2') ? { ok: false } : reply({ results: [movie], total_pages: 2 });
    await context.performSearch('Captain'); const before = ids['search-grid'].innerHTML;
    await ids['search-load-more'].onclick();
    assert.equal(ids['search-grid'].innerHTML, before);
    assert.equal(vm.runInContext('searchCurrentPage', context), 1);
    assert.equal(ids['search-load-more'].disabled, false);
});

test('Late autocomplete responses and clearing input cannot reopen or replace a newer query', async () => {
    const { context, ids } = app(); const pending = [];
    context.fetch = async url => {
        const u = new URL(url, 'https://local.example'), q = u.searchParams.get('q') || u.searchParams.get('query');
        if (q === 'old') return new Promise(resolve => pending.push(() => resolve(isDrama(url) ? reply({ items: [{ ...drama, title: 'Old' }] }) : reply({ results: [] }))));
        return isDrama(url) ? reply({ items: [{ ...drama, title: 'New' }] }) : reply({ results: [] });
    };
    const old = context.fetchLiveSearch('old');
    await context.fetchLiveSearch('new');
    const current = ids['search-dropdown'].innerHTML; assert.match(current, /New/);
    pending.splice(0).forEach(resolve => resolve()); await old;
    assert.equal(ids['search-dropdown'].innerHTML, current);
    const clearing = context.fetchLiveSearch('old'); context.window.clearSearch();
    pending.splice(0).forEach(resolve => resolve()); await clearing;
    assert.equal(ids['search-dropdown'].classList.contains('active'), false);
});

test('Slow sources time out independently so a healthy source can still return results', async () => {
    const { context } = app();
    context.fetch = async (url, options) => {
        if (!isDrama(url)) return reply({ results: [movie], total_pages: 1 });
        return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    };
    const data = await context.fetchSearchSources('Captain', 1, { timeout: 5 });
    assert.equal(data.partial, true); assert.equal(data.media.results[0].id, 123);
});
