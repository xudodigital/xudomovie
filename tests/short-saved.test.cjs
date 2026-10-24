const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function app(store = {}) {
    const saved = new Map(Object.entries({ xudo_lang: 'en-US', ...store }));
    const context = vm.createContext({ window: { location: { hostname: 'localhost', search: '' } }, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
        localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
        document: { addEventListener() {}, getElementById: () => null },
    });
    for (const file of ['js/i18n/translations.js', 'js/player-progress.js', 'js/catalog-policy.js', 'js/short-serial.js', 'js/main.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    return { context, saved, serial: context.window.XUDO_SHORT_SERIAL };
}
const drama = { id: '123', provider: 'dramatap', title: 'Captain Drama', poster: 'https://img.dramatap.app/p.jpg', episodeCount: 50 };

test('Favourites are keyed by id and type, so a DramaTap id never matches a movie with the same number', () => {
    const { context, saved } = app({ xudo_favs: JSON.stringify([{ id: 123, type: 'movie', title: 'Movie' }, { id: 7 }]) });
    assert.equal(context.isFavorite(123, 'movie'), true);
    assert.equal(context.isFavorite('123', 'shortdrama'), false);
    assert.equal(context.isFavorite(7, 'tv'), true); // legacy entries without a type still match
    const button = { classList: { toggle() {} }, setAttribute() {}, innerHTML: '' };
    context.toggleFavoriteCore('123', 'shortdrama', 'Captain Drama', drama.poster, '', '', button, { episodes: 50 });
    const favs = JSON.parse(saved.get('xudo_favs'));
    assert.equal(favs.length, 3);
    assert.deepEqual({ ...favs[2] }, { id: '123', type: 'shortdrama', title: 'Captain Drama', poster: drama.poster, year: '', rating: '', episodes: 50 });
    context.toggleFavoriteCore('123', 'shortdrama', 'Captain Drama', drama.poster, '', '', button);
    assert.equal(JSON.parse(saved.get('xudo_favs')).length, 2);
});

test('Short drama cards carry a sibling favourite button, saved state and an episode/progress line', () => {
    const { serial } = app({ xudo_favs: JSON.stringify([{ id: '123', type: 'shortdrama' }]) });
    const html = serial.card({ ...drama, episode: '4', progress: { position: 30, duration: 120 } });
    assert.match(html, /<button type="button" class="card-fav-btn active"[^>]*data-fav-type="shortdrama"[^>]*data-fav-episodes="50"/);
    assert.match(html, /e=4/); assert.match(html, /<progress max="100" value="25"/); assert.match(html, /Episode 4 · 25%/);
    assert.doesNotMatch(html, /<a[^>]*>(?:(?!<\/a>)[\s\S])*<button/);
});

test('Saved short dramas hydrate without TMDB and render through the shared saved-card helper', async () => {
    const { context } = app();
    context.fetch = () => { throw new Error('TMDB must not be called'); };
    const items = await context.hydrateSavedCatalogItems([{ id: '123', type: 'shortdrama', title: 'Captain Drama', poster: drama.poster, episodes: 50, episode: '3' }, { id: '../x', type: 'shortdrama', title: 'bad' }]);
    assert.equal(items.length, 1);
    assert.match(context.createSavedCardHTML(items[0]), /e=3/);
});

test('Short drama history keeps one entry per series, newest first, and survives for resume', () => {
    const { context, saved } = app({ xudo_history: JSON.stringify([{ id: 9, type: 'movie', title: 'M' }]) });
    context.saveShortDramaHistory(drama, '2', { position: 12, duration: 60, completed: false });
    context.saveShortDramaHistory(drama, '3');
    const history = JSON.parse(saved.get('xudo_history'));
    assert.equal(history.length, 2);
    assert.equal(history[0].type, 'shortdrama'); assert.equal(history[0].episode, '3'); assert.equal(history[0].progress, undefined);
    assert.equal(context.getShortDramaHistory('123').episode, '3');
});
