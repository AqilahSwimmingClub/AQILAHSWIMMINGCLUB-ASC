// Aturan rilis diuji di sini: penanganan kode keluar verifikasi APK, gerbang
// pembuatan GitHub Release, konfigurasi penandatanganan, dan isi catatan rilis.
//
// Pengujian kode keluar TIDAK menebak-nebak isi skrip: potongan shell diambil
// langsung dari .github/workflows/build-apk.yml lalu benar-benar dijalankan
// dengan `node` palsu yang keluar dengan kode tertentu. Jadi kalau logikanya
// kembali ke bentuk lama (`-gt 2`, yang meloloskan kode 1), tes ini gagal.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { catatanRilis } = require('../scripts/catatan-rilis.cjs')

const WORKFLOW = readFileSync('.github/workflows/build-apk.yml', 'utf8')
const GRADLE = readFileSync('android/app/build.gradle', 'utf8')
const CONTOH = readFileSync('android/keystore.properties.contoh', 'utf8')
const GITIGNORE = readFileSync('.gitignore', 'utf8')
const BAT_KEYSTORE = readFileSync('BUAT-KEYSTORE-BARU.bat', 'utf8')

// --- Mengambil isi `run: |` sebuah langkah workflow -------------------------
function skripLangkah(namaLangkah) {
  const baris = WORKFLOW.split('\n')
  const awal = baris.findIndex(b => b.trim() === `- name: ${namaLangkah}`)
  assert.notEqual(awal, -1, `langkah tidak ditemukan: ${namaLangkah}`)

  const indenLangkah = baris[awal].indexOf('-')
  let i = awal + 1
  let indenRun = -1
  for (; i < baris.length; i++) {
    const b = baris[i]
    if (b.trim() === '') continue
    const inden = b.length - b.trimStart().length
    // Sudah masuk langkah berikutnya sebelum ketemu run:
    if (inden <= indenLangkah) break
    if (/^run:\s*\|/.test(b.trim())) { indenRun = inden; i++; break }
  }
  assert.notEqual(indenRun, -1, `langkah ${namaLangkah} tidak punya blok run: |`)

  const isi = []
  for (; i < baris.length; i++) {
    const b = baris[i]
    if (b.trim() === '') { isi.push(''); continue }
    const inden = b.length - b.trimStart().length
    if (inden <= indenRun) break
    isi.push(b.slice(indenRun + 2))
  }
  // Ekspresi GitHub tidak ada artinya di luar CI; diganti nilai contoh.
  return isi.join('\n').replace(/\$\{\{[^}]*\}\}/g, 'CONTOH')
}

// Menjalankan potongan shell dengan `node` palsu yang keluar dengan kodeNode.
function jalankanDenganNodePalsu(skrip, kodeNode, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'asc-wf-'))
  try {
    const nodePalsu = join(dir, 'node')
    writeFileSync(nodePalsu, `#!/bin/sh\nexit ${kodeNode}\n`)
    chmodSync(nodePalsu, 0o755)
    const keluaranGithub = join(dir, 'github_output')
    writeFileSync(keluaranGithub, '')

    let kode = 0
    try {
      execFileSync('bash', ['-c', skrip], {
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          GITHUB_OUTPUT: keluaranGithub,
          GITHUB_SHA: '0'.repeat(40),
          TARGET_SDK_MINIMAL: '35',
          VERSION_CODE_MINIMAL: '4',
          // Di CI nilai ini selalu terdefinisi lewat blok env: langkahnya,
          // walau secret-nya kosong. `set -u` akan gagal bila tidak ada.
          CERT_CURRENT: '',
          VERSION_CODE_LAMA: '',
          JENIS_RILIS: 'pembaruan',
          ...env
        },
        stdio: 'pipe'
      })
    } catch (galat) {
      kode = galat.status ?? 1
    }
    return { kode, output: readFileSync(keluaranGithub, 'utf8') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- Kode keluar: pemeriksaan identitas APK debug --------------------------
const SKRIP_DEBUG = skripLangkah('Periksa identitas APK debug')

test('APK debug: kode 0 meloloskan langkah', () => {
  assert.equal(jalankanDenganNodePalsu(SKRIP_DEBUG, 0).kode, 0)
})

test('APK debug: kode 2 meloloskan langkah (tidak ada acuan sertifikat)', () => {
  assert.equal(jalankanDenganNodePalsu(SKRIP_DEBUG, 2).kode, 0)
})

// Inilah bug yang diperbaiki: `-gt 2` membuat kode 1 lolos tanpa suara.
test('APK debug: kode 1 WAJIB menggagalkan langkah', () => {
  assert.notEqual(jalankanDenganNodePalsu(SKRIP_DEBUG, 1).kode, 0)
})

test('APK debug: kode kegagalan lain juga menggagalkan langkah', () => {
  for (const kode of [3, 9, 127]) {
    assert.notEqual(jalankanDenganNodePalsu(SKRIP_DEBUG, kode).kode, 0, `kode ${kode} seharusnya gagal`)
  }
})

test('pemeriksaan APK debug tidak lagi memakai perbandingan -gt 2', () => {
  // Komentar dibuang: yang dinilai hanya baris yang benar-benar dijalankan.
  const kode = SKRIP_DEBUG.split('\n').filter(b => !b.trim().startsWith('#')).join('\n')
  assert.doesNotMatch(kode, /-gt\s+2/)
})

// --- Kode keluar: verifikasi APK release -----------------------------------
const SKRIP_RELEASE = skripLangkah('Verifikasi APK release')

test('APK release: kode 0 menandai terverifikasi=true', () => {
  const { kode, output } = jalankanDenganNodePalsu(SKRIP_RELEASE, 0, { CERT_CURRENT: 'a'.repeat(64), JENIS_RILIS: 'pembaruan' })
  assert.equal(kode, 0)
  assert.match(output, /terverifikasi=true/)
})

test('APK release: kode 2 menandai terverifikasi=false tanpa menggagalkan', () => {
  const { kode, output } = jalankanDenganNodePalsu(SKRIP_RELEASE, 2, { CERT_CURRENT: '', JENIS_RILIS: 'pembaruan' })
  assert.equal(kode, 0)
  assert.match(output, /terverifikasi=false/)
})

test('APK release: kode 1 WAJIB menggagalkan workflow', () => {
  const { kode, output } = jalankanDenganNodePalsu(SKRIP_RELEASE, 1, { CERT_CURRENT: 'a'.repeat(64), JENIS_RILIS: 'pembaruan' })
  assert.notEqual(kode, 0)
  assert.doesNotMatch(output, /terverifikasi=true/)
})

test('APK release: kode kegagalan lain tidak pernah menandai terverifikasi', () => {
  for (const k of [3, 5]) {
    const { kode, output } = jalankanDenganNodePalsu(SKRIP_RELEASE, k, { CERT_CURRENT: 'a'.repeat(64), JENIS_RILIS: 'pembaruan' })
    assert.notEqual(kode, 0, `kode ${k} seharusnya gagal`)
    assert.doesNotMatch(output, /terverifikasi=true/)
  }
})

// --- Gerbang pembuatan GitHub Release --------------------------------------
function syaratLangkah(nama) {
  const baris = WORKFLOW.split('\n')
  const awal = baris.findIndex(b => b.trim() === `- name: ${nama}`)
  assert.notEqual(awal, -1, `langkah tidak ditemukan: ${nama}`)
  const kumpul = []
  for (let i = awal + 1; i < baris.length; i++) {
    const t = baris[i].trim()
    if (t.startsWith('- name:')) break
    if (t.startsWith('if:')) { kumpul.push(t.slice(3)); continue }
    if (kumpul.length) {
      if (/^(uses|run|with|env|id|timeout-minutes):/.test(t)) break
      kumpul.push(t)
    }
  }
  return kumpul.join(' ').replace(/\s+/g, ' ').trim()
}

const SYARAT_RELEASE = syaratLangkah('Buat GitHub Release untuk APK yang terverifikasi')

test('Release hanya dari workflow_dispatch', () => {
  assert.match(SYARAT_RELEASE, /github\.event_name == 'workflow_dispatch'/)
})

test('Release hanya dari branch main', () => {
  assert.match(SYARAT_RELEASE, /github\.ref == 'refs\/heads\/main'/)
})

test('Release hanya bila buat_release dicentang', () => {
  assert.match(SYARAT_RELEASE, /inputs\.buat_release/)
})

test('Release hanya untuk APK yang terverifikasi', () => {
  assert.match(SYARAT_RELEASE, /steps\.verifikasi_release\.outputs\.terverifikasi == 'true'/)
})

test('keempat syarat Release digabung dengan AND, bukan OR', () => {
  assert.doesNotMatch(SYARAT_RELEASE, /\|\|/)
  assert.equal((SYARAT_RELEASE.match(/&&/g) || []).length, 3)
})

// --- Penandatanganan -------------------------------------------------------
test('workflow menulis keystore PKCS12, bukan JKS', () => {
  assert.match(WORKFLOW, /base64 -d > android\/asc-release\.p12/)
  assert.match(WORKFLOW, /echo "storeType=PKCS12"/)
})

test('workflow memakai secret ASC_CERT_SHA256_CURRENT', () => {
  assert.match(WORKFLOW, /secrets\.ASC_CERT_SHA256_CURRENT/)
  assert.doesNotMatch(WORKFLOW, /secrets\.ASC_CERT_SHA256_LAMA/)
})

test('keystore sementara dihapus dari runner walau job gagal', () => {
  const baris = WORKFLOW.split('\n')
  const i = baris.findIndex(b => b.includes('Hapus berkas rahasia dari runner'))
  assert.notEqual(i, -1)
  const blok = baris.slice(i, i + 4).join('\n')
  assert.match(blok, /if: always\(\)/)
  assert.match(blok, /asc-release\.p12/)
  assert.match(blok, /keystore\.properties/)
})

test('kata sandi tidak pernah ditulis harfiah ke dalam repository', () => {
  // Setiap storePassword/keyPassword yang ter-commit harus berupa placeholder,
  // variabel shell, atau pembacaan dari properties - tidak pernah nilai asli.
  // Tes ini sengaja tidak memuat kata sandinya, supaya kata sandi itu sendiri
  // tidak ikut masuk git lewat berkas tes.
  const SAH = /^(ISI_[A-Z_]+|\$\{[A-Z_]+\}|!SANDI!|%SANDI%|\$\{\{[^}]*\}\})$/
  for (const berkas of [WORKFLOW, CONTOH, BAT_KEYSTORE, GRADLE, readFileSync('BUAT-APK-UPDATE.bat', 'utf8')]) {
    for (const cocok of berkas.matchAll(/(?:store|key)Password=([^\s"']+)/gi)) {
      assert.match(cocok[1], SAH, `kata sandi harfiah ter-commit: ${cocok[0]}`)
    }
  }
})

test('build.gradle membaca storeType dari keystore.properties', () => {
  assert.match(GRADLE, /keystoreProperties\['storeType'\]/)
  assert.match(GRADLE, /storeType keystoreProperties\['storeType'\]/)
})

test('build.gradle membaca seluruh kunci penandatanganan', () => {
  for (const kunci of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
    assert.match(GRADLE, new RegExp(`keystoreProperties\\['${kunci}'\\]`))
  }
})

test('contoh keystore.properties memakai PKCS12 dan alias asc-release', () => {
  assert.match(CONTOH, /^storeFile=asc-release\.p12$/m)
  assert.match(CONTOH, /^storeType=PKCS12$/m)
  assert.match(CONTOH, /^keyAlias=asc-release$/m)
})

test('keystore dan keystore.properties tidak dapat masuk git', () => {
  for (const pola of ['android/keystore.properties', '*.p12', '*.jks', '*.keystore']) {
    assert.ok(GITIGNORE.split('\n').includes(pola), `.gitignore kehilangan pola: ${pola}`)
  }
})

test('BUAT-KEYSTORE-BARU.bat menolak menimpa keystore yang sudah ada', () => {
  assert.match(BAT_KEYSTORE, /if exist "%TUJUAN%"/)
  assert.match(BAT_KEYSTORE, /DIBATALKAN/)
})

test('BUAT-KEYSTORE-BARU.bat memakai spesifikasi keystore ASC', () => {
  assert.match(BAT_KEYSTORE, /-keyalg RSA/)
  assert.match(BAT_KEYSTORE, /-keysize 4096/)
  assert.match(BAT_KEYSTORE, /-sigalg SHA256withRSA/)
  assert.match(BAT_KEYSTORE, /-storetype PKCS12/)
  assert.match(BAT_KEYSTORE, /-alias asc-release/)
  const validity = BAT_KEYSTORE.match(/-validity (\d+)/)
  assert.ok(validity && Number(validity[1]) >= 10000, 'validity minimal 10.000 hari')
  assert.match(BAT_KEYSTORE, /CN=AQILAH Swimming Club, O=AQILAH Swimming Club, C=ID/)
})

test('BUAT-APK-UPDATE.bat tidak pernah membuat keystore', () => {
  const bat = readFileSync('BUAT-APK-UPDATE.bat', 'utf8')
  assert.doesNotMatch(bat, /genkeypair/)
})

// --- Catatan rilis ---------------------------------------------------------
test('catatan instalasi_baru menyuruh uninstall dan memperingatkan data lokal', () => {
  const teks = catatanRilis({ mode: 'instalasi_baru', versionName: '1.2.1', versionCode: '4', commit: 'abc' })
  assert.match(teks, /[Uu]ninstall/)
  assert.match(teks, /dapat ikut terhapus/)
  assert.match(teks, /pembaruan berikutnya/)
})

test('catatan pembaruan justru melarang uninstall', () => {
  const teks = catatanRilis({ mode: 'pembaruan', versionName: '1.2.1', versionCode: '4', commit: 'abc' })
  assert.match(teks, /\*\*Jangan uninstall\.\*\*/)
  assert.match(teks, /dipertahankan/)
})

test('catatan rilis selalu mencantumkan identitas APK', () => {
  for (const mode of ['instalasi_baru', 'pembaruan']) {
    const teks = catatanRilis({ mode, versionName: '1.2.1', versionCode: '4', commit: 'abc123' })
    assert.match(teks, /com\.aqilahswimmingclub\.app/)
    assert.match(teks, /versionCode: `4`/)
    assert.match(teks, /minSdk: `29`/)
    assert.match(teks, /targetSdk: `35`/)
    assert.match(teks, /abc123/)
  }
})

test('jenis rilis yang tidak dikenal ditolak, bukan didiamkan', () => {
  assert.throws(() => catatanRilis({ mode: 'apa_saja', versionName: '1', versionCode: '4', commit: 'a' }), /tidak dikenal/)
})
