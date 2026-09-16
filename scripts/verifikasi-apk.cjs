#!/usr/bin/env node
// Memastikan sebuah APK benar-benar dapat dipasang sebagai PEMBARUAN di atas
// aplikasi ASC yang sudah ada di HP, tanpa uninstall.
//
// Empat syarat yang diperiksa:
//   1. applicationId sama persis;
//   2. sertifikat penandatangan sama persis dengan APK lama;
//   3. versionCode lebih tinggi daripada APK lama;
//   4. minSdk tetap 29 (Android 10) dan targetSdk tidak turun.
//
// Pemakaian:
//   node scripts/verifikasi-apk.cjs --apk <baru.apk> [--apk-lama <lama.apk>]
//                                   [--sidik-jari <sha256>] [--version-code-lama <n>]
//                                   [--target-sdk-minimal 35] [--json <berkas>]
//                                   [--version-code-minimal <n>]
//                                   [--mode pembaruan|instalasi_baru]
//
// Mode:
//   pembaruan     (bawaan) APK harus terbukti dapat menimpa aplikasi terpasang:
//                 butuh acuan sertifikat DAN versionCode APK lama.
//   instalasi_baru  rilis pertama dengan identitas signing baru. Pengguna
//                 memasang dari nol, jadi versionCode APK lama tidak ada dan
//                 tidak diperlukan. Sertifikat tetap WAJIB cocok dengan
//                 keystore yang dipakai sekarang.
//
// Kode keluar:
//   0  memenuhi seluruh syarat modenya
//   2  APK sah, tetapi acuan yang dibutuhkan tidak tersedia
//   1  tidak memenuhi syarat
'use strict'
const { existsSync, statSync, writeFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const alat = require('./lib/apk-tools.cjs')

const HARAPAN = {
  applicationId: 'com.aqilahswimmingclub.app',
  minSdk: '29',
  targetSdkMinimal: '35'
}

function argumen() {
  const a = process.argv.slice(2)
  const nilai = {}
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue
    const kunci = a[i].slice(2)
    const berikut = a[i + 1]
    nilai[kunci] = berikut && !berikut.startsWith('--') ? (i++, berikut) : 'true'
  }
  return nilai
}

function sha256Berkas(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function gagal(pesan) {
  console.error(`\n[GAGAL] ${pesan}\n`)
  process.exit(1)
}

function main() {
  const arg = argumen()
  const apkBaru = arg.apk
  if (!apkBaru) gagal('Parameter --apk wajib diisi.')
  if (!existsSync(apkBaru)) gagal(`APK tidak ditemukan: ${apkBaru}`)

  console.log('============================================================')
  console.log(' VERIFIKASI APK PEMBARUAN AQILAH SWIMMING CLUB')
  console.log('============================================================\n')

  const sdk = alat.akarSdk()
  if (!sdk) {
    gagal(
      'Android SDK tidak ditemukan.\n' +
      '        Set ANDROID_SDK_ROOT atau ANDROID_HOME ke folder Android SDK,\n' +
      '        atau pasang Android Studio terlebih dahulu.'
    )
  }
  console.log(`Android SDK : ${sdk}`)
  console.log(`APK baru    : ${apkBaru}`)

  const ukuran = statSync(apkBaru).size
  const berkasSha = sha256Berkas(apkBaru)
  console.log(`Ukuran      : ${ukuran.toLocaleString('id-ID')} byte`)
  console.log(`SHA-256     : ${berkasSha}\n`)

  // --- Identitas APK baru -------------------------------------------------
  const identitas = alat.bacaIdentitas(apkBaru)
  if (!identitas.applicationId) {
    gagal('Identitas APK tidak dapat dibaca. Pastikan apkanalyzer atau aapt2 tersedia di Android SDK.')
  }
  console.log('--- Identitas APK baru ---')
  console.log(`applicationId : ${identitas.applicationId}`)
  console.log(`versionName   : ${identitas.versionName}`)
  console.log(`versionCode   : ${identitas.versionCode}`)
  console.log(`minSdk        : ${identitas.minSdk}  (API 29 = Android 10)`)
  console.log(`targetSdk     : ${identitas.targetSdk}`)
  console.log(`dibaca oleh   : ${identitas.alat.join(', ') || '-'}\n`)

  // --- Tanda tangan APK baru ---------------------------------------------
  const sertifikat = alat.bacaSertifikat(apkBaru)
  if (!sertifikat.tersedia) gagal(sertifikat.alasan)
  console.log('--- Tanda tangan APK baru ---')
  console.log(`Tanda tangan sah : ${sertifikat.sah ? 'ya' : 'TIDAK'}`)
  console.log(`Sertifikat SHA-256: ${sertifikat.sidikJari || '(tidak ada)'}`)
  const s = sertifikat.skema
  console.log(`Skema            : v1=${s.v1} v2=${s.v2} v3=${s.v3}\n`)
  if (!sertifikat.sah) {
    gagal(
      'APK belum ditandatangani atau tanda tangannya tidak sah.\n' +
      '        APK tanpa tanda tangan tidak dapat dipasang di HP.\n' +
      '        Pastikan android/keystore.properties menunjuk ke keystore ASC yang benar.'
    )
  }
  if (s.v2 === false && s.v3 === false) {
    gagal('APK tidak memakai APK Signature Scheme v2/v3. Android 10 ke atas menolak APK yang hanya bertanda tangan v1.')
  }

  // --- Acuan dari APK lama ------------------------------------------------
  let sidikJariAcuan = arg['sidik-jari'] ? alat.normalkanSidikJari(arg['sidik-jari']) : ''
  let versionCodeLama = arg['version-code-lama'] || ''
  let sumberAcuan = sidikJariAcuan ? 'parameter --sidik-jari' : ''

  if (arg['apk-lama']) {
    if (!existsSync(arg['apk-lama'])) gagal(`APK lama tidak ditemukan: ${arg['apk-lama']}`)
    console.log('--- APK lama (acuan) ---')
    console.log(`Berkas        : ${arg['apk-lama']}`)
    const idLama = alat.bacaIdentitas(arg['apk-lama'])
    const certLama = alat.bacaSertifikat(arg['apk-lama'])
    console.log(`applicationId : ${idLama.applicationId}`)
    console.log(`versionName   : ${idLama.versionName}`)
    console.log(`versionCode   : ${idLama.versionCode}`)
    console.log(`minSdk        : ${idLama.minSdk}`)
    console.log(`targetSdk     : ${idLama.targetSdk}`)
    console.log(`Sertifikat    : ${certLama.sidikJari || '(tidak terbaca)'}\n`)
    if (!certLama.sidikJari) gagal('Sertifikat APK lama tidak terbaca, sehingga kesamaan tanda tangan tidak dapat dibuktikan.')
    sidikJariAcuan = certLama.sidikJari
    if (!versionCodeLama) versionCodeLama = idLama.versionCode
    sumberAcuan = 'APK lama'
  }

  // --- Penilaian ----------------------------------------------------------
  const mode = arg.mode === 'instalasi_baru' ? 'instalasi_baru' : 'pembaruan'

  // Pada instalasi_baru tidak ada APK lama, jadi kenaikan versionCode tidak
  // dapat dibandingkan; yang berlaku adalah batas bawah versionCode.
  const masalah = alat.periksaKesesuaian(
    { ...identitas, sidikJari: sertifikat.sidikJari },
    {
      ...HARAPAN,
      targetSdkMinimal: arg['target-sdk-minimal'] || HARAPAN.targetSdkMinimal,
      sidikJari: sidikJariAcuan,
      versionCodeLebihDari: mode === 'instalasi_baru' ? '' : versionCodeLama,
      versionCodeMinimal: arg['version-code-minimal'] || ''
    }
  )

  const bisaUpdate = mode === 'instalasi_baru'
    ? Boolean(sidikJariAcuan) && masalah.length === 0
    : Boolean(sidikJariAcuan) && Boolean(versionCodeLama) && masalah.length === 0

  if (arg.json) {
    writeFileSync(arg.json, JSON.stringify({
      apk: apkBaru, ukuran, sha256: berkasSha, identitas,
      sertifikat: { sah: sertifikat.sah, sidikJari: sertifikat.sidikJari, skema: sertifikat.skema },
      mode,
      acuan: { sumber: sumberAcuan, sidikJari: sidikJariAcuan, versionCodeLama },
      masalah, bisaUpdate
    }, null, 2))
  }

  if (masalah.length) {
    console.log('--- Hasil ---')
    masalah.forEach(m => console.log(`  [X] ${m}`))
    gagal(`${masalah.length} masalah ditemukan. APK ini TIDAK boleh dibagikan sebagai APK pembaruan.`)
  }

  console.log('--- Hasil ---')
  console.log('  [OK] applicationId sesuai.')
  console.log('  [OK] minSdk 29, mendukung Android 10 ke atas.')
  console.log('  [OK] targetSdk memenuhi syarat.')
  console.log('  [OK] APK bertanda tangan sah.')
  if (!sidikJariAcuan) {
    console.log('\n  [PERHATIAN] Tidak ada acuan APK lama, sehingga kesamaan tanda tangan')
    console.log('              BELUM dibuktikan. APK ini belum boleh disebut APK pembaruan.')
    console.log('              Jalankan ulang dengan --apk-lama <berkas APK lama>.')
    process.exit(2)
  }
  console.log(`  [OK] Sertifikat identik dengan ${sumberAcuan}.`)

  if (mode === 'instalasi_baru') {
    console.log(`  [OK] versionCode ${identitas.versionCode} memenuhi batas minimal.`)
    console.log('\n============================================================')
    console.log(' APK RILIS INSTALASI BARU')
    console.log(' Identitas signing berbeda dari aplikasi yang terpasang, jadi')
    console.log(' aplikasi lama HARUS di-uninstall lebih dulu oleh pengguna dan')
    console.log(' data lokalnya dapat ikut terhapus.')
    console.log(' Setelah APK ini terpasang, seluruh pembaruan berikutnya cukup')
    console.log(' dipasang menimpa - tanpa uninstall - selama keystore yang sama')
    console.log(' terus dipakai.')
    console.log('============================================================\n')
    process.exit(bisaUpdate ? 0 : 2)
  }

  if (!versionCodeLama) {
    console.log('\n  [PERHATIAN] versionCode APK lama tidak diketahui, kenaikan versi belum dibuktikan.')
    process.exit(2)
  }
  console.log(`  [OK] versionCode naik: ${versionCodeLama} -> ${identitas.versionCode}.`)
  console.log('\n============================================================')
  console.log(' APK TERBUKTI DAPAT DIPASANG SEBAGAI PEMBARUAN')
  console.log(' Pasang langsung menimpa aplikasi lama. Tanpa uninstall.')
  console.log(' Data aplikasi, sesi login, dan cache tetap dipertahankan.')
  console.log('============================================================\n')
  process.exit(bisaUpdate ? 0 : 2)
}

main()
