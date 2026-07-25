# AQILAH Swimming Club — Supabase

Aplikasi manajemen klub renang berbasis Vite dan JavaScript dengan sinkronisasi data melalui Supabase.

## Persiapan Supabase satu kali

1. Buka proyek Supabase Anda.
2. Masuk ke **SQL Editor**.
3. Buka file `SUPABASE-SETUP.sql` dari folder proyek ini.
4. Salin seluruh isinya, tempel ke SQL Editor, lalu klik **Run**.

Perintah tersebut membuat tabel `public.class_app_data`, mengaktifkan kebijakan baca/tulis, dan mengaktifkan Realtime.

## Menjalankan di komputer

Buka CMD pada folder proyek ini, lalu jalankan:

```bash
npm install
npm run dev
```

Untuk membuat versi produksi:

```bash
npm run build
```

Hasil build berada di folder `dist`.

## Konfigurasi

Project URL dan publishable key Supabase sudah dipasang pada source code dan `.env.example`:

```env
VITE_SUPABASE_URL=https://nykenupjktgmsotfzrjj.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_iTBUQUsAGiqqKK16KTOmxw_aS7ochfu
VITE_CLUB_ID=aqilah-swimming-club
```

Untuk Vercel, masukkan ketiga variabel tersebut pada **Settings → Environment Variables** lalu deploy ulang.

## Cara kerja sinkronisasi

- Setiap perubahan disimpan ke perangkat terlebih dahulu.
- Saat internet tersedia, data dikirim ke Supabase.
- Perangkat lain menerima pembaruan melalui Supabase Realtime.
- Semua fitur menggunakan satu sumber data yang sama, termasuk atlet, absensi, catatan waktu, program latihan, lomba, dan pembayaran.

## Catatan keamanan

Kebijakan pada `SUPABASE-SETUP.sql` dibuat terbuka agar seluruh operasi aplikasi langsung diterima sesuai kebutuhan saat ini. Setelah seluruh fitur selesai diuji, kebijakan sebaiknya diperketat menggunakan Supabase Auth dan hak akses berdasarkan peran.
