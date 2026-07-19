/**
 * XUDOMovie — Real-time Visitor Counter
 * Menggunakan Firebase Realtime Database dengan sistem "presence".
 *
 * Cara kerja:
 *  - Setiap pengunjung menulis session-nya ke Firebase saat halaman dibuka.
 *  - Firebase otomatis menghapus session tersebut saat pengunjung keluar
 *    (onDisconnect), bahkan jika tab ditutup paksa.
 *  - Counter menghitung jumlah session aktif secara real-time.
 *
 * Setup Firebase (lakukan sekali):
 *  1. Buka https://console.firebase.google.com
 *  2. Buat project baru → pilih "Realtime Database" → buat database
 *  3. Di Rules, set:
 *       { "rules": { "visitors": { ".read": true, ".write": true } } }
 *  4. Isi FIREBASE_CONFIG di bawah dengan config project Anda.
 */

// ─── KONFIGURASI — ganti dengan milik Anda ───────────────────────────────────
const FIREBASE_CONFIG = {
    apiKey            : "AIzaSyCXfLMhcKEuN7h8It9gD_LGJchusejyiZg",
    authDomain        : "xudomovie-counter.firebaseapp.com",
    databaseURL       : "https://xudomovie-counter-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId         : "xudomovie-counter",
    storageBucket     : "xudomovie-counter.firebasestorage.app",
    messagingSenderId : "309365596284",
    appId             : "1:309365596284:web:b3f479f7b8aac2468e69f9",
    measurementId     : "G-N7MS3445YS",
};
// ─────────────────────────────────────────────────────────────────────────────

(function initVisitorCounter() {

    const COUNTER_EL_ID = 'xudo-visitor-count';

    // Teks label per bahasa
    const VISITOR_LABELS = {
        'en-US' : 'visitors online now',
        'id-ID' : 'pengunjung online sekarang',
        'bn-BD' : 'এখন অনলাইন দর্শক',
        'vi-VN' : 'người đang trực tuyến',
        'km-KH' : 'អ្នកចូលមើលបច្ចុប្បន្ន',
        'th-TH' : 'ผู้เยี่ยมชมออนไลน์ขณะนี้',
        'ms-MY' : 'pelawat dalam talian sekarang',
        'tl-PH' : 'bisita online ngayon',
        'hi-IN' : 'अभी ऑनलाइन आगंतुक',
        'zh-CN' : '当前在线访客',
        'zh-TW' : '目前在線訪客',
        'ja-JP' : '現在のオンライン訪問者',
        'ko-KR' : '현재 온라인 방문자',
        'ar-SA' : 'زوار متصلون الآن',
        'pt-BR' : 'visitantes online agora',
        'es-ES' : 'visitantes en línea ahora',
        'fr-FR' : 'visiteurs en ligne maintenant',
        'tr-TR' : 'şu an çevrimiçi ziyaretçi',
        'ru-RU' : 'посетителей онлайн сейчас',
    };

    const lang  = localStorage.getItem('xudo_lang') || 'en-US';
    const label = VISITOR_LABELS[lang] || VISITOR_LABELS['en-US'];

    // Cek apakah sudah dikonfigurasi
    if (!FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey.startsWith('GANTI')) {
        console.warn('[XUDOMovie] Visitor counter: Firebase belum dikonfigurasi.');
        return;
    }

    // Load Firebase SDK secara dinamis (tidak memblokir render halaman)
    function loadScript(src, onLoad) {
        const s  = document.createElement('script');
        s.src    = src;
        s.async  = true;
        s.onload = onLoad;
        document.head.appendChild(s);
    }

    function startPresence() {
        const firebase = window.firebase;
        if (!firebase) return;

        // Inisialisasi Firebase (hanya sekali)
        if (!firebase.apps.length) {
            firebase.initializeApp(FIREBASE_CONFIG);
        }

        const db          = firebase.database();
        const visitorsRef = db.ref('visitors');
        const connRef     = db.ref('.info/connected');

        // Generate session ID unik per tab
        let sessionId = sessionStorage.getItem('xudo_session_id');
        if (!sessionId) {
            sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
            sessionStorage.setItem('xudo_session_id', sessionId);
        }

        const myRef = visitorsRef.child(sessionId);

        // Saat terkoneksi ke Firebase:
        connRef.on('value', snap => {
            if (!snap.val()) return;   // offline
            // Tulis kehadiran & daftarkan penghapusan otomatis saat disconnect
            myRef.onDisconnect().remove();
            myRef.set({ ts: firebase.database.ServerValue.TIMESTAMP });
        });

        // Dengarkan perubahan jumlah pengunjung secara real-time
        visitorsRef.on('value', snap => {
            const count = snap.numChildren();
            updateDisplay(count);
        });
    }

    function updateDisplay(count) {
        const el = document.getElementById(COUNTER_EL_ID);
        if (!el) return;
        const formatted = count.toLocaleString();
        // .visitor-label dibungkus span agar bisa disembunyikan via CSS di ≤480px
        el.innerHTML = `
            <span class="visitor-dot"></span>
            <strong>${formatted}</strong><span class="visitor-label">&nbsp;${label}</span>
        `;
        el.style.display = 'flex';  // CSS sudah atur posisi (bottom/right/height) per breakpoint
    }

    // Muat Firebase SDK, lalu jalankan presence tracking
    loadScript(
        'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
        () => loadScript(
            'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js',
            startPresence
        )
    );

})();
