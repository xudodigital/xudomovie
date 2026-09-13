// Cloudflare Pages Function — proxy for MyAnimeList v2 anime search.
//
// Client calls /api/mal/search?title=<anime title>. This function
// attaches the real MAL_CLIENT_ID (Cloudflare env var, never shipped to
// the browser) and forwards the search to api.myanimelist.net.
//
// Configure MAL_CLIENT_ID in Cloudflare Pages → Settings → Environment variables.

const MAL_SEARCH = 'https://api.myanimelist.net/v2/anime';

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method !== 'GET') {
        return jsonResponse({ error: 'Method not allowed.' }, 405);
    }

    const clientId = env.MAL_CLIENT_ID;
    if (!clientId) {
        return jsonResponse({ error: 'Search service is not configured.' }, 500);
    }

    const incomingUrl = new URL(request.url);
    const title = incomingUrl.searchParams.get('title');
    if (!title || !title.trim()) {
        return jsonResponse({ error: 'Missing required query param: title.' }, 400);
    }

    const upstreamUrl = new URL(MAL_SEARCH);
    upstreamUrl.searchParams.set('q', title.trim());
    upstreamUrl.searchParams.set('limit', '5');
    upstreamUrl.searchParams.set('fields', 'id,title,alternative_titles');

    let upstreamResponse;
    try {
        upstreamResponse = await fetch(upstreamUrl.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'X-MAL-CLIENT-ID': clientId,
            },
        });
    } catch (_) {
        return jsonResponse({ error: 'Failed to reach MyAnimeList API.' }, 502);
    }

    if (upstreamResponse.status === 401) {
        return jsonResponse({ error: 'Search service authentication failed.' }, 502);
    }
    if (upstreamResponse.status === 429) {
        return jsonResponse({ error: 'Rate limit reached. Please try again shortly.' }, 429);
    }
    if (!upstreamResponse.ok) {
        return jsonResponse({ error: `Upstream error: ${upstreamResponse.status}.` }, 502);
    }

    let data;
    try {
        data = await upstreamResponse.json();
    } catch (_) {
        return jsonResponse({ error: 'Invalid response from MyAnimeList API.' }, 502);
    }

    // Return only the fields the client needs — never forward the raw MAL payload.
    const candidates = (data.data || []).map(({ node }) => ({
        mal_id:            node.id,
        title:             node.title,
        alternative_titles: node.alternative_titles ?? {},
    }));

    return jsonResponse({ candidates }, 200, 'public, max-age=300');
}

function jsonResponse(obj, status, cacheControl = 'no-store') {
    return new Response(JSON.stringify(obj), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': cacheControl,
        },
    });
}
