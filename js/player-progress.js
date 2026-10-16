// Playback progress is local to this browser and separate for every TV episode.
(function () {
    'use strict';

    const STORAGE_KEY = 'xudo_vidsrc_progress_v1';
    // Keep the embed URL and trusted message origin together. Never accept
    // sibling subdomains or the previous provider host for the custom player.
    const ORIGIN = 'https://player.xudomovie.us';
    // Final server order: VidSrc, VidLink, VidFast, VidCore, VidKing, 2Embed.
    const ORIGINS = { 1: ORIGIN, 2: 'https://vidlink.pro', 3: 'https://vidfast.vc' };
    const supports = server => Object.hasOwn(ORIGINS, server);
    const MAX_ENTRIES = 200;
    const SOUND_KEY = 'xudo_vidsrc_sound_v1';
    let sessionSoundPreference;

    function getSoundPreference() {
        if (sessionSoundPreference) return sessionSoundPreference;
        try {
            const value = localStorage.getItem(SOUND_KEY);
            return ['on', 'off'].includes(value) ? value : 'auto';
        } catch (_) { return 'auto'; }
    }

    function setSoundPreference(value) {
        if (!['auto', 'on', 'off'].includes(value)) return false;
        sessionSoundPreference = value;
        try { localStorage.setItem(SOUND_KEY, value); return true; }
        catch (_) { return false; }
    }

    function isPlayerMessage(event, active) {
        return !!active?.frame?.contentWindow && event.origin === ORIGINS[active.server || 1] && event.source === active.frame.contentWindow;
    }

    function applySoundPreference(active) {
        const preference = getSoundPreference();
        if (!active?.frame?.contentWindow || (active.server || 1) !== 1 || preference === 'auto') return;
        // VidSrc's current player accepts these commands through its iframe
        // relay. This is best effort: browser autoplay policy still applies.
        active.frame.contentWindow.postMessage({ player: true, action: preference === 'on' ? 'unmute' : 'mute' }, ORIGIN);
    }

    function key(content) {
        if (!content || !['movie', 'tv'].includes(content.type) || !/^\d+$/.test(String(content.id))) return null;
        if (content.type === 'movie') return `movie:${content.id}`;
        if (!Number.isInteger(Number(content.season)) || Number(content.season) < 1 ||
            !Number.isInteger(Number(content.episode)) || Number(content.episode) < 1) return null;
        return `tv:${content.id}:${Number(content.season)}:${Number(content.episode)}`;
    }

    function readStore() {
        try {
            const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        } catch (_) { return {}; }
    }

    function validPosition(record) {
        return record && typeof record.position === 'number' && Number.isFinite(record.position) && record.position >= 0 &&
            typeof record.duration === 'number' && Number.isFinite(record.duration) && record.duration > 0 &&
            record.position <= record.duration;
    }

    function get(content) {
        const recordKey = key(content);
        if (!recordKey) return null;
        const record = readStore()[recordKey];
        return validPosition(record) ? record : null;
    }

    function save(content, position, duration, status) {
        const recordKey = key(content);
        if (!recordKey || !validPosition({ position, duration }) ||
            !['playing', 'paused', 'seeked', 'completed'].includes(status)) return null;
        const record = {
            position, duration,
            completed: status === 'completed' || (duration > 30 && duration - position <= 10),
            updatedAt: Date.now(),
        };
        const store = readStore();
        store[recordKey] = record;
        const entries = Object.entries(store).sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0));
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, MAX_ENTRIES))));
            return record;
        } catch (_) { return null; }
    }

    function remove(content) {
        const recordKey = key(content);
        if (!recordKey) return;
        const store = readStore();
        delete store[recordKey];
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch (_) {}
    }

    function clear() {
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    }

    function subtitleLanguages(language) {
        if (language === 'tl-PH') return 'tl,fil,en';
        const code = String(language || '').split('-')[0].toLowerCase();
        const supported = ['ar', 'bn', 'en', 'fr', 'hi', 'id', 'ja', 'km', 'ko', 'ms', 'pt', 'ru', 'es', 'th', 'tr', 'vi', 'zh'];
        return !supported.includes(code) || code === 'en' ? 'en' : `${code},en`;
    }

    function buildUrl(content, language, server = 1) {
        const record = get(content);
        const position = record && !record.completed ? Math.floor(record.position) : 0;
        // VidLink's JW mode applies startAt only above one second; VidFast and
        // VidSrc need a positive reset value to bypass their native history.
        if (server === 2 || server === 3) {
            const query = new URLSearchParams(server === 2
                ? { autoplay: 'true', player: 'jw', startAt: String(Math.max(position, 1.01)) }
                : { autoPlay: 'true', theme: 'e50914', sub: subtitleLanguages(language).split(',')[0], startAt: String(position || 0.01) });
            const route = content.type === 'tv'
                ? `tv/${content.id}/${content.season}/${content.episode}` : `movie/${content.id}`;
            if (server === 2 && content.type === 'tv') query.set('nextbutton', 'true');
            return `${ORIGINS[server]}/${route}?${query}`;
        }
        const query = new URLSearchParams({ autoplay: '1', ds_lang: subtitleLanguages(language), startAt: String(position || 0.01) });
        const route = content.type === 'tv'
            ? `tv/${content.id}/${content.season}/${content.episode}` : `movie/${content.id}`;
        return `${ORIGIN}/embed/${route}?${query}`;
    }

    function readEvent(event, active, imdbId) {
        // Only the currently mounted trusted player may update this title's data.
        if (!isPlayerMessage(event, active)) return null;
        let message = event.data;
        if (typeof message === 'string') {
            try { message = JSON.parse(message); } catch (_) { return null; }
        }
        const server = active.server || 1;
        if (server !== 1) return readProviderEvent(message, active);
        if (!message || message.type !== 'PLAYER_EVENT' || !message.data || typeof message.data !== 'object') return null;
        const { player_info: info, player_status: status, player_progress: position, player_duration: duration } = message.data;
        if (!info || info.mediaType !== active.type) return null;
        if (info.tmdb != null) {
            if (String(info.tmdb) !== String(active.id)) return null;
        } else if (!imdbId || info.imdb !== imdbId) return null;
        if (active.type === 'tv' && (Number(info.season) !== active.season || Number(info.episode) !== active.episode)) return null;
        if (!validPosition({ position, duration }) || !['playing', 'paused', 'seeked', 'completed'].includes(status)) return null;
        return { position, duration, status };
    }

    function readProviderEvent(message, active) {
        if (!message || typeof message !== 'object') return null;
        if (message.type === 'MEDIA_DATA') {
            const media = message.data;
            if (!media || typeof media !== 'object') return null;
            // Select only the active title, never import the player's entire history.
            const item = media[`${active.type === 'tv' ? 't' : 'm'}${active.id}`] || media[String(active.id)];
            if (!item || String(item.id) !== String(active.id) || item.type !== active.type) return null;
            const record = active.type === 'tv'
                ? item.show_progress?.[`s${active.season}e${active.episode}`] : item;
            if (active.type === 'tv' && (!record || Number(item.last_season_watched) !== active.season ||
                Number(item.last_episode_watched) !== active.episode || Number(record.season) !== active.season ||
                Number(record.episode) !== active.episode)) return null;
            const position = record?.progress?.watched, duration = record?.progress?.duration;
            return validPosition({ position, duration }) ? { position, duration, status: 'playing' } : null;
        }
        if (message.type !== 'PLAYER_EVENT' || !message.data || typeof message.data !== 'object') return null;
        const data = message.data;
        const id = data.tmdbId ?? data.mtmdbId;
        if (String(id) !== String(active.id) || data.mediaType !== active.type) return null;
        if (active.type === 'tv' && (Number(data.season) !== active.season || Number(data.episode) !== active.episode)) return null;
        const statuses = { play: 'playing', timeupdate: 'playing', pause: 'paused', seeked: 'seeked', ended: 'completed' };
        const status = statuses[data.event];
        const position = data.currentTime, duration = data.duration;
        return status && validPosition({ position, duration }) ? { position, duration, status } : null;
    }

    function formatTime(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0));
        const hours = Math.floor(total / 3600);
        const minutes = String(Math.floor(total / 60) % 60).padStart(2, '0');
        const rest = String(total % 60).padStart(2, '0');
        return hours ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
    }

    window.XUDO_PLAYBACK = { key, get, save, remove, clear, subtitleLanguages, buildUrl, readEvent, formatTime,
        getSoundPreference, setSoundPreference, isPlayerMessage, applySoundPreference, supports };
})();
