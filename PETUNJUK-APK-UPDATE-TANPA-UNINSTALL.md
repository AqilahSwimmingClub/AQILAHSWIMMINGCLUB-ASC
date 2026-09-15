# APK Pembaruan, Bukan Uninstall

## Aturan yang menentukan segalanya

Android memakai **tanda tangan APK sebagai identitas aplikasi**. APK baru hanya
bisa dipasang menimpa aplikasi yang sudah ada bila memenuhi tiga syarat:

1. `applicationId` sama: `com.aqilahswimmingclub.app`
2. **Ditandatangani kunci yang sama persis** dengan APK yang terpasang sekarang
3. `versionCode` lebih tinggi daripada yang terpasang

Kalau kuncinya berbeda, Android menolak dengan
`INSTALL_FAILED_UPDATE_INCOMPATIBLE` ("App not installed"), dan satu-satunya
jalan adalah uninstall — yang **menghapus seluruh data aplikasi**.

Karena itu proyek ini tidak pernah lagi membuat keystore baru secara otomatis.

## Cara membuat APK pembaruan

### 1. Siapkan keystore lama

`android/keystore.properties` harus menunjuk ke keystore yang dipakai membuat
APK yang sekarang terpasang di HP. Berkas itu tidak ikut masuk git karena
berisi kata sandi.

Salin `android/keystore.properties.contoh` menjadi `android/keystore.properties`
lalu isi:

```
storeFile=asc-release.jks
storePassword=...
keyAlias=asc
keyPassword=...
```

`storeFile` ditulis relatif terhadap folder `android/`.

**Di mana mencari keystore lama:**

- folder `android/` di proyek ini, mis. `android/asc-release.jks`
- cadangan proyek lama, flashdisk, Google Drive, atau email
- `%USERPROFILE%\.android\debug.keystore` — bila APK lama dulu dipasang
  langsung dari Android Studio memakai build debug. Kata sandinya baku:
  store `android`, alias `androiddebugkey`, key `android`.

### 2. Taruh APK lama sebagai pembanding, lalu baca sidik jarinya

Salin APK yang dipakai memasang aplikasi di HP ke folder `APK-LAMA/`.
Skrip akan membandingkan sertifikat APK baru dengan APK itu. Tanpa berkas ini
APK tetap dibuat, tetapi **tidak akan disebut APK pembaruan** karena kesamaan
tanda tangan belum terbukti.

Lalu klik dua kali **`BACA-SIDIK-JARI-APK-LAMA.bat`**. Berkas itu hanya membaca,
tidak mengubah apa pun, dan menampilkan:

- `applicationId`, `versionCode`, `versionName`, `minSdk`, `targetSdk`
- subjek sertifikat dan **jenis kuncinya: debug atau rilis**
- sidik jari SHA-256 sertifikat

Jenis kunci itulah yang memberi tahu keystore mana yang harus dicari. Bila
hasilnya **debug**, keystore-nya ada di `%USERPROFILE%\.android\debug.keystore`
dengan kata sandi baku (store `android`, alias `androiddebugkey`, key
`android`). Bila hasilnya **rilis**, yang dicari adalah berkas `.jks` atau
`.keystore` dengan subjek yang sama.

### 3. Jalankan satu berkas

Klik dua kali **`BUAT-APK-UPDATE.bat`**. Sekali jalan skrip itu:

1. memeriksa Node, Git, dan Android SDK
2. memastikan keystore lama ada — berhenti bila tidak ada
3. mengambil kode terbaru dari `main`
4. menjalankan seluruh pengujian
5. menaikkan `versionCode`
6. `npm run build` dan `npx cap sync android`
7. `gradlew assembleRelease`
8. memverifikasi APK: applicationId, tanda tangan, `versionCode`, `minSdk`
9. membandingkan sertifikat dengan APK lama

Hasilnya ada di `HASIL-APK-UPDATE/` beserta berkas `.sha256`.

### 4. Pasang di HP

Salin APK ke HP, buka, pilih Pasang. **Jangan uninstall aplikasi lama.**
Data aplikasi, sesi login, dan cache tetap dipertahankan.

## Memeriksa APK secara terpisah

```
node scripts/verifikasi-apk.cjs --apk <baru.apk> --apk-lama <lama.apk>
```

Kode keluar: `0` terbukti dapat memperbarui, `2` sah tetapi acuan APK lama tidak
ada, `1` tidak memenuhi syarat.

## Lewat GitHub Actions

Workflow `.github/workflows/build-apk.yml` membuat APK release bertanda tangan
bila secret berikut tersedia:

| Secret | Isi |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | keystore `.jks` dalam base64 |
| `ANDROID_KEYSTORE_PASSWORD` | kata sandi keystore |
| `ANDROID_KEY_ALIAS` | alias kunci |
| `ANDROID_KEY_PASSWORD` | kata sandi kunci |
| `ASC_CERT_SHA256_LAMA` | sidik jari SHA-256 sertifikat APK lama |
| `ASC_VERSION_CODE_LAMA` | `versionCode` APK lama (opsional, agar kenaikan versi ikut diperiksa) |

Membuat base64 keystore di Windows:

```
certutil -encode android\asc-release.jks keystore.b64
```

Membaca sidik jari sertifikat APK lama — klik `BACA-SIDIK-JARI-APK-LAMA.bat`,
atau lewat perintah:

```
node scripts\baca-apk-lama.cjs
```

Sidik jari sertifikat **bukan rahasia** — nilainya tercetak di setiap APK.

APK release yang sudah terbukti sebagai pembaruan otomatis dijadikan GitHub
Release, supaya tidak ikut hilang ketika artifact kedaluwarsa.

**APK debug dari workflow bukan APK pembaruan.** Artifact-nya dinamai
`DEBUG-UJI-SAJA` karena ditandatangani kunci debug dan tidak dapat menimpa
aplikasi yang terpasang.

## Dukungan Android

| | |
|---|---|
| `minSdk` | 29 — Android 10 |
| `targetSdk` | 35 — Android 15 |
| `compileSdk` | 35 |

Mendukung Android 10, 11, 12, 13, 14, 15, dan versi setelahnya. Tidak ada
dependensi yang menaikkan syarat minimum di atas API 29.

## Sebagian besar perubahan TIDAK butuh APK baru

`capacitor.config.json` mengarahkan aplikasi ke
`https://aqilahswimmingclub.vercel.app`. Aplikasi Android adalah cangkang yang
memuat website live, jadi perbaikan tampilan, logika, dan bug sampai ke HP
begitu Vercel selesai deploy — cukup tutup paksa aplikasi lalu buka lagi.

APK baru hanya perlu dibuat untuk perubahan native: ikon, nama aplikasi, izin,
konfigurasi Firebase, atau `minSdk`.

## Peringatan

Keystore adalah identitas aplikasi **selamanya**. Simpan cadangannya di tempat
aman. Kalau hilang, tidak ada cara membuat APK pembaruan lagi — semua pengguna
harus uninstall dan kehilangan datanya.
