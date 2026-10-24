# Short Drama — konfigurasi teknis

## Menjalankan server lokal

```sh
npm install
npm run dev -- --port=8793
```

- Beranda: `http://localhost:8793/#sec-short-drama`
- Pencarian: `http://localhost:8793/?search=Captain`
- Pemutar: `http://localhost:8793/watch.html?type=shortdrama&id=117426&e=1`

Konfigurasi lokal menggunakan `.dev.vars`. TMDB menggunakan `TMDB_API_KEY`. Endpoint DramaTap menggunakan akses publik.

`DRAMATAP_ORIGIN` menetapkan origin HTTPS untuk adapter DramaTap; nilai defaultnya `https://dramatap.app`. Format nilai: `https://hostname`, dengan path `/` serta query dan kredensial kosong.

## Endpoint

| GET endpoint | Parameter | Sumber |
| --- | --- | --- |
| `/api/shortdrama/catalog` | `feed=trending\|latest`, `page` opsional (1–50, hanya `latest`) | HTML `/` (`.grid-home`, `.grid-new`); dengan `page`: `/new`, `/new/{page}` |
| `/api/shortdrama/search` | `q`, panjang 1–100 karakter | JSON `/api/search` |
| `/api/shortdrama/detail` | `id`, bilangan bulat positif | HTML `/d/{id}`, selector `#ssr-drama` |
| `/api/shortdrama/episodes` | `id`, bilangan bulat positif | JSON `/api/episodes` |

Parameter `provider` menggunakan nilai `dramatap`. Metadata memiliki TTL 300 detik; respons episode menggunakan `Cache-Control: no-store`. Timeout permintaan upstream adalah 10 detik. Adapter memvalidasi URL media HTTPS dan redirect detail pada origin yang dikonfigurasi.

Implementasi adapter berada di `functions/_lib/shortdrama.js`. Dispatcher berada di `functions/api/shortdrama/[[path]].js`. Parsing HTML menggunakan `parse5` dan menghasilkan judul, ID, poster, jumlah episode, serta sinopsis.

## Integrasi antarmuka

`js/short-serial.js` memasang katalog di `#sec-short-drama` pada beranda. Heading menggunakan `.section-heading` yang sama dengan kategori lain. Baris menampilkan feed trending; heading dan View More membuka `browse.html?type=shortdrama` dengan tab Trending/Latest (`&feed=latest`) dalam grid yang sama dengan kategori lain. Latest berpaginasi (Load More memakai `page`; respons membawa `hasMore`); Trending hanya satu halaman (±12 judul) karena DramaTap tidak menyediakan halaman berikutnya untuk daftar itu.

Pencarian global di `js/main.js` mengirim permintaan TMDB dan DramaTap secara bersamaan. Autocomplete dan grid pencarian menggabungkan kedua sumber dengan identitas berdasarkan provider dan jenis media. Pergantian query membatalkan permintaan sebelumnya. Status kegagalan per sumber ditampilkan bersama hasil yang tersedia.

DramaTap menyumbangkan kumpulan hasil pertama pada setiap query. Load More mengambil halaman TMDB berikutnya. Pengurutan bekerja pada gabungan hasil yang telah dimuat.

Kartu DramaTap membuka `watch.html?type=shortdrama&id={id}&e={episode}`. `shortdrama.html` hanya berisi pengalihan untuk link lama: `id` ke pemutar, `q` ke pencarian global, lainnya ke baris beranda. Alur YouTube sudah dihapus.

## Favorit dan Lanjutkan Menonton

Kartu DramaTap memiliki tombol favorit yang sama dengan kartu film/TV. Favorit disimpan di `xudo_favs` dengan `type: 'shortdrama'`; pencocokan memakai ID dan jenis, sehingga ID DramaTap tidak bentrok dengan ID TMDB. Progres tersimpan di `xudo_history` (satu entri per serial): posisi disimpan tiap 5 detik, saat jeda, dan saat meninggalkan halaman. Setelah sebuah episode selesai, entri menunjuk ke episode berikutnya. Membuka link dengan episode yang sama melanjutkan dari posisi tersimpan.

## Pemutaran

Alur DramaTap di `watch.html` menggunakan `player-container`, `control-bar`, `tv-controls`, `episodes-grid`, metadata, berbagi, dan rekomendasi. Jenis movie/tv menggunakan alur pemutar yang sesuai dengan jenisnya.

Daftar episode berisi URL HLS. Browser Apple menggunakan HLS native jika tersedia; browser lain menggunakan hls.js/MSE. Kontrol menyediakan episode sebelumnya/berikutnya, auto-next, dan pemuatan ulang sumber. Parameter `e` menyimpan episode terpilih pada URL. Keluar dari halaman membersihkan sesi HLS dan sumber video.

Episode dengan URL kosong ditampilkan dengan status sumber tidak tersedia, sesuai nomor episode upstream. Label kontrol tersedia dalam bahasa Indonesia dan Inggris; bahasa lain menggunakan fallback Inggris.

## Pemeriksaan dan deployment

```sh
npm test
npx wrangler pages functions build --outdir=dist-functions
./deploy.sh
```

`deploy.sh` menyalin aset dan Pages Functions ke `dist/`, memvalidasi kumpulan file, kemudian mengunggah direktori tersebut ke Cloudflare Pages.

## Dependensi dan referensi

- `parse5` 8.0.1: parser HTML adapter, dibundel oleh Wrangler.
- hls.js 1.7.3: `js/vendor/hls.light.min.js`, lisensi di `js/vendor/hls.LICENSE`.
- Origin: <https://dramatap.app/>
- Contoh pencarian: <https://dramatap.app/api/search?q=Captain%20Marrying>
- Contoh episode: <https://dramatap.app/api/episodes?id=117426>
