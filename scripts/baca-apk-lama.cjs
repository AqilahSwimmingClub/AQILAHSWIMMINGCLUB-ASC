#!/usr/bin/env node
'use strict'

// ---------------------------------------------------------------------------
//  Membaca identitas dan sidik jari sertifikat APK LAMA — APK yang dipakai
//  memasang aplikasi ASC yang sekarang ada di HP.
//
//  Nilai-nilai inilah yang menentukan apakah APK baru dapat dipasang menimpa
//  aplikasi lama tanpa uninstall. Sidik jari sertifikat BUKAN rahasia: nilainya
//  tercetak di dalam setiap APK dan aman disalin ke GitHub Secrets sebagai
//  ASC_CERT_SHA256_LAMA.
//
//  Pemakaian:
//    node scripts/baca-apk-lama.cjs                  (memindai folder APK-LAMA/)
//    node scripts/baca-apk-lama.cjs <berkas.apk>
// ---------------------------------------------------------------------------

const { existsSync, readdirSync, statSync } = require('node:fs')
const { join } = require('node:path')
const alat = require('./lib/apk-tools.cjs')

const NAMA_ANDROID = {
  29: 'Android 10', 30: 'Android 11', 31: 'Android 12', 32: 'Android 12L',
  33: 'Android 13', 34: 'Android 14', 35: 'Android 15', 36: 'Android 16'
}

function versiAndroid(sdk) {
  const n = Number(sdk)
  return NAMA_ANDROID[n] ? `${sdk} (${NAMA_ANDROID[n]})` : String(sdk || '?')
}

// APK terbaru di dalam folder, supaya pengguna cukup menaruh berkasnya di sana.
function apkTerbaru(folder) {
  if (!existsSync(folder)) return ''
  const daftar = readdirSync(folder)
    .filter(n => n.toLowerCase().endsWith('.apk'))
    .map(n => ({ n, waktu: statSync(join(folder, n)).mtimeMs }))
    .sort((a, b) => b.waktu - a.waktu)
  return daftar.length ? join(folder, daftar[0].n) : ''
}

function main() {
  const diminta = process.argv[2]
  const apk = diminta || apkTerbaru('APK-LAMA')

  if (!apk) {
    console.error('APK lama tidak ditemukan.')
    console.error('')
    console.error('Salin APK yang dipakai memasang aplikasi ASC di HP ke folder APK-LAMA/,')
    console.error('lalu jalankan ulang. Atau sebutkan berkasnya:')
    console.error('  node scripts/baca-apk-lama.cjs <berkas.apk>')
    process.exit(1)
  }
  if (!existsSync(apk)) {
    console.error(`Berkas tidak ada: ${apk}`)
    process.exit(1)
  }

  console.log('============================================================')
  console.log(' IDENTITAS APK LAMA')
  console.log('============================================================')
  console.log(`Berkas        : ${apk}`)

  const id = alat.bacaIdentitas(apk)
  console.log(`applicationId : ${id.applicationId || '(tidak terbaca)'}`)
  console.log(`versionCode   : ${id.versionCode || '(tidak terbaca)'}`)
  console.log(`versionName   : ${id.versionName || '(tidak terbaca)'}`)
  console.log(`minSdk        : ${versiAndroid(id.minSdk)}`)
  console.log(`targetSdk     : ${versiAndroid(id.targetSdk)}`)

  const cert = alat.bacaSertifikat(apk)
  console.log('')
  if (!cert.tersedia) {
    console.log(`Sertifikat    : TIDAK DAPAT DIBACA — ${cert.alasan}`)
    console.log('')
    console.log('Pasang Android SDK build-tools supaya apksigner tersedia.')
    process.exit(1)
  }
  if (!cert.sah || !cert.sidikJari) {
    console.log('Sertifikat    : APK TIDAK BERTANDA TANGAN atau tanda tangannya tidak sah.')
    process.exit(1)
  }

  console.log(`Subjek        : ${cert.subjek || '(tidak terbaca)'}`)
  console.log(`Jenis kunci   : ${cert.jenisKunci}`)
  const s = cert.skema
  console.log(`Skema         : v1=${s.v1} v2=${s.v2} v3=${s.v3}`)
  console.log('')
  console.log('Sidik jari sertifikat SHA-256:')
  console.log(`  ${cert.sidikJari}`)
  console.log('')

  if (cert.jenisKunci === 'debug') {
    console.log('PERHATIAN: APK lama ditandatangani KEYSTORE DEBUG bawaan Android.')
    console.log('Keystore itu ada di:')
    console.log('  %USERPROFILE%\\.android\\debug.keystore')
    console.log('Kata sandinya baku: store "android", alias "androiddebugkey", key "android".')
    console.log('APK pembaruan harus ditandatangani keystore yang sama itu, bukan keystore baru.')
  } else {
    console.log('APK lama ditandatangani kunci rilis. Cari berkas .jks atau .keystore')
    console.log('yang subjeknya sama, lalu tunjuk lewat android\\keystore.properties.')
  }

  console.log('')
  console.log('Langkah berikutnya:')
  console.log(`  1. Isi secret ASC_CERT_SHA256_LAMA dengan: ${cert.sidikJari}`)
  console.log(`  2. Isi secret ASC_VERSION_CODE_LAMA dengan: ${id.versionCode || '?'}`)
  console.log('  3. Biarkan APK ini di folder APK-LAMA/ agar BUAT-APK-UPDATE.bat')
  console.log('     dapat membandingkan sertifikat APK baru dengannya.')
  console.log('')
  console.log('Sidik jari sertifikat bukan rahasia. JANGAN pernah menyalin isi')
  console.log('keystore atau kata sandinya ke mana pun.')
}

main()
