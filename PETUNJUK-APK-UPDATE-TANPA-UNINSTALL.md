# APK Update, Bukan Uninstall

## Kenapa dulu selalu minta uninstall

Dua hal di `android/app/build.gradle`:

1. **Tidak ada `signingConfigs` sama sekali.** Setiap APK rilis ditandatangani
   lewat wizard Android Studio dengan keystore yang berbeda-beda. Android
   memperlakukan tanda tangan sebagai identitas aplikasi, jadi APK dengan kunci
   berbeda dianggap aplikasi lain dan ditolak dengan
   `INSTALL_FAILED_UPDATE_INCOMPATIBLE` ("App not installed").
2. **`versionCode 1` ditulis mati.** Angkanya tidak pernah naik, sehingga
   Android tidak melihat APK baru sebagai versi yang lebih baru.

## Yang sekarang berlaku

- Kunci penandatanganan tetap, dibaca dari `android/keystore.properties`.
- `versionCode` dan `versionName` diambil dari `android/gradle.properties` dan
  dinaikkan otomatis setiap kali membuat APK.
- `android/keystore.properties`, `*.jks`, dan `*.keystore` tidak ikut masuk git.

## Cara membuat APK

Klik dua kali **`BUAT-APK-UPDATE.bat`**. Sekali jalan, skrip itu:

1. Membuat keystore `android/asc-release.jks` bila belum ada (hanya sekali seumur proyek)
2. Menaikkan `versionCode`
3. `npm run build`
4. `npx cap sync android`
5. `gradlew assembleRelease`

Hasilnya: `android/app/build/outputs/apk/release/app-release.apk`

Pasang langsung menimpa aplikasi lama. Tidak perlu uninstall.

## Satu-satunya uninstall yang masih diperlukan

Aplikasi yang **sudah terpasang sekarang** ditandatangani dengan kunci lama.
Kunci baru tidak bisa menimpa kunci lama, apa pun caranya. Jadi khusus
perpindahan ini, aplikasi lama perlu dihapus **satu kali terakhir**, lalu pasang
APK baru. Setelah itu semua update berikutnya cukup ditimpa.

Kalau file keystore lama masih Anda simpan, arahkan saja
`android/keystore.properties` ke file itu, dan uninstall terakhir pun tidak perlu.

## Peringatan penting

`android/asc-release.jks` adalah identitas aplikasi selamanya. **Simpan
cadangannya di tempat aman.** Kalau file itu hilang, satu-satunya jalan untuk
update berikutnya adalah uninstall lagi.

## Sebagian besar perubahan tidak butuh APK baru

`capacitor.config.json` mengarahkan aplikasi ke `https://aqilahswimmingclub.vercel.app`.
Aplikasi Android hanya cangkang yang memuat website live. Perubahan tampilan,
logika, dan perbaikan bug sampai ke HP begitu Vercel selesai deploy — cukup tutup
paksa aplikasi lalu buka lagi.

APK baru hanya perlu dibuat untuk perubahan native: ikon, nama aplikasi, izin,
konfigurasi Firebase, atau `minSdk`.
