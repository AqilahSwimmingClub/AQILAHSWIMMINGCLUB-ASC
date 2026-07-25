const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'android', 'variables.gradle');
if (!fs.existsSync(file)) {
  console.error('Folder Android belum dibuat. Jalankan npx cap add android terlebih dahulu.');
  process.exit(1);
}

let text = fs.readFileSync(file, 'utf8');
if (/minSdkVersion\s*=\s*\d+/.test(text)) {
  text = text.replace(/minSdkVersion\s*=\s*\d+/, 'minSdkVersion = 29');
} else {
  console.error('minSdkVersion tidak ditemukan di android/variables.gradle.');
  process.exit(1);
}
fs.writeFileSync(file, text, 'utf8');
console.log('Android minimum SDK berhasil ditetapkan ke API 29 (Android 10).');
