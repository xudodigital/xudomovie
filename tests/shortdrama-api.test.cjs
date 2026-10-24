const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'functions/api/shortdrama/[[path]].js')).href);
const call = async (segments, query = '', method = 'GET') => {
    const { onRequest } = await load();
    return onRequest({ request: new Request(`http://localhost/api/shortdrama/${segments.join('/')}?${query}`, { method }), env: {}, params: { path: segments } });
};

test('Short drama API serves DramaTap routes only; removed YouTube routes, other methods and unknown paths are rejected', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('no upstream call expected'); };
    try {
        assert.equal((await call(['catalog'], '', 'POST')).status, 405);
        for (const route of [['list'], ['video'], ['admin'], ['catalog', 'extra'], []]) assert.equal((await call(route, 'id=dQw4w9WgXcQ')).status, 404, route.join('/'));
    } finally { globalThis.fetch = original; }
});
