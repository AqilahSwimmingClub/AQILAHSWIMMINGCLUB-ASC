# AQILAH Swimming Club — Aplikasi Android

Project utama ini sudah disiapkan sebagai aplikasi Android menggunakan Capacitor.
GitHub Actions akan membuat file APK secara otomatis dari source code yang sama dengan website.

## Penggunaan pertama di GitHub

1. Unggah seluruh isi project ini ke repository utama, lalu commit ke branch `main`.
2. Buka repository GitHub → **Settings** → **Secrets and variables** → **Actions**.
3. Tambahkan repository secrets berikut bila source memakai variabel environment:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Buka menu **Actions** → **Build Android APK** → **Run workflow**.
5. Setelah proses selesai, buka hasil workflow dan download artifact:
   `AQILAH-SWIMMING-CLUB-ANDROID`.
6. Ekstrak artifact tersebut. File instalasinya bernama:
   `AQILAH-SWIMMING-CLUB.apk`.

Setiap perubahan yang di-push ke branch `main` akan membangun APK baru secara otomatis apabila file aplikasi berubah.

## Menjalankan melalui Android Studio

Jalankan perintah berikut dari CMD di folder project:

```bash
npm install
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

Perintah `npx cap add android` hanya dijalankan satu kali jika folder `android` belum tersedia.
Untuk pembaruan berikutnya cukup:

```bash
npm run android:sync
npm run android:open
```

## Catatan keamanan

APK dari workflow ini adalah APK debug yang dapat dipasang untuk pengujian internal.
Untuk publikasi Google Play, buat Android App Bundle (`.aab`) release dan simpan signing key secara aman.
