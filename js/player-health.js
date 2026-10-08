// VidLink reports playback through postMessage; iframe load is not playback.
(function () {
    'use strict';
    let active;
    const copy = {
        'en-US': ['Playback has not been confirmed. Press Play in the player, or try another server.', 'The video source failed to load. Try again or choose another server.', 'Try again', 'Try server {server}', 'If the video does not start, press Play inside the player or try another server.', 'If playback fails, try a different source from the Servers menu inside the player, or try another server below.', 'This provider may request verification before playback. Complete it in the player, or choose another server.'],
        'id-ID': ['Pemutaran belum terkonfirmasi. Tekan Play di player, atau coba server lain.', 'Sumber video gagal dimuat. Coba ulang atau pilih server lain.', 'Coba ulang', 'Coba Server {server}', 'Jika video belum berjalan, tekan Play di dalam player atau coba server lain.', 'Jika video gagal, pilih sumber lain melalui menu Servers di dalam player, atau coba server berikutnya di bawah.', 'Penyedia ini mungkin meminta verifikasi sebelum video diputar. Selesaikan di player, atau pilih server lain.'],
    };
    const words = () => copy[localStorage.getItem('xudo_lang')] || copy['en-US'];
    function clear() {
        if (!active) return;
        clearTimeout(active.timer);
        window.removeEventListener('message', active.listener);
        active = null;
        window._playerReadyTime = null;
        const panel = document.getElementById('player-health');
        if (panel) panel.hidden = true;
    }
    function begin(iframe, details) {
        clear();
        window._playerReadyTime = null;
        const panel = document.getElementById('player-health');
        const state = active = { ...details, iframe, confirmed: false, lastTime: null };
        const token = crypto.randomUUID();
        if (details.server === 1) {
            const fallback = new URL('player-fallback.html', window.location.href);
            fallback.searchParams.set('attempt', token);
            const src = new URL(iframe.src);
            src.searchParams.set('fallback_url', fallback.href);
            iframe.src = src.href;
        }
        function show(failed, manual = false) {
            if (active !== state || !panel) return;
            panel.hidden = false;
            panel.querySelector('[data-player-message]').textContent = words()[manual ? details.server === 4 ? 6 : [3, 5].includes(details.server) ? 5 : 4 : failed ? 1 : 0];
            const retry = panel.querySelector('[data-player-retry]');
            const next = panel.querySelector('[data-player-next]');
            retry.textContent = words()[2];
            retry.onclick = details.retry;
            next.textContent = words()[3].replace('{server}', details.nextServer || 2);
            next.onclick = details.next;
        }
        state.listener = function (event) {
            if (active !== state || event.source !== iframe.contentWindow) return;
            const message = event.data;
            if (event.origin === window.location.origin && message?.type === 'XUDO_PLAYER_FAILED' && message.attempt === token) {
                clearTimeout(state.timer);
                state.confirmed = false;
                window._playerReadyTime = null;
                show(true);
                details.track('player_source_failed');
                return;
            }
            const expectedOrigin = details.server === 1 ? 'https://vidlink.pro' : details.server === 2 ? 'https://vidsrc.sh' : null;
            if (!expectedOrigin || event.origin !== expectedOrigin || message?.type !== 'PLAYER_EVENT') return;
            let data = message.data;
            // VidSrc documents a different progress payload than VidLink.
            if (details.server === 2) {
                if (!data || !['playing', 'paused', 'completed', 'seeked'].includes(data.player_status)) return;
                const info = data.player_info;
                if (!info || String(info.tmdb) !== String(details.id)) return;
                data = {
                    event: data.player_status === 'playing' ? 'timeupdate' : data.player_status === 'seeked' ? 'seeked' : 'pause',
                    currentTime: data.player_progress, duration: data.player_duration,
                    mtmdbId: info.tmdb, mediaType: info.mediaType, season: info.season, episode: info.episode,
                };
            }
            // VidLink's documented field is mtmdbId (including its spelling).
            if (!data || !['play', 'pause', 'seeked', 'ended', 'timeupdate'].includes(data.event)) return;
            if (data.mtmdbId != null && String(data.mtmdbId) !== String(details.id)) return;
            if (data.mediaType != null && data.mediaType !== details.type) return;
            if (data.season != null && Number(data.season) !== details.season) return;
            if (data.episode != null && Number(data.episode) !== details.episode) return;
            if (data.event === 'seeked') { state.lastTime = null; return; }
            if (data.event !== 'timeupdate' || !Number.isFinite(data.currentTime) || !Number.isFinite(data.duration) || data.duration <= 0) return;
            const previous = state.lastTime;
            state.lastTime = data.currentTime;
            if (previous === null || data.currentTime <= previous || state.confirmed) return;
            state.confirmed = true;
            clearTimeout(state.timer);
            window._playerReadyTime = Date.now();
            if (panel) panel.hidden = true;
            details.track('player_playback_started');
        };
        window.addEventListener('message', state.listener);
        // Other providers have no verified event contract; do not guess readiness.
        if (details.server === 1 || details.server === 2) state.timer = setTimeout(() => {
            if (active === state && !state.confirmed) {
                show(false);
                details.track('player_playback_unconfirmed');
            }
        }, 30000);
        if (details.server >= 3) show(false, true);
        iframe.addEventListener('error', () => { if (active === state) show(true); }, { once: true });
    }
    window.XUDO_PLAYER_HEALTH = { begin, clear };
    window.addEventListener('pagehide', clear);
})();
