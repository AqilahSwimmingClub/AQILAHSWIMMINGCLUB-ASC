// Memastikan aplikasi Android tetap mendukung Android 10 (API 29) ke atas.
//
// Nilai minSdk proyek ini ditulis langsung di android/app/build.gradle, bukan di
// android/variables.gradle. Versi lama skrip ini selalu keluar dengan galat
// karena variables.gradle memang tidak pernah ada, sehingga `npm run
// android:update` tidak pernah bisa selesai. Sekarang kedua bentuk didukung dan
// nilainya diverifikasi, bukan sekadar ditulis.
const fs = require('fs');
const path = require('path');

const MIN_SDK = 29; // API 29 = Android 10
const akar = process.cwd();
const variables = path.join(akar, 'android', 'variables.gradle');
const appGradle = path.join(akar, 'android', 'app', 'build.gradle');

if (!fs.existsSync(appGradle)) {
  console.error('Folder Android belum dibuat. Jalankan: npx cap add android');
  process.exit(1);
}

let berubah = false;

// Bentuk lama: android/variables.gradle memuat minSdkVersion.
if (fs.existsSync(variables)) {
  const teks = fs.readFileSync(variables, 'utf8');
  if (/minSdkVersion\s*=\s*\d+/.test(teks)) {
    const baru = teks.replace(/minSdkVersion\s*=\s*\d+/, `minSdkVersion = ${MIN_SDK}`);
    if (baru !== teks) {
      fs.writeFileSync(variables, baru, 'utf8');
      berubah = true;
    }
    console.log(`android/variables.gradle: minSdkVersion = ${MIN_SDK}`);
  }
}

// Bentuk yang dipakai proyek ini: nilai minSdk di android/app/build.gradle.
const teksApp = fs.readFileSync(appGradle, 'utf8');
const cocok = teksApp.match(/minSdk\s+(\d+)/);
if (!cocok) {
  console.error('minSdk tidak ditemukan di android/app/build.gradle.');
  process.exit(1);
}
const nilai = Number(cocok[1]);
if (nilai !== MIN_SDK) {
  const baru = teksApp.replace(/minSdk\s+\d+/, `minSdk ${MIN_SDK}`);
  fs.writeFileSync(appGradle, baru, 'utf8');
  berubah = true;
  console.log(`android/app/build.gradle: minSdk ${nilai} -> ${MIN_SDK}`);
} else {
  console.log(`android/app/build.gradle: minSdk sudah ${MIN_SDK}`);
}

console.log(
  berubah
    ? `Minimum SDK ditetapkan ke API ${MIN_SDK} (Android 10).`
    : `Minimum SDK sudah API ${MIN_SDK} (Android 10). Tidak ada yang diubah.`
);
