// VidSrc's public content index reports catalogue availability, not playback health.
(function (root) {
    'use strict';
    const TTL = 5 * 60 * 1000;
    const qualities = new Set(['1080p', '720p', 'DVD', 'SD', 'CAM']);

    function target(content) {
        if (!content || !['movie', 'tv', 'show'].includes(content.type)) return null;
        const number = (value, minimum) => /^\d+$/.test(String(value)) &&
            Number.isSafeInteger(Number(value)) && Number(value) >= minimum;
        if (!number(content.id, 1)) return null;
        const id = String(Number(content.id));
        if (content.type === 'movie') return { path: `movie/${id}`, id, type: 'movie' };
        // Whole-series index, used for catalogue cards where no episode is chosen.
        if (content.type === 'show') return { path: `tv/${id}`, id, type: 'tv', show: true };
        if (!number(content.season, 0) || !number(content.episode, 1)) return null;
        const season = Number(content.season), episode = Number(content.episode);
        return { path: `tv/${id}/${season}/${episode}`, id, type: 'episode', season, episode };
    }

    function createClient({ fetch: request = (...args) => root.fetch(...args), now = Date.now,
        setTimeout: schedule = root.setTimeout.bind(root), clearTimeout: cancel = root.clearTimeout.bind(root), timeout = 8000 } = {}) {
        const cache = new Map();
        async function check(content, { force = false, signal } = {}) {
            const query = target(content);
            const unknown = { state: 'unknown' };
            if (!query || signal?.aborted) return unknown;
            const cached = cache.get(query.path);
            if (!force && cached && now() - cached.at < TTL) return { ...cached.result };
            const controller = new AbortController();
            const abort = () => controller.abort();
            signal?.addEventListener('abort', abort, { once: true });
            const timer = schedule(abort, timeout);
            try {
                const response = await request(`https://vidsrc.sh/info/${query.path}.json`, {
                    signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
                });
                if (response.status !== 200 && response.status !== 404) return unknown;
                const data = await response.json();
                if (controller.signal.aborted) return unknown;
                let result;
                if (response.status === 404 && data?.status_code === 404 && data.error === 'not found') {
                    result = { state: 'unavailable' };
                } else if (response.status === 200 && data?.status_code === 200 && data.type === query.type &&
                    String(data.tmdb_id) === query.id && (query.type === 'movie' || query.show ||
                    target({ type: 'tv', id: data.tmdb_id, season: data.season, episode: data.episode })?.path === query.path)) {
                    result = { state: 'available', quality: qualities.has(data.quality) ? data.quality : '' };
                } else return unknown;
                // Bounded, in-memory cache only. Network errors never become "not available".
                cache.delete(query.path);
                cache.set(query.path, { at: now(), result });
                if (cache.size > 100) cache.delete(cache.keys().next().value);
                return { ...result };
            } catch (_) { return unknown; }
            finally { cancel(timer); signal?.removeEventListener('abort', abort); }
        }
        return { check };
    }

    const api = { target, createClient, ...createClient() };
    root.XUDO_STREAM_AVAILABILITY = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
