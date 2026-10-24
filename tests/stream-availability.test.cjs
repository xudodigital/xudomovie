const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createClient, target } = require('../js/stream-availability.js');
const root = path.resolve(__dirname, '..');
const movie = { type: 'movie', id: 27205 };
const episode = { type: 'tv', id: 1396, season: 2, episode: 3 };
const available = { status_code: 200, type: 'movie', tmdb_id: '27205', quality: '1080p' };
const response = (status, data) => ({ status, json: async () => data });

test('Availability validates IDs and isolates movies, TV episodes and anime episodes', async () => {
    assert.equal(target(movie).path, 'movie/27205');
    assert.equal(target(episode).path, 'tv/1396/2/3');
    assert.equal(target({ ...episode, id: 1429 }).path, 'tv/1429/2/3');
    assert.equal(target({ ...episode, season: 0 }).path, 'tv/1396/0/3');
    let calls = 0;
    const client = createClient({ fetch: async () => { calls++; } });
    for (const input of [null, { ...movie, id: '../27205' }, { ...movie, id: -1 }, { ...movie, id: Infinity },
        { ...movie, id: '9007199254740993' }, { ...movie, type: 'person' }, { ...episode, season: null }, { ...episode, episode: 0 }]) {
        assert.equal((await client.check(input)).state, 'unknown');
    }
    assert.equal(calls, 0);
});

test('Series index supplies a show-level quality without needing an episode', async () => {
    assert.equal(target({ type: 'show', id: 1396 }).path, 'tv/1396');
    assert.equal(target({ type: 'show', id: '../1396' }), null);
    const show = { status_code: 200, type: 'tv', tmdb_id: '1396', quality: '720p' };
    let url;
    const client = createClient({ fetch: async address => { url = address; return response(200, show); } });
    assert.deepEqual(await client.check({ type: 'show', id: 1396 }), { state: 'available', quality: '720p' });
    assert.equal(url, 'https://vidsrc.sh/info/tv/1396.json');
    for (const [status, data] of [[200, { ...show, tmdb_id: '999' }], [200, { ...show, type: 'episode' }],
        [200, { ...show, status_code: 500 }], [500, show]]) {
        const other = createClient({ fetch: async () => response(status, data) });
        assert.equal((await other.check({ type: 'show', id: 1396 })).state, 'unknown');
    }
    const missing = createClient({ fetch: async () => response(404, { status_code: 404, error: 'not found' }) });
    assert.equal((await missing.check({ type: 'show', id: 1396 })).state, 'unavailable');
    const episodeOnly = createClient({ fetch: async () => response(200, show) });
    assert.equal((await episodeOnly.check(episode)).state, 'unknown');
});

test('Official 200 and 404 contracts produce distinct states without sending credentials', async () => {
    let request;
    const client = createClient({ fetch: async (url, options) => { request = { url, options }; return response(200, available); } });
    assert.deepEqual(await client.check(movie), { state: 'available', quality: '1080p' });
    assert.equal(request.url, 'https://vidsrc.sh/info/movie/27205.json');
    assert.equal(request.options.credentials, 'omit');
    assert.equal(request.options.referrerPolicy, 'no-referrer');
    const missing = createClient({ fetch: async () => response(404, { status_code: 404, error: 'not found' }) });
    assert.deepEqual(await missing.check(movie), { state: 'unavailable' });
});

test('Episode availability requires the exact episode rather than whole-show availability', async () => {
    const body = { status_code: 200, type: 'episode', tmdb_id: '1396', season: 2, episode: 3, quality: '720p' };
    const client = createClient({ fetch: async url => { assert.equal(url, 'https://vidsrc.sh/info/tv/1396/2/3.json'); return response(200, body); } });
    assert.deepEqual(await client.check(episode), { state: 'available', quality: '720p' });
    for (const changes of [{ type: 'tv' }, { tmdb_id: '1429' }, { season: 1 }, { episode: 4 }, { season: null }]) {
        const wrong = createClient({ fetch: async () => response(200, { ...body, ...changes }) });
        assert.equal((await wrong.check(episode)).state, 'unknown');
    }
});

test('Outages, HTML, rate limits, malformed data and wrong titles never claim unavailability', async () => {
    for (const result of [response(500, {}), response(429, {}), response(404, {}), response(200, null),
        response(200, { ...available, tmdb_id: '1' }), response(200, { ...available, status_code: 404 }),
        { status: 200, json: async () => { throw Error('HTML challenge'); } }]) {
        const client = createClient({ fetch: async () => result });
        assert.equal((await client.check(movie)).state, 'unknown');
    }
    const offline = createClient({ fetch: async () => { throw Error('Offline'); } });
    assert.equal((await offline.check(movie)).state, 'unknown');
    const unsafe = createClient({ fetch: async () => response(200, { ...available, quality: '<script>bad</script>' }) });
    assert.deepEqual(await unsafe.check(movie), { state: 'available', quality: '' });
});

test('Verified results expire after five minutes; retry forces a fresh check; errors are not cached', async () => {
    let clock = 0, calls = 0, fail = false;
    const client = createClient({ now: () => clock, fetch: async () => {
        calls++; return fail ? response(503, {}) : response(200, available);
    } });
    await client.check(movie); clock = 299999; await client.check(movie);
    assert.equal(calls, 1);
    clock = 300000; await client.check(movie);
    assert.equal(calls, 2);
    await client.check(movie, { force: true });
    assert.equal(calls, 3);
    fail = true; clock += 300000;
    assert.equal((await client.check(movie)).state, 'unknown');
    fail = false;
    assert.equal((await client.check(movie)).state, 'available');
    assert.equal(calls, 5);
});

test('Timeouts and cancellation abort requests, clear timers and remain retryable', async () => {
    let expire, cancelled = 0, calls = 0;
    const client = createClient({
        setTimeout: callback => { expire = callback; return 1; }, clearTimeout: () => cancelled++,
        fetch: (_url, { signal }) => { calls++; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('Aborted')), { once: true })); },
    });
    const timed = client.check(movie); expire();
    assert.equal((await timed).state, 'unknown');
    const abort = new AbortController();
    const switched = client.check(movie, { signal: abort.signal }); abort.abort();
    assert.equal((await switched).state, 'unknown');
    assert.equal(cancelled, 2);
    assert.equal((await client.check(movie, { signal: abort.signal })).state, 'unknown');
    assert.equal(calls, 2);
});

function loadStatus(language = 'id-ID') {
    const ids = ['stream-availability', 'stream-availability-title', 'stream-availability-context', 'stream-availability-status',
        'stream-availability-note', 'stream-availability-retry'];
    const elements = Object.fromEntries(ids.map(id => [id, { dataset: {}, hidden: false, textContent: '' }]));
    const player = { frames: [], appendChild(frame) { this.frames.push(frame); }, insertAdjacentHTML() {}, querySelector() { return null; } };
    elements['player-container'] = player;
    const context = vm.createContext({ window: { location: { hostname: 'localhost', search: '?type=tv&id=1396' } },
        URLSearchParams, AbortController, setTimeout: () => 0, clearTimeout() {}, localStorage: { getItem: key => key === 'xudo_lang' ? language : null },
        document: { addEventListener() {}, getElementById: id => elements[id] || null,
            createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {} }), querySelectorAll: () => [] },
    });
    for (const file of ['js/i18n/translations.js', 'js/player-progress.js', 'js/catalog-policy.js', 'js/main.js'])
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
    return { context, elements, player };
}

test('Status shows localized states, episode scope and retry without blocking iframe creation', async () => {
    const { context, elements, player } = loadStatus();
    const pending = [];
    context.window.XUDO_STREAM_AVAILABILITY = { check: (content, options) => new Promise(resolve => pending.push({ content, options, resolve })) };
    context.updatePlayer('tv', 1396);
    assert.equal(player.frames.length, 1, 'player loads while API is pending');
    assert.equal(elements['stream-availability'].dataset.state, 'checking');
    assert.match(elements['stream-availability-context'].textContent, /Musim 1 · Episode 1/);
    pending[0].resolve({ state: 'available', quality: '1080p' }); await new Promise(setImmediate);
    assert.equal(elements['stream-availability-status'].textContent, 'Tersedia · 1080p');
    assert.equal(elements['stream-availability-retry'].disabled, false);
    const missing = context.refreshStreamAvailability(episode, true);
    assert.equal(pending[1].options.force, true);
    pending[1].resolve({ state: 'unavailable' }); await missing;
    assert.equal(elements['stream-availability'].dataset.state, 'unavailable');
    assert.match(elements['stream-availability-status'].textContent, /Coba server lain/);
    context.window.XUDO_STREAM_AVAILABILITY.check = async () => { throw Error('Offline'); };
    await context.refreshStreamAvailability(episode, true);
    assert.equal(elements['stream-availability'].dataset.state, 'unknown');
    assert.equal(elements['stream-availability-retry'].disabled, false);
});

test('Late responses cannot overwrite a new episode or reappear on another server', async () => {
    const { context, elements } = loadStatus();
    const pending = [];
    context.window.XUDO_STREAM_AVAILABILITY = { check: (content, options) => new Promise(resolve => pending.push({ content, options, resolve })) };
    const old = context.refreshStreamAvailability(episode);
    const next = context.refreshStreamAvailability({ ...episode, episode: 4 });
    assert.equal(pending[0].options.signal.aborted, true);
    pending[1].resolve({ state: 'unavailable' }); await next;
    pending[0].resolve({ state: 'available', quality: '1080p' }); await old;
    assert.equal(elements['stream-availability'].dataset.state, 'unavailable');
    assert.equal(elements['stream-availability-context'].textContent, 'Musim 2 · Episode 4');
    const third = context.refreshStreamAvailability(episode);
    context.window.changeServer(2);
    assert.equal(elements['stream-availability'].hidden, true);
    assert.equal(pending[2].options.signal.aborted, true);
    pending[2].resolve({ state: 'available' }); await third;
    assert.equal(elements['stream-availability'].hidden, true);
    assert.equal(pending.length, 3, 'no availability call for Server 2');
});

test('Every supported language includes complete stream status labels and episode placeholders', () => {
    const { context } = loadStatus();
    const translations = context.window.XUDO_I18N.TRANSLATIONS;
    assert.equal(Object.keys(translations).length, 19);
    for (const [locale, labels] of Object.entries(translations)) {
        for (const key of ['streamAvailability', 'streamChecking', 'streamAvailable', 'streamUnavailable', 'streamUnknown',
            'streamAvailabilityNote', 'streamRetry', 'streamEpisode']) assert.ok(labels[key], `${locale}:${key}`);
        assert.match(labels.streamEpisode, /\{season\}/);
        assert.match(labels.streamEpisode, /\{episode\}/);
    }
});
