// One eligibility rule for catalogue cards, search results and saved collections.
(function (root) {
    'use strict';

    function today() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    function validDate(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const parsed = new Date(`${value}T00:00:00Z`);
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }

    function isEligible(item, typeOverride, cutoff = today()) {
        if (!item || typeof item !== 'object') return false;
        const type = item.media_type || typeOverride || (item.title ? 'movie' : 'tv');
        if (!['movie', 'tv'].includes(type)) return false;
        const rating = item.vote_average;
        if (typeof rating !== 'number' || !Number.isFinite(rating) || rating <= 0 || rating > 10) return false;
        if (item.vote_count != null && (typeof item.vote_count !== 'number' ||
            !Number.isFinite(item.vote_count) || item.vote_count <= 0)) return false;
        const date = type === 'movie' ? item.release_date : item.first_air_date;
        if (!validDate(date) || date > cutoff) return false;
        // List endpoints omit status; when details provide it, reject unreleased movies.
        if (type === 'movie' && item.status && item.status !== 'Released') return false;
        if (type === 'tv' && ['Planned', 'Pilot'].includes(item.status)) return false;
        return true;
    }

    function filter(items, typeOverride, cutoff = today()) {
        return Array.isArray(items) ? items.filter(item => isEligible(item, typeOverride, cutoff)) : [];
    }

    function discoverEndpoint(endpoint, type, cutoff = today()) {
        const [path, query = ''] = endpoint.split('?');
        if (!/^\/discover\/(movie|tv)$/.test(path)) return endpoint;
        const params = new URLSearchParams(query);
        const dateKey = type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte';
        const existingDate = params.get(dateKey);
        if (!validDate(existingDate) || existingDate > cutoff) params.set(dateKey, cutoff);
        params.set('vote_average.gte', String(Math.max(0.1, Number(params.get('vote_average.gte')) || 0)));
        params.set('vote_count.gte', String(Math.max(1, Number(params.get('vote_count.gte')) || 0)));
        return `${path}?${params}`;
    }

    const api = { today, validDate, isEligible, filter, discoverEndpoint };
    root.XUDO_CATALOG = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
