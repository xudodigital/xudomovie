import { parse } from 'parse5';

// DramaTap's public JSON search/episode endpoints plus server-rendered catalogue/detail pages.
const DEFAULT_ORIGIN = 'https://dramatap.app';
const PROVIDER = 'dramatap';
const ID = /^[1-9]\d{0,11}$/;
export const SERIAL_ROUTES = ['catalog', 'search', 'detail', 'episodes'];
class ProviderError extends Error {
    constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}
const fail = () => { throw new ProviderError('PROVIDER_INVALID_RESPONSE'); };
const text = value => typeof value === 'string' ? value : '';
const count = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const identifier = value => typeof value === 'string' ? value : Number.isSafeInteger(value) ? String(value) : '';
const episodeCount = label => count(/(?:EP\s*(\d+)|(\d+)\s*episodes?)/i.exec(text(label))?.slice(1).find(Boolean));
export function safeMediaURL(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password) return '';
        if (url.hostname === 'localhost' || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname) || url.hostname.endsWith('.local')) return '';
        return url.href;
    } catch { return ''; }
}
const attr = (node, name) => node?.attrs?.find(a => a.name === name)?.value || '';
const hasClass = (node, name) => attr(node, 'class').split(/\s+/).includes(name);
function nodes(root, predicate) {
    const matches = [];
    function walk(node) {
        if (!node) return;
        if (predicate(node)) matches.push(node);
        for (const child of node.childNodes || []) walk(child);
    }
    walk(root); return matches;
}
const first = (root, predicate) => nodes(root, predicate)[0];
function contents(node) {
    if (!node || ['script', 'style'].includes(node.tagName)) return '';
    return node.nodeName === '#text' ? node.value : (node.childNodes || []).map(contents).join('');
}
const cleanText = node => contents(node).replace(/\s+/g, ' ').trim();
export function normalizeDrama(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = identifier(raw.id);
    const title = text(raw.title).trim();
    if (!ID.test(id) || !title) return null;
    return { id, provider: PROVIDER, channel: 'DramaTap', title: title.slice(0, 300),
        poster: safeMediaURL(raw.cover), synopsis: text(raw.synopsis).slice(0, 10000),
        episodeCount: count(raw.episodeCount) || episodeCount(raw.label) };
}
function uniqueItems(rows) {
    const seen = new Set();
    return rows.map(normalizeDrama).filter(item => {
        if (!item || seen.has(item.id)) return false;
        seen.add(item.id); return true;
    }).slice(0, 100);
}
export function normalizeSearch(payload) {
    if (!Array.isArray(payload?.items)) fail();
    return uniqueItems(payload.items);
}
export function parseCatalogHTML(html, feed) {
    const document = parse(html);
    const grid = first(document, node => hasClass(node, feed === 'latest' ? 'grid-new' : 'grid-home'));
    if (!grid) fail();
    const cards = nodes(grid, node => node.tagName === 'a' && hasClass(node, 'ssr-card'));
    const items = uniqueItems(cards.map(card => {
        const id = /^\/d\/(\d+)(?:\/|$)/.exec(attr(card, 'href'))?.[1];
        return { id, title: attr(card, 'title'), cover: attr(first(card, n => n.tagName === 'img'), 'src'),
            label: cleanText(first(card, n => hasClass(n, 'm'))) };
    }));
    if (cards.length && !items.length) fail();
    return items;
}
// DramaTap's /new and /new/{page} listings: numbered pages, "Next ›" present while more pages exist.
export function parseNewPageHTML(html) {
    const document = parse(html);
    const cards = nodes(document, node => node.tagName === 'a' && hasClass(node, 'ssr-card'));
    const items = uniqueItems(cards.map(card => {
        const id = /^\/d\/(\d+)(?:\/|$)/.exec(attr(card, 'href'))?.[1];
        return { id, title: attr(card, 'title'), cover: attr(first(card, n => n.tagName === 'img'), 'src'),
            label: cleanText(first(card, n => hasClass(n, 'm'))) };
    }));
    if (!first(document, node => hasClass(node, 'ssr-pagination')) || (cards.length && !items.length)) fail();
    const hasMore = nodes(document, node => node.tagName === 'a' && hasClass(node, 'ssr-page-btn')).some(node => /^Next/.test(cleanText(node)));
    return { items, hasMore };
}
export function parseDetailHTML(html, id) {
    const document = parse(html);
    const drama = first(document, node => attr(node, 'id') === 'ssr-drama');
    if (!drama || attr(drama, 'data-drama-id') !== id) fail();
    const synopsis = first(document, node => attr(node, 'id') === 'ssr-syn') ||
        first(first(document, node => hasClass(node, 'ssr-synopsis')), node => node.tagName === 'p');
    const item = normalizeDrama({ id, title: attr(drama, 'data-drama-title'), label: attr(drama, 'data-drama-label'),
        episodeCount: count(attr(drama, 'data-total')), cover: attr(first(document, node => hasClass(node, 'ssr-cover')), 'src'), synopsis: cleanText(synopsis) });
    if (!item) fail();
    return item;
}
export function normalizeEpisodes(payload) {
    if (payload?.notfound) throw new ProviderError('DRAMA_NOT_FOUND', 404);
    if (payload?.gone) throw new ProviderError('STREAM_UNAVAILABLE', 422);
    if (!Array.isArray(payload?.items)) fail();
    const seen = new Set();
    const episodes = payload.items.map(raw => {
        const number = count(raw?.ep);
        if (!number || seen.has(number)) return null;
        seen.add(number);
        const url = safeMediaURL(raw.url);
        return { id: String(number), number, title: `Episode ${number}`, sources: url ? [{ url, label: 'Auto', type: /\.m3u8(?:\?|$)/i.test(url) ? 'hls' : 'mp4' }] : [] };
    }).filter(Boolean).sort((a, b) => a.number - b.number);
    if (payload.items.length && !episodes.length) fail();
    return episodes;
}
function response(data, status = 200, ttl = 0) {
    return new Response(JSON.stringify(data), { status, headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': ttl ? `public, max-age=${ttl}` : 'no-store',
        'X-Content-Type-Options': 'nosniff',
    } });
}
async function upstream(origin, path, query, format) {
    const url = new URL(path, origin);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        let res = await fetch(url, { headers: { Accept: format === 'html' ? 'text/html' : 'application/json' }, signal: controller.signal, redirect: 'manual' });
        // Numeric /d/:id pages can redirect to their canonical slug on the same origin.
        if ([301, 302, 307, 308].includes(res.status) && path.startsWith('/d/')) {
            const location = new URL(res.headers.get('Location') || '', url);
            if (location.origin !== origin || !location.pathname.startsWith('/d/')) fail();
            res = await fetch(location, { headers: { Accept: 'text/html' }, signal: controller.signal, redirect: 'manual' });
        }
        if (res.status === 403 || res.status === 401) throw new ProviderError('PROVIDER_ACCESS_DENIED', 503);
        if (res.status === 429) throw new ProviderError('PROVIDER_RATE_LIMITED', 503);
        if (res.status === 404) throw new ProviderError('DRAMA_NOT_FOUND', 404);
        if (!res.ok) throw new ProviderError('PROVIDER_UNAVAILABLE');
        if (format === 'html') return await res.text();
        let body;
        try { body = await res.json(); } catch { fail(); }
        if (!body || body.error || body.success === false) fail();
        return body;
    } finally { clearTimeout(timer); }
}
export async function handleSerialRequest(context, route) {
    const query = new URL(context.request.url).searchParams;
    const provider = query.get('provider') || PROVIDER;
    if (provider !== PROVIDER) return response({ code: 'INVALID_PROVIDER' }, 400);
    const id = query.get('id') || '';
    const q = (query.get('q') || '').trim();
    const feed = query.get('feed') || 'trending';
    const page = query.has('page') ? Number(query.get('page')) : 0;
    if (['detail', 'episodes'].includes(route) && !ID.test(id)) return response({ code: 'INVALID_ID' }, 400);
    if (route === 'search' && (!q || q.length > 100)) return response({ code: 'INVALID_QUERY' }, 400);
    if (route === 'catalog' && !['trending', 'latest'].includes(feed)) return response({ code: 'INVALID_FEED' }, 400);
    // Only the latest feed is paginated upstream (/new/{page}); trending is a single page.
    if (query.has('page') && (route !== 'catalog' || !Number.isInteger(page) || page < 1 || page > 50 || (feed === 'trending' && page > 1))) return response({ code: 'INVALID_PAGE' }, 400);
    const configured = (context.env.DRAMATAP_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, '');
    let origin;
    try { const url = new URL(configured); if (!safeMediaURL(configured) || url.origin !== configured) throw new Error(); origin = url.origin; }
    catch { return response({ code: 'PROVIDER_NOT_CONFIGURED' }, 503); }
    const ttl = route === 'episodes' ? 0 : 300;
    try {
        const cache = ttl && typeof caches !== 'undefined' ? caches.default : null;
        let cacheKey;
        if (cache) {
            const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([origin, route, id, q, feed, page])));
            cacheKey = new Request(`${new URL(context.request.url).origin}/__shortdrama/dramatap-v1/${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}`);
            const hit = await cache.match(cacheKey);
            if (hit) return hit;
        }
        let data;
        if (route === 'catalog' && page && feed === 'latest') data = { provider, page, ...parseNewPageHTML(await upstream(origin, page === 1 ? '/new' : `/new/${page}`, {}, 'html')) };
        else if (route === 'catalog' && page) data = { provider, page, hasMore: false, items: parseCatalogHTML(await upstream(origin, '/', {}, 'html'), feed) };
        else if (route === 'catalog') data = { provider, items: parseCatalogHTML(await upstream(origin, '/', {}, 'html'), feed) };
        if (route === 'search') data = { provider, items: normalizeSearch(await upstream(origin, '/api/search', { q }, 'json')) };
        if (route === 'detail') data = parseDetailHTML(await upstream(origin, `/d/${id}`, {}, 'html'), id);
        if (route === 'episodes') data = { provider, id, episodes: normalizeEpisodes(await upstream(origin, '/api/episodes', { id }, 'json')) };
        const result = response(data, 200, ttl);
        if (cache) context.waitUntil?.(cache.put(cacheKey, result.clone()));
        return result;
    } catch (error) {
        return response({ code: error instanceof ProviderError ? error.code : error.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE' }, error instanceof ProviderError ? error.status : 502);
    }
}
