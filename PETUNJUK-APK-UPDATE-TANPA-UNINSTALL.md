# APK ASC: identitas signing baru, lalu pembaruan tanpa uninstall

## Aturan yang menentukan segalanya

Android memakai **tanda tangan APK sebagai identitas aplikasi**. APK hanya bisa
dipasang menimpa aplikasi yang sudah ada bila memenuhi tiga syarat:

1. `applicationId` sama: `com.aqilahswimmingclub.app`
2. **Ditandatangani kunci yang sama persis** dengan APK yang terpasang
3. `versionCode` lebih tinggi daripada yang terpasang

Kalau kuncinya berbeda, Android menolak dengan
`INSTALL_FAILED_UPDATE_INCOMPATIBLE` ("App not installed").

## Status saat ini: satu kali uninstall, lalu tidak pernah lagi

APK ASC yang lama ditandatangani lewat wizard Android Studio dengan keystore
yang berganti-ganti, dan keystore itu tidak tersimpan di mana pun. Karena itu
dibuat **satu identitas signing baru yang dipakai permanen**:

| | |
|---|---|
| Berkas | `asc-release.p12` |
| Format | PKCS12 |
| Alias | `asc-release` |
| Algoritma | RSA 4096, SHA256withRSA |
| Masa berlaku | 10.950 hari (sampai 2056) |
| Subjek | `CN=AQILAH Swimming Club, O=AQILAH Swimming Club, C=ID` |

Konsekuensinya, **sekali ini saja**:

- aplikasi ASC lama harus di-uninstall manual lebih dulu;
- data lokal aplikasi lama dapat ikut terhapus (cache, sesi login, dan data
  yang belum sempat tersinkron ke Supabase);
- data yang sudah tersinkron tetap aman dan muncul kembali setelah login.

**Setelah APK baru terpasang, seluruh pembaruan berikutnya dipasang langsung
menimpa — tanpa uninstall dan tanpa kehilangan data** — selama keystore yang
sama terus dipakai.

## Keystore: satu-satunya hal yang tidak boleh hilang

Keystore adalah identitas aplikasi **selamanya**. Simpan cadangan
`asc-release.p12` di minimal dua tempat terpisah. Kalau hilang, tidak ada cara
membuat APK pembaruan lagi dan semua pengguna harus uninstall sekali lagi.

**Jangan pernah** memasukkan keystore, kata sandi, alias, atau token ke git,
log, atau GitHub Release. `.gitignore` sudah memblokir `*.p12`, `*.jks`,
`*.keystore`, dan `android/keystore.properties`.

Keystore ini **tidak boleh dibuat ulang atau diganti** pada pembaruan
berikutnya.

## Merilis lewat GitHub Actions

### 1. Isi GitHub Secrets

Buka **Settings → Secrets and variables → Actions → New repository secret**,
lalu buat lima secret berikut:

| Secret | Isi |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | seluruh isi berkas base64 keystore, satu baris |
| `ANDROID_KEYSTORE_PASSWORD` | kata sandi keystore |
| `ANDROID_KEY_ALIAS` | `asc-release` |
| `ANDROID_KEY_PASSWORD` | kata sandi kunci |
| `ASC_CERT_SHA256_CURRENT` | sidik jari SHA-256 sertifikat keystore |

Membuat base64 keystore sendiri di Windows:

```
certutil -encode android\asc-release.p12 keystore.b64
```

Buang baris `-----BEGIN/END CERTIFICATE-----` dan gabungkan sisanya menjadi
satu baris.

Membaca sidik jari sertifikat keystore:

```
keytool -list -v -keystore android\asc-release.p12 -storetype PKCS12
```

Sidik jari sertifikat **bukan rahasia** — nilainya tercetak di setiap APK.

### 2. Jalankan workflow

**Actions → Uji dan Bangun APK → Run workflow**, pada branch `main`:

- `jenis_rilis` = `instalasi_baru` untuk rilis pertama dengan kunci baru
- `jenis_rilis` = `pembaruan` untuk seluruh rilis sesudahnya
- `buat_release` = dicentang

GitHub Release hanya dibuat bila **semua** syarat ini terpenuhi: event
`workflow_dispatch`, branch `main`, `buat_release` dicentang, seluruh tes
hijau, secret penandatanganan lengkap, sidik jari APK cocok dengan
`ASC_CERT_SHA256_CURRENT`, versionCode memenuhi batas, dan APK lolos
`apksigner`. Push biasa dan branch kerja tidak pernah menghasilkan Release.

**APK debug dari workflow bukan APK pembaruan.** Artifact-nya dinamai
`DEBUG-UJI-SAJA` karena ditandatangani kunci debug.

## Merilis dari komputer Windows

### Kalau keystore belum ada di komputer ini

Klik dua kali **`BUAT-KEYSTORE-BARU.bat`**. Skrip meminta kata sandi,
membuat `android\asc-release.p12` sesuai spesifikasi di atas, menulis
`android\keystore.properties`, dan menampilkan sidik jari sertifikatnya.
Skrip **menolak menimpa** keystore yang sudah ada.

Jangan jalankan berkas ini kalau keystore ASC sudah ada — keystore lain
berarti identitas aplikasi berganti lagi dan semua pengguna harus uninstall.

### Membuat APK

1. Salin `asc-release.p12` ke folder `android\`.
2. Salin `android\keystore.properties.contoh` menjadi
   `android\keystore.properties`, isi `storePassword` dan `keyPassword`.
3. Klik dua kali **`BUAT-APK-UPDATE.bat`**.

Sekali jalan skrip itu mengambil kode terbaru dari `main`, menjalankan seluruh
pengujian, membangun web, `npx cap sync android`, `gradlew assembleRelease`,
lalu memverifikasi APK: applicationId, tanda tangan, `versionCode`, dan
`minSdk`. Kalau ada APK lama di folder `APK-LAMA/`, sertifikatnya dibandingkan.
Hasil ada di `HASIL-APK-UPDATE/` beserta berkas `.sha256`.

### Memeriksa APK secara terpisah

```
node scripts/verifikasi-apk.cjs --apk <baru.apk> [--apk-lama <lama.apk>]
                                [--mode instalasi_baru|pembaruan]
```

Kode keluar: `0` memenuhi syarat, `2` sah tetapi acuan tidak tersedia,
`1` tidak memenuhi syarat.

Membaca identitas APK lama: klik `BACA-SIDIK-JARI-APK-LAMA.bat`.

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
