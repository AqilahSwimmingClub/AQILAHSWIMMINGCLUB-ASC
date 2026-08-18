// Menaikkan ascVersionCode di android/gradle.properties sebesar 1 dan
// menyesuaikan ascVersionName. Android hanya mau memasang APK sebagai UPDATE
// bila versionCode-nya lebih besar dari yang sudah terpasang; kalau angkanya
// tetap, pengguna terpaksa uninstall dulu.
const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '..', 'android', 'gradle.properties')
if (!fs.existsSync(file)) {
  console.error('android/gradle.properties tidak ditemukan.')
  process.exit(1)
}

const original = fs.readFileSync(file, 'utf8')
const eol = original.includes('\r\n') ? '\r\n' : '\n'

const readValue = key => {
  const match = original.match(new RegExp(`^${key}=(.*)$`, 'm'))
  return match ? match[1].trim() : ''
}

const currentCode = Number.parseInt(readValue('ascVersionCode'), 10)
if (!Number.isFinite(currentCode)) {
  console.error('ascVersionCode tidak terbaca di android/gradle.properties.')
  process.exit(1)
}
const nextCode = currentCode + 1

// Nama versi mengikuti pola x.y.z, bagian terakhir ikut naik.
const currentName = readValue('ascVersionName') || '1.0.0'
const parts = currentName.split('.')
const nextName = parts.length === 3 && Number.isFinite(Number.parseInt(parts[2], 10))
  ? `${parts[0]}.${parts[1]}.${Number.parseInt(parts[2], 10) + 1}`
  : currentName

let updated = original
  .replace(/^ascVersionCode=.*$/m, `ascVersionCode=${nextCode}`)
  .replace(/^ascVersionName=.*$/m, `ascVersionName=${nextName}`)

if (updated === original) {
  console.error('Tidak ada baris versi yang berhasil diperbarui.')
  process.exit(1)
}
if (!updated.endsWith(eol)) updated += eol

fs.writeFileSync(file, updated)
console.log(`versionCode ${currentCode} -> ${nextCode}, versionName ${currentName} -> ${nextName}`)
