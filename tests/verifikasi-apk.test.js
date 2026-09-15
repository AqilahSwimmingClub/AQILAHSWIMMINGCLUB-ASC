// Aturan "APK ini boleh dipasang sebagai pembaruan" diuji di sini, tanpa
// memerlukan Android SDK. Yang diuji adalah penguraian keluaran alat Android
// dan keputusan lolos/gagalnya — bagian yang menentukan apakah pengguna
// terpaksa uninstall atau tidak.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const alat = require('../scripts/lib/apk-tools.cjs')

const KELUARAN_APKSIGNER = `Verifies
Verified using v1 scheme (JAR signing): true
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Verified using v4 scheme (APK Signature Scheme v4): false
Number of signers: 1
Signer #1 certificate DN: CN=AQILAH Swimming Club
Signer #1 certificate SHA-256 digest: 3f8a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8
Signer #1 certificate SHA-1 digest: 0123456789abcdef0123456789abcdef01234567
`

const SIDIK_ASC = '3f8a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8'

const DASAR = {
  applicationId: 'com.aqilahswimmingclub.app',
  minSdk: '29',
  targetSdkMinimal: '35'
}

test('sidik jari sertifikat terbaca dari keluaran apksigner', () => {
  assert.deepEqual(alat.uraiSidikJariSertifikat(KELUARAN_APKSIGNER), [SIDIK_ASC])
})

test('sidik jari dari keytool (bertitik dua, huruf besar) dianggap sama', () => {
  const keytool = '3F:8A:1C:2B:4D:5E:6F:70:81:92:A3:B4:C5:D6:E7:F8:09:1A:2B:3C:4D:5E:6F:70:81:92:A3:B4:C5:D6:E7:F8'
  assert.equal(alat.normalkanSidikJari(keytool), SIDIK_ASC)
  assert.equal(alat.sidikJariValid(keytool), true)
})

test('skema tanda tangan v2 dan v3 terbaca', () => {
  const s = alat.uraiSkemaTandaTangan(KELUARAN_APKSIGNER)
  assert.equal(s.v1, true)
  assert.equal(s.v2, true)
  assert.equal(s.v3, true)
  assert.equal(s.v4, false)
})

test('APK tanpa penandatangan tidak menghasilkan sidik jari', () => {
  assert.deepEqual(alat.uraiSidikJariSertifikat('DOES NOT VERIFY\nERROR: No signature found'), [])
})

test('badging aapt2 terurai menjadi identitas', () => {
  const badging = `package: name='com.aqilahswimmingclub.app' versionCode='4' versionName='1.3.0' compileSdkVersion='35'
sdkVersion:'29'
targetSdkVersion:'35'`
  const b = alat.uraiBadging(badging)
  assert.equal(b.applicationId, 'com.aqilahswimmingclub.app')
  assert.equal(b.versionCode, '4')
  assert.equal(b.versionName, '1.3.0')
  assert.equal(b.minSdk, '29')
  assert.equal(b.targetSdk, '35')
})

test('badging tanpa baris minSdk tidak menebak nilai', () => {
  // build-tools 35 memang tidak mencetak baris ini.
  const b = alat.uraiBadging("package: name='com.aqilahswimmingclub.app' versionCode='4' versionName='1.3.0'\ntargetSdkVersion:'35'")
  assert.equal(b.minSdk, '')
  assert.equal(b.targetSdk, '35')
})

test('minSdk terbaca dari xmltree sebagai cadangan', () => {
  const pohon = `N: android=http://schemas.android.com/apk/res/android
  E: uses-sdk (line=7)
    A: http://schemas.android.com/apk/res/android:minSdkVersion(0x0101020c)=(type 0x10)0x1d
    A: http://schemas.android.com/apk/res/android:targetSdkVersion(0x01010270)=(type 0x10)0x23`
  assert.equal(alat.uraiMinSdkXmltree(pohon), '29')
})

// --- Aturan lolos/gagal ---------------------------------------------------

test('APK yang benar-benar merupakan pembaruan dinyatakan lolos', () => {
  const masalah = alat.periksaKesesuaian(
    { applicationId: 'com.aqilahswimmingclub.app', minSdk: '29', targetSdk: '35', versionCode: '4', sidikJari: SIDIK_ASC },
    { ...DASAR, sidikJari: SIDIK_ASC, versionCodeLebihDari: '3' }
  )
  assert.deepEqual(masalah, [])
})

test('sertifikat berbeda ditolak dan menyebutkan INSTALL_FAILED_UPDATE_INCOMPATIBLE', () => {
  const lain = 'a'.repeat(64)
  const masalah = alat.periksaKesesuaian(
    { applicationId: 'com.aqilahswimmingclub.app', minSdk: '29', targetSdk: '35', versionCode: '4', sidikJari: lain },
    { ...DASAR, sidikJari: SIDIK_ASC, versionCodeLebihDari: '3' }
  )
  assert.equal(masalah.length, 1)
  assert.match(masalah[0], /Sertifikat penandatangan BERBEDA/)
  assert.match(masalah[0], /INSTALL_FAILED_UPDATE_INCOMPATIBLE/)
})

test('APK tanpa tanda tangan ditolak', () => {
  const masalah = alat.periksaKesesuaian(
    { applicationId: 'com.aqilahswimmingclub.app', minSdk: '29', targetSdk: '35', versionCode: '4', sidikJari: '' },
    { ...DASAR, sidikJari: SIDIK_ASC, versionCodeLebihDari: '3' }
  )
  assert.equal(masalah.length, 1)
  assert.match(masalah[0], /belum ditandatangani/)
})

test('versionCode yang tidak naik ditolak', () => {
  for (const baru of ['3', '2']) {
    const masalah = alat.periksaKesesuaian(
      { applicationId: 'com.aqilahswimmingclub.app', minSdk: '29', targetSdk: '35', versionCode: baru, sidikJari: SIDIK_ASC },
      { ...DASAR, sidikJari: SIDIK_ASC, versionCodeLebihDari: '3' }
    )
    assert.equal(masalah.length, 1, `versionCode ${baru} seharusnya ditolak`)
    assert.match(masalah[0], /versionCode tidak naik/)
  }
})

test('applicationId yang diubah ditolak', () => {
  const masalah = alat.periksaKesesuaian(
    { applicationId: 'com.aqilahswimmingclub.app2', minSdk: '29', targetSdk: '35', versionCode: '4', sidikJari: SIDIK_ASC },
    { ...DASAR, sidikJari: SIDIK_ASC, versionCodeLebihDari: '3' }
  )
  assert.equal(masalah.length, 1)
  assert.match(masalah[0], /applicationId tidak sesuai/)
})

test('minSdk selain 29 ditolak, termasuk yang dinaikkan', () => {
  for (const min of ['23', '30', '34']) {
    const masalah = alat.periksaKesesuaian(
      { applicationId: 'com.aqilahswimmingclub.app', minSdk: min, targetSdk: '35', versionCode: '4', sidikJari: SIDIK_ASC },
      { ...DASAR, sidikJari: SIDIK_ASC, versionCodeLebihDari: '3' }
    )
    assert.equal(masalah.length, 1, `minSdk ${min} seharusnya ditolak`)
    assert.match(masalah[0], /minSdk tidak sesuai/)
  }
})

test('targetSdk yang diturunkan ditolak', () => {
  const masalah = alat.periksaKesesuaian(
    { applicationId: 'com.aqilahswimmingclub.app', minSdk: '29', targetSdk: '34', versionCode: '4', sidikJari: SIDIK_ASC },
    { ...DASAR, sidikJari: SIDIK_ASC, versionCodeLebihDari: '3' }
  )
  assert.equal(masalah.length, 1)
  assert.match(masalah[0], /targetSdk terlalu rendah/)
})

test('targetSdk yang lebih tinggi dari minimal tetap diterima', () => {
  const masalah = alat.periksaKesesuaian(
    { applicationId: 'com.aqilahswimmingclub.app', minSdk: '29', targetSdk: '36', versionCode: '4', sidikJari: SIDIK_ASC },
    { ...DASAR, sidikJari: SIDIK_ASC, versionCodeLebihDari: '3' }
  )
  assert.deepEqual(masalah, [])
})

test('beberapa masalah sekaligus dilaporkan semuanya', () => {
  const masalah = alat.periksaKesesuaian(
    { applicationId: 'com.lain.app', minSdk: '23', targetSdk: '30', versionCode: '1', sidikJari: 'b'.repeat(64) },
    { ...DASAR, sidikJari: SIDIK_ASC, versionCodeLebihDari: '3' }
  )
  assert.equal(masalah.length, 5)
})

// Jenis kunci menentukan apakah sebuah APK dapat memperbarui aplikasi yang
// terpasang. APK debug dan APK rilis tidak akan pernah saling menimpa.
test('subjek sertifikat dibaca dari keluaran apksigner', () => {
  const keluaran = [
    'Signer #1 certificate DN: CN=Android Debug, O=Android, C=US',
    'Signer #1 certificate SHA-256 digest: ' + SIDIK_ASC
  ].join('\n')
  assert.deepEqual(alat.uraiSubjekSertifikat(keluaran), ['CN=Android Debug, O=Android, C=US'])
})

test('keystore debug bawaan Android dikenali sebagai kunci debug', () => {
  assert.equal(alat.jenisKunci('CN=Android Debug, O=Android, C=US'), 'debug')
  assert.equal(alat.jenisKunci('cn=android debug, o=Android'), 'debug')
})

test('kunci selain debug dilaporkan sebagai kunci rilis', () => {
  assert.equal(alat.jenisKunci('CN=Aqilah Swimming Club, O=ASC, C=ID'), 'rilis')
})

test('subjek kosong tidak ditebak jenisnya', () => {
  assert.equal(alat.jenisKunci(''), 'tidak diketahui')
})
