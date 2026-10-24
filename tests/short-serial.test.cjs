const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const load = () => import('../functions/_lib/shortdrama.js');
const drama = { id: 117426, title: 'Captain, I’m Marrying Someone Else', cover: 'https://img.dramatap.app/9/poster.webp', label: 'EP50 TV' };
const catalogue = `<html><script>throw new Error('must never execute upstream code')</script>
<div class="grid grid-new"><a class="card ssr-card" href="/d/123/new-drama" title="New &amp; Brave"><img src="https://img.dramatap.app/new.jpg"><div class="m">EP60 TV</div></a></div>
<div class="grid grid-home"><a class="card ssr-card" href="/d/117426/captain" title="Captain, I’m Marrying Someone Else"><img src="https://img.dramatap.app/9/poster.webp"><div class="m">50 episodes</div></a></div></html>`;
const detail = `<div id="ssr-drama" data-drama-id="117426" data-drama-title="Captain, I’m Marrying Someone Else" data-drama-label="EP50 TV" data-total="50"><img class="ssr-cover" src="https://img.dramatap.app/9/poster.webp"></div><div class="ssr-synopsis"><p>A &lt;new&gt; chance.<script>bad()</script></p></div>`;
const episodes = { items: [{ ep: 1, url: 'https://video.dramatap.app/dramas/117426/gs/ep1.m3u8' }, { ep: 2, url: 'https://video.dramatap.app/dramas/117426/gs/ep2.m3u8' }], cached: 1, title: drama.title };
async function call(route, query = '', env = {}) {
    const { onRequest } = await import('../functions/api/shortdrama/[[path]].js');
    return onRequest({ request: new Request(`https://local.example/api/shortdrama/${route}?${query}`), env, params: { path: [route] }, waitUntil: promise => promise });
}
async function mockFetch(impl, run) {
    const original = global.fetch; global.fetch = impl;
    try { await run(); } finally { global.fetch = original; }
}
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('Parses the real DramaTap homepage sections, decodes entities and keeps feeds distinct', async () => {
    const { parseCatalogHTML, normalizeSearch } = await load();
    assert.equal(parseCatalogHTML(catalogue, 'trending')[0].id, '117426');
    assert.equal(parseCatalogHTML(catalogue, 'latest')[0].title, 'New & Brave');
    assert.equal(parseCatalogHTML(catalogue, 'latest')[0].episodeCount, 60);
    assert.equal(normalizeSearch({ items: [drama, drama, { id: 1 }, { ...drama, id: Number.MAX_SAFE_INTEGER + 1 }] }).length, 1);
    assert.throws(() => parseCatalogHTML('<html>challenge</html>', 'trending'));
    assert.throws(() => normalizeSearch({ message: 'broken' }));
    assert.deepEqual(normalizeSearch({ items: [] }), []);
});
test('Detail parsing checks exact ID and extracts synopsis as text without upstream scripts', async () => {
    const { parseDetailHTML } = await load();
    const item = parseDetailHTML(detail, '117426');
    assert.equal(item.title, drama.title); assert.equal(item.episodeCount, 50);
    assert.equal(item.synopsis, 'A <new> chance.');
    assert.equal(item.poster, drama.cover);
    assert.throws(() => parseDetailHTML(detail, '999'));
    assert.equal(parseDetailHTML(detail.split('<div class="ssr-synopsis">')[0], '117426').synopsis, '');
});
test('Episode lists retain numbering and missing streams; unsafe URLs never become sources', async () => {
    const { normalizeEpisodes, safeMediaURL } = await load();
    const items = normalizeEpisodes({ items: [...episodes.items, { ep: 3, url: '' }, { ep: 4, url: 'javascript:alert(1)' }, { ep: 2, url: 'https://duplicate.example/video.mp4' }] });
    assert.deepEqual(items.map(e => e.number), [1, 2, 3, 4]);
    assert.equal(items[0].sources[0].type, 'hls'); assert.equal(items[0].id, '1');
    assert.deepEqual(items[2].sources, []); assert.deepEqual(items[3].sources, []);
    for (const value of ['javascript:x', '//cdn.example.com/v', 'http://cdn.example.com/v', 'https://a:b@cdn.example.com/v', 'https://127.0.0.1/v', 'https://localhost/v']) assert.equal(safeMediaURL(value), '');
    assert.throws(() => normalizeEpisodes({ notfound: true }), e => e.status === 404);
    assert.throws(() => normalizeEpisodes({ gone: true }), e => e.status === 422);
    assert.throws(() => normalizeEpisodes({ items: [{ ep: 0 }] }));
});
test('Routes call DramaTap with encoded search and never send old Sansekai credentials', async () => {
    const calls = [];
    await mockFetch(async (url, options) => {
        const u = new URL(url); calls.push({ url: u, options });
        if (u.pathname === '/api/search') return json({ items: [drama], total: 1 });
        if (u.pathname === '/api/episodes') return json(episodes);
        return new Response(u.pathname.startsWith('/d/') ? detail : catalogue);
    }, async () => {
        const env = { SHORT_DRAMA_API_BASE: 'https://old.example/api', SHORT_DRAMA_API_KEY: 'private-key' };
        const res = await call('search', 'q=love%20%26%20CEO&url=https://evil.example', env);
        assert.equal(res.status, 200); assert.equal((await res.json()).items[0].id, '117426');
        assert.equal(calls[0].url.href, 'https://dramatap.app/api/search?q=love+%26+CEO');
        assert.equal(calls[0].options.headers['X-API-Key'], undefined);
        assert.equal((await call('catalog')).status, 200);
        assert.equal((await call('detail', 'id=117426')).status, 200);
        const episodeResponse = await call('episodes', 'id=117426');
        assert.equal(episodeResponse.status, 200); assert.equal(episodeResponse.headers.get('Cache-Control'), 'no-store');
        assert.equal(calls[3].url.href, 'https://dramatap.app/api/episodes?id=117426');
    });
});
test('Invalid operations and old provider IDs never call a provider', async () => {
    await mockFetch(() => { assert.fail('No network call expected'); }, async () => {
        for (const [route, query] of [['catalog', 'provider=dramabox'], ['catalog', 'provider=__proto__'], ['catalog', 'feed=admin'], ['detail', 'id=..%2Fsecret'], ['detail', 'id=01'], ['search', 'q='], ['search', `q=${'a'.repeat(101)}`]]) assert.equal((await call(route, query)).status, 400);
        assert.equal((await call('stream', 'id=123')).status, 404);
        for (const origin of ['http://localhost', 'https://dramatap.app/other', 'https://user:pass@dramatap.app']) assert.equal((await call('catalog', '', { DRAMATAP_ORIGIN: origin })).status, 503);
    });
});
test('Canonical redirects stay on the configured origin; challenge and error responses are not cached', async () => {
    let calls = 0;
    await mockFetch(async () => ++calls === 1 ? new Response('', { status: 301, headers: { Location: '/d/117426/captain' } }) : new Response(detail), async () => assert.equal((await call('detail', 'id=117426')).status, 200));
    await mockFetch(async () => new Response('', { status: 301, headers: { Location: 'https://evil.example/d/117426' } }), async () => assert.equal((await call('detail', 'id=117426')).status, 502));
    for (const [status, expected] of [[403, 'PROVIDER_ACCESS_DENIED'], [401, 'PROVIDER_ACCESS_DENIED'], [429, 'PROVIDER_RATE_LIMITED'], [500, 'PROVIDER_UNAVAILABLE']]) await mockFetch(async () => new Response('private diagnostics', { status }), async () => {
        const res = await call('catalog'); assert.equal((await res.json()).code, expected); assert.equal(res.headers.get('Cache-Control'), 'no-store');
    });
    await mockFetch(async () => new Response('<html>gateway</html>'), async () => assert.equal((await call('search', 'q=love')).status, 502));
});
test('Metadata cache keys isolate feed, operation and origin; episode lists are always fresh', async () => {
    const oldCaches = global.caches; const keys = [];
    global.caches = { default: { match: async key => { keys.push(key.url); }, put: async () => {} } };
    try {
        await mockFetch(async url => new URL(url).pathname === '/api/episodes' ? json(episodes) : new Response(catalogue), async () => {
            await call('catalog'); await call('catalog', 'feed=latest'); await call('catalog', '', { DRAMATAP_ORIGIN: 'https://other.example' }); await call('catalog'); await call('episodes', 'id=117426');
        });
        assert.equal(keys.length, 4); assert.equal(new Set(keys).size, 3); assert.equal(keys[0], keys[3]); assert.match(keys[0], /dramatap-v1/);
    } finally { global.caches = oldCaches; }
});
test('Serial cards link to DramaTap IDs, escape titles and reject previous provider links', () => {
    const context = vm.createContext({ window: {}, URL, URLSearchParams, localStorage: { getItem: () => 'id-ID' } });
    vm.runInContext(fs.readFileSync('js/short-serial.js', 'utf8'), context);
    const api = context.window.XUDO_SHORT_SERIAL;
    const html = api.card({ id: '123', provider: 'dramatap', title: '<img onerror="bad">', poster: 'javascript:alert(1)', episodeCount: 60 });
    assert.match(html, /watch.html\?type=shortdrama&amp;id=123&amp;e=1/); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /javascript:/); assert.match(html, /60 episode/);
    assert.equal(api.card({ id: '../oops', provider: 'dramatap', title: 'bad' }), '');
    assert.equal(api.card({ id: '123', provider: 'dramabox', title: 'old' }), '');
});
test('Every language ships the Short Drama UI labels and the episode template', () => {
    const context = vm.createContext({ window: {} });
    vm.runInContext(fs.readFileSync('js/i18n/translations.js', 'utf8'), context);
    const keys = ['sdViews', 'sdTrending', 'sdLatest', 'sdEpisodes', 'sdEpisode', 'sdRetry', 'sdPrev', 'sdPrevShort', 'sdNextShort', 'sdNext', 'sdEmpty', 'sdUnavailable', 'sdPlayError', 'sdNoStream', 'sdNoEpisodes'];
    for (const [locale, labels] of Object.entries(context.window.XUDO_I18N.TRANSLATIONS)) {
        for (const key of keys) assert.ok(labels[key], `${locale}:${key}`);
        assert.match(labels.sdEpisode, /\{n\}/, locale);
    }
});
test('Cards use the visitor locale for the episode count and type label', () => {
    const context = vm.createContext({ window: {}, URL, URLSearchParams, localStorage: { getItem: () => 'zh-CN' } });
    vm.runInContext(fs.readFileSync('js/i18n/translations.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('js/short-serial.js', 'utf8'), context);
    const html = context.window.XUDO_SHORT_SERIAL.card({ id: '9', provider: 'dramatap', title: 'x', episodeCount: 12 });
    assert.match(html, /12 集/); assert.match(html, /card-year">短剧</); assert.doesNotMatch(html, /DramaTap/);
});
const newPage = more => `<html><div id="grid" class="grid"></div><div class="grid"><a class="card ssr-card" href="/d/128862/strike" title="Strike His Heart"><img src="https://img.dramatap.app/s.jpg"><div class="m">EP60 TV</div></a><a class="card ssr-card" href="/d/128862/dup" title="Dup"></a></div>
<nav class="ssr-pagination"><span class="ssr-page-btn cur">1</span>${more ? '<a class="ssr-page-btn" href="/new/2">Next ›</a>' : '<span class="ssr-page-btn disabled">Next ›</span>'}</nav></html>`;
test('Latest feed pages come from /new/{page}; trending stays single-page and bad pages are rejected', async () => {
    const { parseNewPageHTML } = await load();
    assert.deepEqual(JSON.parse(JSON.stringify(parseNewPageHTML(newPage(true)))), { items: [{ id: '128862', provider: 'dramatap', channel: 'DramaTap', title: 'Strike His Heart', poster: 'https://img.dramatap.app/s.jpg', synopsis: '', episodeCount: 60 }], hasMore: true });
    assert.equal(parseNewPageHTML(newPage(false)).hasMore, false);
    assert.throws(() => parseNewPageHTML('<html>challenge</html>'));
    const paths = [];
    await mockFetch(async url => { paths.push(new URL(url).pathname); return new Response(newPage(true)); }, async () => {
        const first = await (await call('catalog', 'feed=latest&page=1', { DRAMATAP_ORIGIN: 'https://paged.example' })).json();
        assert.equal(first.page, 1); assert.equal(first.hasMore, true); assert.equal(first.items[0].id, '128862');
        assert.equal((await call('catalog', 'feed=latest&page=3', { DRAMATAP_ORIGIN: 'https://paged.example' })).status, 200);
    });
    assert.deepEqual(paths, ['/new', '/new/3']);
    await mockFetch(async () => { throw new Error('must not fetch'); }, async () => {
        for (const query of ['feed=latest&page=0', 'feed=latest&page=51', 'feed=latest&page=x', 'feed=trending&page=2', 'feed=latest&page=1.5'])
            assert.equal((await call('catalog', query)).status, 400, query);
        assert.equal((await call('search', 'q=a&page=2')).status, 400);
    });
});
test('Search results keep the play count as views; catalogue items without it stay clean', async () => {
    const { normalizeSearch, parseCatalogHTML } = await load();
    const [withViews, without] = normalizeSearch({ items: [{ ...drama, play: 7233 }, { ...drama, id: 2, play: 0 }] });
    assert.equal(withViews.views, 7233); assert.equal(Object.hasOwn(without, 'views'), false);
    assert.equal(Object.hasOwn(parseCatalogHTML(catalogue, 'latest')[0], 'views'), false);
});
test('Cards show a compact, localized views chip only when views are known', () => {
    const context = vm.createContext({ window: {}, URL, URLSearchParams, localStorage: { getItem: () => 'en-US' } });
    vm.runInContext(fs.readFileSync('js/i18n/translations.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('js/short-serial.js', 'utf8'), context);
    const api = context.window.XUDO_SHORT_SERIAL, base = { id: '9', provider: 'dramatap', title: 'x', episodeCount: 12 };
    const html = api.card({ ...base, views: 7233 });
    assert.match(html, /class="card-rating sd-views" title="7,233 views"/); assert.match(html, /7\.2K/);
    assert.doesNotMatch(api.card(base), /sd-views/); assert.doesNotMatch(api.card({ ...base, views: 0 }), /sd-views/);
});
