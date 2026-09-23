// Umur dan kelompok umur (KU).
//
// Umur pernah dihitung terhadap tanggal acuan yang dipatok mati (1 Januari
// 2026), sehingga atlet kelahiran 4 Januari 2019 tercatat 6 tahun pada
// 23 September 2026 - padahal sudah 7. Tes di bawah mengunci perilaku yang
// benar, termasuk contoh yang diminta secara eksplisit.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateAge, ageGroupFor, athleteAgeInfo, ATURAN_KU, KU_TERMUDA
} from '../src/lib/atlet.js'

const ACUAN = new Date(2026, 8, 23) // 23 September 2026

// --- Contoh wajib -----------------------------------------------------------

test('DOB 04-01-2019 pada 23-09-2026 adalah 7 tahun, bukan 6', () => {
  assert.equal(calculateAge('2019-01-04', ACUAN), 7)
})

test('DOB 20-12-2019 pada 23-09-2026 adalah 6 tahun (ulang tahun belum lewat)', () => {
  assert.equal(calculateAge('2019-12-20', ACUAN), 6)
})

test('DOB 23-09-2019 pada 23-09-2026 adalah 7 tahun (tepat berulang tahun)', () => {
  assert.equal(calculateAge('2019-09-23', ACUAN), 7)
})

// --- Batas-batas ------------------------------------------------------------

test('sehari sebelum ulang tahun masih umur lama', () => {
  assert.equal(calculateAge('2019-09-24', ACUAN), 6)
})

test('sehari setelah ulang tahun sudah umur baru', () => {
  assert.equal(calculateAge('2019-09-22', ACUAN), 7)
})

test('lahir hari ini berumur 0, bukan negatif', () => {
  assert.equal(calculateAge('2026-09-23', ACUAN), 0)
})

test('tanggal lahir di masa depan tidak pernah menghasilkan umur negatif', () => {
  assert.equal(calculateAge('2030-01-01', ACUAN), 0)
})

test('kelahiran 29 Februari ditangani tanpa galat', () => {
  // Pada tahun bukan kabisat, 29 Feb dianggap belum lewat sampai 1 Maret.
  assert.equal(calculateAge('2016-02-29', new Date(2026, 1, 28)), 9)
  assert.equal(calculateAge('2016-02-29', new Date(2026, 2, 1)), 10)
})

test('tanggal lahir tidak sah menghasilkan string kosong, bukan angka karangan', () => {
  for (const buruk of ['', null, undefined, 'bukan-tanggal', '2019-02-30', '2019-13-01']) {
    assert.equal(calculateAge(buruk, ACUAN), '', `nilai: ${buruk}`)
  }
})

test('tanggal lahir adalah source of truth: umur tersimpan diabaikan', () => {
  const atlet = { birth: '2019-01-04', age: 6, ageGroup: 'KU 5A' }
  const info = athleteAgeInfo(atlet, ACUAN)
  assert.equal(info.age, 7, 'umur dihitung ulang dari tanggal lahir')
})

test('tanpa tanggal acuan, tanggal sistem yang dipakai', () => {
  const tahunIni = new Date().getFullYear()
  // Seseorang yang lahir 1 Januari 20 tahun lalu sudah pasti berulang tahun.
  assert.equal(calculateAge(`${tahunIni - 20}-01-01`), 20)
})

// --- Aturan KU existing -----------------------------------------------------

test('aturan KU memakai TAHUN KELAHIRAN dengan batas tetap', () => {
  assert.deepEqual(
    ATURAN_KU.map(a => [a.sampaiTahun, a.ku]),
    [[2010, 'KU 1'], [2012, 'KU 2'], [2014, 'KU 3'], [2016, 'KU 4'], [2018, 'KU 5B']]
  )
  assert.equal(KU_TERMUDA, 'KU 5A')
})

test('KU setiap batas tahun sesuai aturan existing', () => {
  const harapan = {
    '2005-06-01': 'KU 1', '2010-12-31': 'KU 1',
    '2011-01-01': 'KU 2', '2012-12-31': 'KU 2',
    '2013-01-01': 'KU 3', '2014-12-31': 'KU 3',
    '2015-01-01': 'KU 4', '2016-12-31': 'KU 4',
    '2017-01-01': 'KU 5B', '2018-12-31': 'KU 5B',
    '2019-01-01': 'KU 5A', '2020-04-16': 'KU 5A'
  }
  for (const [lahir, ku] of Object.entries(harapan)) {
    assert.equal(ageGroupFor(lahir), ku, `lahir ${lahir}`)
  }
})

test('KU tidak bergantung pada tanggal acuan, hanya pada tahun lahir', () => {
  // Inilah yang menjamin perbaikan umur tidak menggeser KU siapa pun.
  const lahir = '2019-01-04'
  assert.equal(ageGroupFor(lahir), 'KU 5A')
  for (const acuan of [new Date(2026, 0, 1), ACUAN, new Date(2030, 5, 5)]) {
    assert.equal(athleteAgeInfo({ birth: lahir }, acuan).ageGroup, 'KU 5A')
  }
})

test('perbaikan umur tidak mengubah KU satu atlet pun', () => {
  // Umur berbeda antara dua tanggal acuan, KU tetap sama.
  const contoh = ['2010-03-15', '2012-06-19', '2014-04-03', '2016-05-06', '2018-08-21', '2019-07-07']
  for (const lahir of contoh) {
    const lama = athleteAgeInfo({ birth: lahir }, new Date(2026, 0, 1))
    const baru = athleteAgeInfo({ birth: lahir }, ACUAN)
    assert.equal(lama.ageGroup, baru.ageGroup, `KU bergeser untuk ${lahir}`)
    assert.ok(baru.age >= lama.age, `umur mundur untuk ${lahir}`)
  }
})

test('tanggal lahir kosong tidak menghasilkan KU', () => {
  assert.equal(ageGroupFor(''), '')
  assert.equal(ageGroupFor(null), '')
})
