// Pembacaan identitas dan tanda tangan APK.
//
// Bagian yang murni (pengurai teks) dipisah dari bagian yang memanggil Android
// SDK, supaya aturannya dapat diuji otomatis tanpa memerlukan SDK terpasang.
'use strict'
const { existsSync, readdirSync, statSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

const WINDOWS = process.platform === 'win32'

// ---------------------------------------------------------------------------
// Pengurai keluaran alat (murni, dapat diuji)
// ---------------------------------------------------------------------------

// Ambil seluruh sidik jari SHA-256 sertifikat penandatangan dari keluaran
// `apksigner verify --verbose --print-certs`.
function uraiSidikJariSertifikat(keluaran) {
  const hasil = []
  String(keluaran || '').split(/\r?\n/).forEach(baris => {
    // Contoh: "Signer #1 certificate SHA-256 digest: a1b2c3..."
    const cocok = baris.match(/certificate\s+SHA-?256\s+digest:\s*([0-9a-fA-F:\s]+)$/i)
    if (cocok) hasil.push(normalkanSidikJari(cocok[1]))
  })
  return hasil
}

// Sidik jari dibandingkan dalam bentuk seragam: huruf kecil, tanpa titik dua
// dan tanpa spasi. keytool memakai titik dua, apksigner tidak.
function normalkanSidikJari(nilai) {
  return String(nilai || '').trim().toLowerCase().replace(/[:\s]/g, '')
}

function sidikJariValid(nilai) {
  return /^[0-9a-f]{64}$/.test(normalkanSidikJari(nilai))
}

// Skema tanda tangan yang dilaporkan apksigner. v2/v3 wajib ada untuk Android 10+.
function uraiSkemaTandaTangan(keluaran) {
  const teks = String(keluaran || '')
  const baca = label => {
    const cocok = teks.match(new RegExp(`Verified using ${label}\\s*(?:scheme)?\\s*\\([^)]*\\)?\\s*:\\s*(true|false)`, 'i'))
    return cocok ? cocok[1].toLowerCase() === 'true' : null
  }
  return { v1: baca('v1'), v2: baca('v2'), v3: baca('v3'), v4: baca('v4') }
}

// Keluaran `aapt2 dump badging` untuk identitas dasar.
function uraiBadging(keluaran) {
  const teks = String(keluaran || '')
  const ambil = pola => { const c = teks.match(pola); return c ? c[1] : '' }
  return {
    applicationId: ambil(/package:\s*name='([^']+)'/),
    versionCode: ambil(/versionCode='(\d+)'/),
    versionName: ambil(/versionName='([^']*)'/),
    // aapt2 pada build-tools tertentu tidak mencetak baris minSdk sama sekali,
    // jadi nilai kosong di sini bukan berarti APK-nya bermasalah.
    minSdk: ambil(/^sdkVersion:'(\d+)'/m),
    targetSdk: ambil(/^targetSdkVersion:'(\d+)'/m)
  }
}

// Nilai minSdkVersion dari `aapt2 dump xmltree`, dipakai bila badging bungkam.
function uraiMinSdkXmltree(keluaran) {
  const cocok = String(keluaran || '')
    .match(/A:\s*(?:http:\/\/schemas\.android\.com\/apk\/res\/android:)?minSdkVersion[^=]*=\(type 0x10\)(0x[0-9a-fA-F]+|\d+)/)
  if (!cocok) return ''
  const mentah = cocok[1]
  const angka = mentah.startsWith('0x') ? parseInt(mentah, 16) : parseInt(mentah, 10)
  return Number.isFinite(angka) ? String(angka) : ''
}

// Bandingkan hasil pemeriksaan dengan yang diharapkan. Mengembalikan daftar
// masalah; daftar kosong berarti APK lolos.
function periksaKesesuaian(aktual, diharapkan) {
  const masalah = []
  const samakan = (nama, a, b) => {
    if (String(a) !== String(b)) masalah.push(`${nama} tidak sesuai: '${a}' (diharapkan '${b}')`)
  }
  if (diharapkan.applicationId) samakan('applicationId', aktual.applicationId, diharapkan.applicationId)
  if (diharapkan.minSdk) samakan('minSdk', aktual.minSdk, diharapkan.minSdk)

  if (diharapkan.targetSdkMinimal) {
    const t = Number(aktual.targetSdk)
    if (!Number.isFinite(t) || t < Number(diharapkan.targetSdkMinimal)) {
      masalah.push(`targetSdk terlalu rendah: '${aktual.targetSdk}' (minimal '${diharapkan.targetSdkMinimal}')`)
    }
  }
  if (diharapkan.versionCodeLebihDari !== undefined && diharapkan.versionCodeLebihDari !== '') {
    const baru = Number(aktual.versionCode)
    const lama = Number(diharapkan.versionCodeLebihDari)
    if (!Number.isFinite(baru) || !Number.isFinite(lama) || baru <= lama) {
      masalah.push(`versionCode tidak naik: APK baru '${aktual.versionCode}', APK lama '${diharapkan.versionCodeLebihDari}'. Android menolak memasang versi yang tidak lebih tinggi.`)
    }
  }
  if (diharapkan.sidikJari) {
    const a = normalkanSidikJari(aktual.sidikJari)
    const b = normalkanSidikJari(diharapkan.sidikJari)
    if (!a) masalah.push('Sertifikat APK baru tidak terbaca. APK kemungkinan belum ditandatangani.')
    else if (a !== b) {
      masalah.push(
        'Sertifikat penandatangan BERBEDA dari APK lama.\n' +
        `        APK baru : ${a}\n` +
        `        APK lama : ${b}\n` +
        '        Android menganggapnya aplikasi lain, sehingga pemasangan akan ditolak\n' +
        '        dengan INSTALL_FAILED_UPDATE_INCOMPATIBLE. Gunakan keystore yang sama\n' +
        '        dengan yang dipakai membuat APK lama.'
      )
    }
  }
  return masalah
}

// ---------------------------------------------------------------------------
// Pencarian alat Android SDK (bergantung sistem)
// ---------------------------------------------------------------------------

function adaBerkas(p) {
  try { return Boolean(p) && existsSync(p) && statSync(p).isFile() } catch { return false }
}

function akarSdk() {
  const kandidat = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    WINDOWS ? join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk') : '',
    WINDOWS ? '' : join(process.env.HOME || '', 'Android', 'Sdk'),
    WINDOWS ? '' : join(process.env.HOME || '', 'Library', 'Android', 'sdk')
  ].filter(Boolean)
  return kandidat.find(p => { try { return existsSync(p) } catch { return false } }) || ''
}

// Cari sebuah alat di dalam SDK. build-tools dipilih versi tertinggi.
function cariAlat(nama) {
  const sdk = akarSdk()
  if (!sdk) return ''
  const namaBerkas = WINDOWS ? [`${nama}.bat`, `${nama}.exe`, nama] : [nama]
  const lokasi = []

  const bt = join(sdk, 'build-tools')
  try {
    readdirSync(bt).sort().reverse().forEach(v => namaBerkas.forEach(n => lokasi.push(join(bt, v, n))))
  } catch { /* build-tools belum terpasang */ }

  const ct = join(sdk, 'cmdline-tools')
  try {
    readdirSync(ct).sort().reverse().forEach(v => namaBerkas.forEach(n => lokasi.push(join(ct, v, 'bin', n))))
  } catch { /* cmdline-tools belum terpasang */ }

  namaBerkas.forEach(n => {
    lokasi.push(join(sdk, 'tools', 'bin', n))
    lokasi.push(join(sdk, 'platform-tools', n))
  })
  return lokasi.find(adaBerkas) || ''
}

function jalankan(perintah, argumen) {
  const hasil = spawnSync(perintah, argumen, { encoding: 'utf8', shell: WINDOWS, maxBuffer: 32 * 1024 * 1024 })
  return {
    kode: hasil.status,
    keluaran: `${hasil.stdout || ''}${hasil.stderr || ''}`,
    gagalJalan: Boolean(hasil.error)
  }
}

// Baca identitas APK: applicationId, versionCode, versionName, minSdk, targetSdk.
function bacaIdentitas(apk) {
  const apkanalyzer = cariAlat('apkanalyzer')
  const hasil = { applicationId: '', versionCode: '', versionName: '', minSdk: '', targetSdk: '', alat: [] }

  if (apkanalyzer) {
    const baca = sub => {
      const r = jalankan(apkanalyzer, ['manifest', sub, apk])
      return r.kode === 0 ? r.keluaran.trim().split(/\r?\n/).pop().trim() : ''
    }
    hasil.applicationId = baca('application-id')
    hasil.versionCode = baca('version-code')
    hasil.versionName = baca('version-name')
    hasil.minSdk = baca('min-sdk')
    hasil.targetSdk = baca('target-sdk')
    if (hasil.applicationId) hasil.alat.push('apkanalyzer')
  }

  // aapt2 melengkapi nilai yang belum terbaca.
  const aapt2 = cariAlat('aapt2')
  if (aapt2 && (!hasil.applicationId || !hasil.minSdk || !hasil.targetSdk)) {
    const badging = jalankan(aapt2, ['dump', 'badging', apk])
    if (badging.kode === 0) {
      const b = uraiBadging(badging.keluaran)
      Object.keys(b).forEach(k => { if (!hasil[k] && b[k]) hasil[k] = b[k] })
      hasil.alat.push('aapt2 badging')
    }
    if (!hasil.minSdk) {
      const pohon = jalankan(aapt2, ['dump', 'xmltree', '--file', 'AndroidManifest.xml', apk])
      if (pohon.kode === 0) {
        const m = uraiMinSdkXmltree(pohon.keluaran)
        if (m) { hasil.minSdk = m; hasil.alat.push('aapt2 xmltree') }
      }
    }
  }
  return hasil
}

// Baca sertifikat penandatangan APK.
function bacaSertifikat(apk) {
  const apksigner = cariAlat('apksigner')
  if (!apksigner) {
    return { tersedia: false, alasan: 'apksigner tidak ditemukan di Android SDK (build-tools).' }
  }
  const r = jalankan(apksigner, ['verify', '--verbose', '--print-certs', apk])
  const sidikJari = uraiSidikJariSertifikat(r.keluaran)
  return {
    tersedia: true,
    // apksigner memberi kode keluar bukan nol bila APK tidak bertanda tangan
    // atau tanda tangannya tidak sah.
    sah: r.kode === 0,
    sidikJari: sidikJari[0] || '',
    seluruhSidikJari: sidikJari,
    skema: uraiSkemaTandaTangan(r.keluaran),
    keluaran: r.keluaran
  }
}

module.exports = {
  uraiSidikJariSertifikat,
  normalkanSidikJari,
  sidikJariValid,
  uraiSkemaTandaTangan,
  uraiBadging,
  uraiMinSdkXmltree,
  periksaKesesuaian,
  akarSdk,
  cariAlat,
  bacaIdentitas,
  bacaSertifikat
}
