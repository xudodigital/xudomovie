import { SERIAL_ROUTES, handleSerialRequest } from '../../_lib/shortdrama.js';

// Cloudflare Pages Function — DramaTap routes: catalog, search, detail, episodes.
// See SHORT-DRAMA.md for parameters and caching.
export async function onRequest(context) {
    const { request, params } = context;
    if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed.' }, 405);

    const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
    const route = segments.length === 1 ? segments[0] : '';
    if (SERIAL_ROUTES.includes(route)) return handleSerialRequest(context, route);
    return jsonResponse({ error: 'Endpoint not allowed.' }, 404);
}

function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}
