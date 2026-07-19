// Cloudflare Pages Function — reverse proxy to the TMDB API.
//
// Client calls /api/tmdb/<tmdb-path>?<query> (no api_key). This function
// appends the real TMDB_API_KEY (Cloudflare env var, never shipped to the
// browser) and forwards the request to https://api.themoviedb.org/3/<path>.
//
// Configure TMDB_API_KEY in Cloudflare Pages → Settings → Environment variables.

const TMDB_BASE = 'https://api.themoviedb.org/3';

export async function onRequest(context) {
    const { request, env, params } = context;

    if (request.method !== 'GET') {
        return jsonResponse({ error: 'Method not allowed.' }, 405);
    }

    const apiKey = env.TMDB_API_KEY;
    if (!apiKey) {
        return jsonResponse({ error: 'TMDB_API_KEY is not configured on the server.' }, 500);
    }

    const pathSegments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
    if (pathSegments.length === 0) {
        return jsonResponse({ error: 'Missing TMDB endpoint path.' }, 400);
    }
    const upstreamPath = pathSegments.map(encodeURIComponent).join('/');

    const incomingUrl = new URL(request.url);
    const upstreamUrl = new URL(`${TMDB_BASE}/${upstreamPath}`);

    // Forward all client query params, but never trust a client-supplied api_key.
    for (const [key, value] of incomingUrl.searchParams) {
        if (key === 'api_key') continue;
        upstreamUrl.searchParams.set(key, value);
    }
    upstreamUrl.searchParams.set('api_key', apiKey);

    let upstreamResponse;
    try {
        upstreamResponse = await fetch(upstreamUrl.toString(), {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        });
    } catch (err) {
        return jsonResponse({ error: 'Failed to reach TMDB API.' }, 502);
    }

    const body = await upstreamResponse.text();
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
    headers.set('Cache-Control', upstreamResponse.ok ? 'public, max-age=300' : 'no-store');

    return new Response(body, { status: upstreamResponse.status, headers });
}

function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}
