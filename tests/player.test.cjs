const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadPlayer(search = '?type=movie&id=27205', language = 'en-US') {
    const stored = new Map([['xudo_lang', language]]);
    const player = { frames: [], appendChild(frame) { this.frames.push(frame); } };
    const buttons = Array.from({ length: 6 }, (_, index) => ({
        dataset: { server: String(index + 1) },
        active: index === 0,
        attributes: {},
        classList: { toggle(_name, active) { buttons[index].active = active; } },
        setAttribute(name, value) { this.attributes[name] = value; },
    }));
    const audioButton = { active: true, classList: { toggle() { audioButton.active = false; } } };
    const context = vm.createContext({
        window: { location: { hostname: 'localhost', search } },
        URLSearchParams,
        localStorage: {
            getItem: key => stored.get(key) || null,
            setItem: (key, value) => stored.set(key, value),
            removeItem: key => stored.delete(key),
        },
        document: {
            addEventListener() {},
            getElementById: id => id === 'player-container' ? player : null,
            querySelectorAll: selector => selector === '#server-selector [data-server]'
                ? buttons : [...buttons, audioButton],
            createElement: () => ({ contentWindow: { messages: [], postMessage(data, origin) { this.messages.push({ data, origin }); } }, style: {}, setAttribute() {}, addEventListener() {} }),
        },
    });
    for (const file of ['js/i18n/translations.js', 'js/player-progress.js', 'js/catalog-policy.js', 'js/main.js']) {
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
    }
    return { context, player, buttons, audioButton, stored };
}

for (const [server, provider, moviePath, tvPath] of [
    [5, 'https://www.vidking.net', '/embed/movie/27205', '/embed/tv/1396/2/3'],
    [3, 'https://vidfast.vc', '/movie/27205', '/tv/1396/2/3'],
]) {
    test(`Server ${server}: movie route, autoplay and permissions`, () => {
        const { context, player, buttons, audioButton } = loadPlayer();
        context.window.changeServer(server);
        const frame = player.frames.at(-1);
        const url = new URL(frame.src);
        assert.equal(url.origin, provider);
        assert.equal(url.pathname, moviePath);
        assert.equal(url.searchParams.get('autoPlay'), 'true');
        assert.equal(frame.allowFullscreen, true);
        assert.equal(frame.title, `Video player — Server ${server}`);
        assert.deepEqual(buttons.filter(b => b.active).map(b => b.dataset.server), [String(server)]);
        assert.equal(buttons[server - 1].attributes['aria-pressed'], 'true');
        assert.equal(audioButton.active, true);
    });

    test(`Server ${server}: preserves selected season/episode and uses TMDB for anime`, () => {
        const { context, player } = loadPlayer('?type=tv&id=1396');
        vm.runInContext('currentSeason = 2; currentEpisode = 3;', context);
        context.window._animeRoute = { route: 'use_anime', mal_id: 999 };
        context.window.changeServer(server);
        const url = new URL(player.frames.at(-1).src);
        assert.equal(url.origin, provider);
        assert.equal(url.pathname, tvPath);
    });
}

test('Switches back from new servers to all four existing movie providers', () => {
    const { context, player } = loadPlayer();
    context.window.changeServer(6);
    for (const [server, expected] of [
        [1, 'https://player.xudomovie.us/embed/movie/27205?autoplay=1&ds_lang=en&startAt=0.01'],
        [2, 'https://vidlink.pro/movie/27205?autoplay=true&player=jw&startAt=1.01'],
        [6, 'https://www.2embed.skin/embed/27205'],
        [4, 'https://vidcore.org/embed/movie/27205?autoPlay=true'],
    ]) {
        context.window.changeServer(server);
        assert.equal(player.frames.at(-1).src, expected);
    }
});

function message(frame, overrides = {}, info = {}) {
    return { origin: 'https://player.xudomovie.us', source: frame.contentWindow, data: {
        type: 'PLAYER_EVENT', data: {
            player_info: { mediaType: 'movie', tmdb: '27205', ...info },
            player_status: 'playing', player_progress: 125, player_duration: 8886, ...overrides,
        },
    } };
}

test('Server 1 records validated events, restores after reload, and restarts from zero', () => {
    const { context, player, stored } = loadPlayer(undefined, 'id-ID');
    vm.runInContext("_watchMetadata = {id: 27205, title: 'Inception', media_type: 'movie'}", context);
    context.window.changeServer(1);
    const originalFrame = player.frames.at(-1);
    context.onPlayerProgress(message(originalFrame));
    let progress = context.window.XUDO_PLAYBACK.get({ type: 'movie', id: 27205 });
    assert.equal(progress.position, 125);
    assert.equal(JSON.parse(stored.get('xudo_history'))[0].progress.position, 125);
    context.window.changeServer(1);
    const resumed = new URL(player.frames.at(-1).src);
    assert.equal(resumed.searchParams.get('startAt'), '125');
    assert.equal(resumed.searchParams.get('ds_lang'), 'id,en');
    context.onPlayerProgress(message(originalFrame, { player_progress: 500 }));
    assert.equal(context.window.XUDO_PLAYBACK.get({ type: 'movie', id: 27205 }).position, 125, 'stale frame ignored');
    context.restartPlayback();
    assert.equal(new URL(player.frames.at(-1).src).searchParams.get('startAt'), '0.01');
    assert.equal(context.window.XUDO_PLAYBACK.get({ type: 'movie', id: 27205 }), null);
    assert.equal(JSON.parse(stored.get('xudo_history'))[0].progress, undefined);
});

test('Server 1 ignores other origins, frames, titles, malformed payloads and other providers', () => {
    const { context, player, stored } = loadPlayer();
    context.window.changeServer(1);
    const frame = player.frames.at(-1);
    for (const invalid of [
        { ...message(frame), origin: 'https://vidsrc.sh' },
        { ...message(frame), origin: 'https://player.xudomovie.us.attacker.test' },
        { ...message(frame), origin: 'https://xudomovie.us' },
        { ...message(frame), origin: 'http://player.xudomovie.us' },
        { ...message(frame), source: {} },
        message(frame, {}, { tmdb: 999 }),
        message(frame, {}, { mediaType: 'tv' }),
        message(frame, { player_progress: '125' }),
        message(frame, { player_progress: -5 }),
        message(frame, { player_progress: Infinity }),
        message(frame, { player_progress: 9000 }),
        message(frame, { player_duration: 0 }),
        message(frame, { player_status: 'unknown' }),
        { ...message(frame), data: null },
    ]) context.onPlayerProgress(invalid);
    assert.equal(stored.get('xudo_vidsrc_progress_v1'), undefined);
    context.window.changeServer(6);
    context.onPlayerProgress(message(frame));
    assert.equal(stored.get('xudo_vidsrc_progress_v1'), undefined);
});

test('TV episode progress stays separate from other episodes and movies with the same ID', () => {
    const { context, player } = loadPlayer('?type=tv&id=1396');
    const playback = context.window.XUDO_PLAYBACK;
    vm.runInContext('currentSeason = 2; currentEpisode = 3;', context);
    context.window.changeServer(1);
    const frame = player.frames.at(-1);
    const info = { mediaType: 'tv', tmdb: 1396, season: '2', episode: '3' };
    context.onPlayerProgress(message(frame, { player_progress: 300, player_duration: 2800 }, info));
    context.onPlayerProgress(message(frame, { player_progress: 500 }, { ...info, episode: 2 }));
    assert.equal(playback.get({ type: 'tv', id: 1396, season: 2, episode: 3 }).position, 300);
    assert.equal(playback.get({ type: 'tv', id: 1396, season: 2, episode: 2 }), null);
    assert.equal(playback.get({ type: 'movie', id: 1396 }), null);
    vm.runInContext('currentEpisode = 2;', context);
    context.window.changeServer(1);
    assert.equal(new URL(player.frames.at(-1).src).searchParams.get('startAt'), '0.01');
    vm.runInContext('currentEpisode = 3;', context);
    context.window.changeServer(1);
    assert.equal(new URL(player.frames.at(-1).src).searchParams.get('startAt'), '300');
});

test('Completed videos do not resume at their ending; seek and pause persist', () => {
    const { context, player } = loadPlayer();
    const playback = context.window.XUDO_PLAYBACK;
    const content = { type: 'movie', id: 27205 };
    context.window.changeServer(1);
    const frame = player.frames.at(-1);
    for (const status of ['paused', 'seeked']) {
        context.onPlayerProgress(message(frame, { player_status: status, player_progress: 200 }));
        assert.equal(playback.get(content).position, 200);
    }
    context.onPlayerProgress(message(frame, { player_status: 'completed', player_progress: 8886 }));
    assert.equal(playback.get(content).completed, true);
    assert.equal(new URL(playback.buildUrl(content, 'en-US')).searchParams.get('startAt'), '0.01');
});

test('Initial zero events do not overwrite a saved resume position', () => {
    const { context, player } = loadPlayer();
    context.window.changeServer(1);
    const frame = player.frames.at(-1);
    context.onPlayerProgress(message(frame));
    context.onPlayerProgress(message(frame, { player_progress: 0 }));
    assert.equal(context.window.XUDO_PLAYBACK.get({ type: 'movie', id: 27205 }).position, 125);
    context.onPlayerProgress(message(frame, { player_progress: 0, player_status: 'seeked' }));
    assert.equal(context.window.XUDO_PLAYBACK.get({ type: 'movie', id: 27205 }).position, 0);
});

test('Corrupt or unavailable storage does not crash playback', () => {
    const { context, stored } = loadPlayer();
    const playback = context.window.XUDO_PLAYBACK;
    const content = { type: 'movie', id: 27205 };
    stored.set('xudo_vidsrc_progress_v1', 'broken');
    assert.equal(playback.get(content), null);
    stored.set('xudo_history', '{}');
    assert.equal(context.readWatchHistory().length, 0);
    context.localStorage.setItem = () => { throw new Error('Storage unavailable'); };
    assert.equal(playback.save(content, 10, 100, 'playing'), null);
    assert.doesNotThrow(() => context.window.changeServer(1));
});

test('Progress survives a fresh page context and clearing history clears resume data', () => {
    const first = loadPlayer();
    first.context.window.XUDO_PLAYBACK.save({ type: 'movie', id: 27205 }, 300, 8886, 'playing');
    const next = loadPlayer();
    next.stored.set('xudo_vidsrc_progress_v1', first.stored.get('xudo_vidsrc_progress_v1'));
    next.context.window.changeServer(1);
    assert.equal(new URL(next.player.frames.at(-1).src).searchParams.get('startAt'), '300');
    next.context.confirm = () => true;
    next.context.window.clearHistory();
    assert.equal(next.context.window.XUDO_PLAYBACK.get({ type: 'movie', id: 27205 }), null);
});

test('Custom domain preserves existing saved progress and IMDb-only events', () => {
    const { context, player, stored } = loadPlayer(undefined, 'id-ID');
    // This is the unchanged storage format used before the domain migration.
    stored.set('xudo_vidsrc_progress_v1', JSON.stringify({
        'movie:27205': { position: 113.66, duration: 8886, completed: false, updatedAt: 1 },
    }));
    vm.runInContext("_watchMetadata = {id: 27205, title: 'Inception', media_type: 'movie', imdb_id: 'tt1375666'}", context);
    context.window.changeServer(1);
    const frame = player.frames.at(-1);
    const url = new URL(frame.src);
    assert.equal(url.origin, 'https://player.xudomovie.us');
    assert.equal(url.searchParams.get('startAt'), '113');
    context.onPlayerProgress(message(frame, { player_progress: 140 }, { tmdb: null, imdb: 'tt1375666' }));
    assert.equal(context.window.XUDO_PLAYBACK.get({ type: 'movie', id: 27205 }).position, 140);
});

test('Custom player movie and TV URLs retain subtitle selection for all 19 languages', () => {
    const { context } = loadPlayer();
    const playback = context.window.XUDO_PLAYBACK;
    for (const locale of Object.keys(context.window.XUDO_I18N.TRANSLATIONS)) {
        for (const content of [{ type: 'movie', id: 27205 }, { type: 'tv', id: 1396, season: 2, episode: 3 }]) {
            const url = new URL(playback.buildUrl(content, locale));
            assert.equal(url.origin, 'https://player.xudomovie.us');
            assert.equal(url.pathname, content.type === 'movie' ? '/embed/movie/27205' : '/embed/tv/1396/2/3');
            assert.equal(url.searchParams.get('ds_lang'), playback.subtitleLanguages(locale));
        }
    }
});

test('All 19 languages have resume labels and valid subtitle preferences', () => {
    const { context } = loadPlayer();
    const playback = context.window.XUDO_PLAYBACK;
    for (const [locale, labels] of Object.entries(context.window.XUDO_I18N.TRANSLATIONS)) {
        for (const field of ['resumeAt', 'progressSaved', 'startOver', 'watchedComplete']) assert.ok(labels[field], `${locale}:${field}`);
        const codes = playback.subtitleLanguages(locale).split(',');
        assert.ok(codes.length <= 3);
        assert.equal(codes.at(-1), 'en');
    }
    assert.equal(playback.subtitleLanguages('id-ID'), 'id,en');
    assert.equal(playback.subtitleLanguages('tl-PH'), 'tl,fil,en');
    assert.equal(playback.subtitleLanguages('zh-TW'), 'zh,en');
    assert.equal(playback.subtitleLanguages('invalid'), 'en');
});

test('Continue Watching cards show real progress and metadata updates preserve it', () => {
    const { context, stored } = loadPlayer();
    const item = { id: 27205, title: 'Inception', media_type: 'movie', release_date: '2010-07-16', vote_average: 8.8, progress: { position: 300, duration: 600 } };
    context.saveWatchHistory(item, item.progress);
    context.saveWatchHistory(item);
    assert.equal(JSON.parse(stored.get('xudo_history'))[0].progress.position, 300);
    const html = context.createCardHTML(item);
    assert.match(html, /value="50"/);
    assert.match(html, /05:00 \/ 10:00/);
});

test('Ignores invalid server selections', () => {
    const { context, player } = loadPlayer();
    for (const invalid of [0, 7, -1, 5.5, '6', null]) context.window.changeServer(invalid);
    assert.equal(player.frames.length, 0);
});

test('Sound preference persists across pages without changing resume data', () => {
    const first = loadPlayer();
    const playback = first.context.window.XUDO_PLAYBACK;
    assert.equal(playback.getSoundPreference(), 'auto');
    playback.save({ type: 'movie', id: 27205 }, 125, 8886, 'playing');
    assert.equal(playback.setSoundPreference('on'), true);
    assert.equal(playback.setSoundPreference('invalid'), false);
    const next = loadPlayer();
    for (const [key, value] of first.stored) next.stored.set(key, value);
    assert.equal(next.context.window.XUDO_PLAYBACK.getSoundPreference(), 'on');
    assert.equal(next.context.window.XUDO_PLAYBACK.get({ type: 'movie', id: 27205 }).position, 125);
    next.context.window.XUDO_PLAYBACK.clear();
    assert.equal(next.context.window.XUDO_PLAYBACK.getSoundPreference(), 'on');
});

test('Saved sound command goes only to the active custom player before autoplay', () => {
    const { context, player } = loadPlayer();
    const playback = context.window.XUDO_PLAYBACK;
    playback.setSoundPreference('on');
    context.window.changeServer(1);
    const frame = player.frames.at(-1);
    const title = { ...message(frame), data: { type: 'PLAYER_TITLE', title: 'Inception' } };
    context.onPlayerProgress({ ...title, origin: 'https://vidsrc.sh' });
    context.onPlayerProgress({ ...title, source: {} });
    assert.equal(frame.contentWindow.messages.length, 0);
    context.onPlayerProgress(title);
    assert.equal(frame.contentWindow.messages.length, 1);
    assert.equal(frame.contentWindow.messages[0].data.action, 'unmute');
    assert.equal(frame.contentWindow.messages[0].data.player, true);
    assert.equal(frame.contentWindow.messages[0].origin, 'https://player.xudomovie.us');
    context.onPlayerProgress(message(frame));
    assert.equal(frame.contentWindow.messages.length, 1, 'normal progress must not override native mute');
    context.window.changeServer(1);
    context.onPlayerProgress(title);
    assert.equal(frame.contentWindow.messages.length, 1, 'stale iframe ignored');
    const newFrame = player.frames.at(-1);
    context.onPlayerProgress({ ...message(newFrame), data: { type: 'PLAYER_TITLE' } });
    assert.equal(newFrame.contentWindow.messages[0].data.action, 'unmute');
    context.window.changeServer(2);
    context.onPlayerProgress({ ...message(newFrame), data: { type: 'PLAYER_TITLE' } });
    assert.equal(newFrame.contentWindow.messages.length, 1, 'other servers ignored');
});

test('Muted and default preferences work; blocked storage retains this page preference', () => {
    const { context, player, stored } = loadPlayer();
    const playback = context.window.XUDO_PLAYBACK;
    stored.set('xudo_vidsrc_sound_v1', 'broken');
    assert.equal(playback.getSoundPreference(), 'auto');
    context.window.changeServer(1);
    const active = { frame: player.frames.at(-1) };
    playback.applySoundPreference(active);
    assert.equal(active.frame.contentWindow.messages.length, 0);
    playback.setSoundPreference('off');
    playback.applySoundPreference(active);
    assert.equal(active.frame.contentWindow.messages.at(-1).data.action, 'mute');
    context.localStorage.setItem = () => { throw new Error('Blocked'); };
    assert.equal(playback.setSoundPreference('on'), false);
    assert.equal(playback.getSoundPreference(), 'on');
    playback.applySoundPreference(active);
    assert.equal(active.frame.contentWindow.messages.at(-1).data.action, 'unmute');
    playback.setSoundPreference('auto');
    playback.applySoundPreference(active);
    assert.equal(active.frame.contentWindow.messages.length, 2);
});

test('All 19 languages include sound settings labels and the selector has an accessible label', () => {
    const { context } = loadPlayer();
    for (const [locale, labels] of Object.entries(context.window.XUDO_I18N.TRANSLATIONS)) {
        for (const key of ['playerSettings', 'soundPreference', 'soundAuto', 'soundOn', 'soundOff', 'soundPreferenceNote', 'soundSessionOnly']) {
            assert.ok(labels[key], `${locale}:${key}`);
        }
    }
    const html = fs.readFileSync(path.join(root, 'watch.html'), 'utf8');
    assert.match(html, /for="player-sound-preference"/);
    assert.match(html, /aria-describedby="player-sound-note"/);
});

test('Restart remains available in settings while playback progress stays stored without a second timeline', () => {
    const { context, player } = loadPlayer();
    const restart = { hidden: true };
    const lookup = context.document.getElementById;
    context.document.getElementById = id => id === 'restart-playback' ? restart : lookup(id);
    context.window.changeServer(1);
    assert.equal(restart.hidden, true);
    context.onPlayerProgress(message(player.frames.at(-1)));
    assert.equal(restart.hidden, false);
    assert.equal(restart.textContent, 'Start over');
    assert.equal(context.window.XUDO_PLAYBACK.get({ type: 'movie', id: 27205 }).position, 125);
    context.restartPlayback();
    assert.equal(restart.hidden, true);
    assert.equal(context.window.XUDO_PLAYBACK.get({ type: 'movie', id: 27205 }), null);
    assert.equal(new URL(player.frames.at(-1).src).searchParams.get('startAt'), '0.01');
});

test('Watch page exposes six server buttons and every language mentions the new servers', () => {
    const html = fs.readFileSync(path.join(root, 'watch.html'), 'utf8');
    assert.deepEqual([...html.matchAll(/data-server="(\d+)"/g)].map(match => match[1]), ['1', '2', '3', '4', '5', '6']);
    const { context } = loadPlayer();
    for (const [language, texts] of Object.entries(context.window.XUDO_I18N.TRANSLATIONS)) {
        assert.match(texts.ublockNote, /5/, language);
        assert.match(texts.ublockNote, /6/, language);
    }
});

for (const server of [2, 3]) {
    const origin = server === 2 ? 'https://vidlink.pro' : 'https://vidfast.vc';
    function providerMessage(frame, data = {}, mediaType = 'movie') {
        return {origin, source: frame.contentWindow, data: {type: 'PLAYER_EVENT', data: {
            event: 'timeupdate', currentTime: 125, duration: 8886, tmdbId: mediaType === 'tv' ? 1396 : 27205,
            mediaType, ...(mediaType === 'tv' ? {season: 2, episode: 3} : {}), ...data,
        }}};
    }
    test(`Server ${server}: real event contract saves, resumes, completes and rejects stale or untrusted data`, () => {
        const {context, player, stored} = loadPlayer();
        vm.runInContext("_watchMetadata = {id: 27205, title: 'Inception', media_type: 'movie'}", context);
        context.window.changeServer(server);
        const frame = player.frames.at(-1);
        const valid = providerMessage(frame);
        for (const event of [{...valid, origin: origin + '.invalid'}, {...valid, source: {}},
            providerMessage(frame, {tmdbId: 9}), providerMessage(frame, {currentTime: -1}),
            providerMessage(frame, {duration: 0}), providerMessage(frame, {mediaType: 'tv'}),
            providerMessage(frame, {currentTime: '125'})]) context.onPlayerProgress(event);
        assert.equal(stored.get('xudo_vidsrc_progress_v1'), undefined);
        context.onPlayerProgress(valid);
        const playback = context.window.XUDO_PLAYBACK;
        assert.equal(playback.get({type: 'movie', id: 27205}).position, 125);
        const history = JSON.parse(stored.get('xudo_history'))[0];
        assert.equal(history.server, server);
        if (server === 2) assert.equal(new URL(frame.src).searchParams.get('player'), 'jw');
        assert.ok(context.getTargetUrl(history).includes(`server=${server}`));
        context.window.changeServer(server);
        assert.equal(new URL(player.frames.at(-1).src).searchParams.get('startAt'), '125');
        context.onPlayerProgress(providerMessage(frame, {currentTime: 500}));
        assert.equal(playback.get({type: 'movie', id: 27205}).position, 125);
        context.onPlayerProgress(providerMessage(player.frames.at(-1), {event: 'ended', currentTime: 8886}));
        assert.equal(playback.get({type: 'movie', id: 27205}).completed, true);
        assert.equal(new URL(playback.buildUrl({type: 'movie', id: 27205}, 'en-US', server)).searchParams.get('startAt'), server === 2 ? '1.01' : '0.01');
        context.restartPlayback();
        assert.equal(playback.get({type: 'movie', id: 27205}), null);
        assert.equal(new URL(player.frames.at(-1).src).searchParams.get('startAt'), server === 2 ? '1.01' : '0.01');
    });
    test(`Server ${server}: TV progress is isolated per episode; MEDIA_DATA imports only active episode`, () => {
        const {context, player} = loadPlayer('?type=tv&id=1396');
        vm.runInContext('currentSeason=2; currentEpisode=3;', context);
        context.window.changeServer(server);
        const frame = player.frames.at(-1);
        context.onPlayerProgress(providerMessage(frame, {event: 'pause', currentTime: 300, duration: 2800}, 'tv'));
        context.onPlayerProgress(providerMessage(frame, {episode: 2, currentTime: 500}, 'tv'));
        const playback = context.window.XUDO_PLAYBACK;
        assert.equal(playback.get({type:'tv',id:1396,season:2,episode:3}).position, 300);
        assert.equal(playback.get({type:'tv',id:1396,season:2,episode:2}), null);
        const key = server === 3 ? 't1396' : '1396';
        context.onPlayerProgress({origin, source:frame.contentWindow, data:{type:'MEDIA_DATA', data:{[key]:{
            id:1396,type:'tv',last_season_watched:'2',last_episode_watched:'3',show_progress:{
                s2e3:{season:'2',episode:'3',progress:{watched:320,duration:2800}},
                s2e2:{season:'2',episode:'2',progress:{watched:600,duration:2800}}}}}}});
        assert.equal(playback.get({type:'tv',id:1396,season:2,episode:3}).position, 320);
        assert.equal(playback.get({type:'tv',id:1396,season:2,episode:2}), null);
        vm.runInContext('currentEpisode=2;', context);
        context.window.changeServer(server);
        assert.equal(new URL(player.frames.at(-1).src).searchParams.get('startAt'), server === 2 ? '1.01' : '0.01');
        vm.runInContext('currentEpisode=3;', context);
        context.window.changeServer(server);
        assert.equal(new URL(player.frames.at(-1).src).searchParams.get('startAt'), '320');
    });
}

test('VidFast subtitle preference follows all 19 application languages for movies and TV', () => {
    const {context} = loadPlayer();
    for (const locale of Object.keys(context.window.XUDO_I18N.TRANSLATIONS)) {
        for (const content of [{type:'movie',id:27205},{type:'tv',id:1396,season:2,episode:3}]) {
            const url = new URL(context.window.XUDO_PLAYBACK.buildUrl(content, locale, 3));
            assert.equal(url.searchParams.get('sub'), locale.split('-')[0]);
        }
    }
    const html = fs.readFileSync(path.join(root,'watch.html'),'utf8');
    assert.match(html, /data-server="3"[^>]*title="VidFast"/);
    assert.match(html, /data-server="6"[^>]*title="2Embed"/);
});

test('Changing servers persists selection in the watch URL without losing the episode', () => {
    const {context} = loadPlayer('?type=tv&id=1396&s=2&e=3');
    vm.runInContext('currentSeason=2; currentEpisode=3;',context);
    let selected;
    context.window.history = {replaceState(_state,_title,url) { selected = url; }};
    context.window.changeServer(3);
    const url = new URL(selected, 'http://localhost/');
    assert.equal(url.searchParams.get('server'),'3');
    assert.equal(url.searchParams.get('s'),'2');
    assert.equal(url.searchParams.get('e'),'3');
});

test('Server 2 anime uses TMDB, saves progress and restores the correct episode', () => {
    const {context, player, stored} = loadPlayer('?type=tv&id=37854&s=1&e=2');
    context.window._animeRoute = {route:'use_anime',mal_id:21}; // Legacy hint must not select the MAL route.
    vm.runInContext("currentSeason=1; currentEpisode=2; _watchMetadata={id:37854,name:'One Piece',media_type:'tv',vote_average:8.7};",context);
    let watchUrl;
    context.window.history={replaceState(_state,_title,url){watchUrl=url;}};
    context.window.changeServer(2);
    const frame=player.frames.at(-1);
    let url=new URL(frame.src);
    assert.equal(url.pathname,'/tv/37854/1/2');
    assert.equal(url.searchParams.get('player'),'jw');
    assert.equal(context.supportsPlaybackProgress(),true);
    const active=vm.runInContext('_activePlayback',context);
    assert.equal(active.id,'37854');
    assert.equal(active.episode,2);
    const event={origin:'https://vidlink.pro',source:frame.contentWindow,data:{type:'MEDIA_DATA',data:{
        '37854':{id:37854,type:'tv',last_season_watched:1,last_episode_watched:2,show_progress:{
            s1e2:{season:1,episode:2,progress:{watched:125,duration:1440}}}},
        '21':{id:21,type:'tv',last_season_watched:1,last_episode_watched:2,show_progress:{
            s1e2:{season:1,episode:2,progress:{watched:500,duration:1440}}}}
    }}};
    context.onPlayerProgress(event);
    const history=JSON.parse(stored.get('xudo_history'))[0];
    assert.equal(history.id,37854);
    assert.equal(history.server,2);
    assert.equal(history.episode,2);
    assert.equal(history.progress.position,125);
    const card=context.createCardHTML({...history,media_type:history.type,first_air_date:'1999-10-20',vote_average:history.rating});
    assert.match(card,/data-href="watch.html\?type=tv&id=37854&s=1&e=2&server=2"/);
    assert.equal(context.window.XUDO_PLAYBACK.get({type:'tv',id:21,season:1,episode:2}),null);
    vm.runInContext('currentEpisode=3;',context);
    context.updatePlayer('tv',37854);
    url=new URL(watchUrl,'http://localhost/');
    assert.equal(url.searchParams.get('e'),'3');
    assert.equal(url.searchParams.get('s'),'1');
    assert.equal(url.searchParams.get('server'),'2');
    assert.equal(new URL(player.frames.at(-1).src).searchParams.get('startAt'),'1.01');
    context.onPlayerProgress(event); // A removed episode frame must not update the next episode.
    assert.equal(context.window.XUDO_PLAYBACK.get({type:'tv',id:37854,season:1,episode:3}),null);
    vm.runInContext('currentEpisode=2;',context);
    context.updatePlayer('tv',37854);
    assert.equal(new URL(player.frames.at(-1).src).searchParams.get('startAt'),'125');
    assert.equal(typeof context.window.changeAnimeDub,'undefined');
});
