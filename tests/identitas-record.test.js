// Regresi bagian 2: recordIdentity() dulu mengembalikan '' untuk object yang
// tidak punya id/paymentId/registrationId/invoiceId maupun kombinasi identitas
// yang dikenali. Semua record seperti itu memakai kunci Map yang sama, sehingga
// saling menimpa di mergeCollection() dan datanya hilang tanpa jejak.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  recordIdentity, naturalIdentity, ensureRecordIds, mergeCollection,
  mergeStateWithoutLoss, withoutTombstoned, markTombstone
} from '../src/lib/sync-merge.js'

test('identity tidak pernah berupa string kosong', () => {
  const contoh = [
    {},
    { catatan: 'tanpa id' },
    { nama: 'A', nilai: 1 },
    { nested: { a: [1, 2, 3] } },
    null,
    undefined,
    'teks',
    42
  ]
  contoh.forEach(item => {
    const id = recordIdentity(item)
    assert.notEqual(id, '', `identity kosong untuk ${JSON.stringify(item)}`)
    assert.ok(id.length > 0)
  })
})

test('1) dua record object tanpa ID tetap berjumlah dua', () => {
  const a = { catatan: 'baris pertama', nilai: 1 }
  const b = { catatan: 'baris kedua', nilai: 2 }
  assert.notEqual(recordIdentity(a), recordIdentity(b))
  assert.equal(mergeCollection([a, b], [], {}).length, 2)
  assert.equal(mergeCollection([], [a, b], {}).length, 2)
})

test('2) tiga record tanpa ID tidak saling menimpa', () => {
  const list = [
    { keterangan: 'satu' },
    { keterangan: 'dua' },
    { keterangan: 'tiga' }
  ]
  const hasil = mergeCollection(list, [], {})
  assert.equal(hasil.length, 3)
  assert.deepEqual(hasil.map(x => x.keterangan).sort(), ['dua', 'satu', 'tiga'])
})

test('2b) record tanpa ID yang isinya kembar persis tetap dihitung semuanya', () => {
  const kembar = [{ catatan: 'sama' }, { catatan: 'sama' }, { catatan: 'sama' }]
  assert.equal(mergeCollection(kembar, [], {}).length, 3)
  // Sisi server dan sisi perangkat dipasangkan per kemunculan, bukan digandakan.
  assert.equal(mergeCollection(kembar, kembar, {}).length, 3)
})

test('3) record dengan ID yang sama tetap tergabung dengan benar', () => {
  const server = { id: 'X-1', nama: 'Lama', hanyaDiServer: true }
  const perangkat = { id: 'X-1', nama: 'Baru' }
  const hasil = mergeCollection([server], [perangkat], {})
  assert.equal(hasil.length, 1)
  assert.equal(hasil[0].nama, 'Baru', 'versi perangkat harus menang')
  assert.equal(hasil[0].hanyaDiServer, true, 'field yang hanya ada di server tidak boleh hilang')
})

test('4) migrasi record legacy tidak menghilangkan data', () => {
  const legacy = [
    { athleteId: 'ASC-1', date: '2026-09-15', type: 'hadir', status: 'hadir' },
    { athleteId: 'ASC-2', date: '2026-09-15', type: 'hadir', status: 'izin' },
    { catatan: 'tanpa penanda apa pun' },
    { id: 'ATT-lama', status: 'sudah punya id' }
  ]
  const migrasi = ensureRecordIds(legacy, { prefix: 'ATT' })
  assert.equal(migrasi.length, legacy.length, 'jumlah record tidak boleh berubah')
  assert.equal(new Set(migrasi.map(x => x.id)).size, legacy.length, 'setiap record harus punya ID unik')
  migrasi.forEach(x => assert.ok(String(x.id || ''), 'setiap record harus punya ID'))
  // ID lama yang sudah valid tidak boleh diubah.
  assert.equal(migrasi[3].id, 'ATT-lama')
  // Seluruh field asli tetap ada.
  assert.equal(migrasi[0].status, 'hadir')
  assert.equal(migrasi[2].catatan, 'tanpa penanda apa pun')
})

test('4b) migrasi bersifat deterministik dan mempertahankan identitas alami', () => {
  const absen = { athleteId: 'ASC-1', date: '2026-09-15', type: 'hadir' }
  const sebelum = recordIdentity(absen)
  const a = ensureRecordIds([absen], { prefix: 'ATT' })[0]
  const b = ensureRecordIds([absen], { prefix: 'ATT' })[0]
  assert.equal(a.id, b.id, 'dua perangkat harus menghasilkan ID yang sama')
  assert.equal(recordIdentity(a), sebelum,
    'migrasi tidak boleh mengubah cara record dicocokkan (perangkat yang belum migrasi tetap cocok)')
  // Record tanpa penanda apa pun juga deterministik.
  const polos = { catatan: 'x' }
  assert.equal(ensureRecordIds([polos])[0].id, ensureRecordIds([polos])[0].id)
})

test('5) urutan array berubah tanpa menyebabkan kehilangan record', () => {
  const a = { keterangan: 'alpha' }
  const b = { keterangan: 'beta' }
  const c = { keterangan: 'gamma' }
  const maju = mergeCollection([a, b, c], [a, b, c], {})
  const mundur = mergeCollection([c, b, a], [b, a, c], {})
  assert.equal(maju.length, 3)
  assert.equal(mundur.length, 3, 'urutan berbeda tidak boleh menghilangkan atau menggandakan record')
  assert.deepEqual(mundur.map(x => x.keterangan).sort(), ['alpha', 'beta', 'gamma'])
})

test('5b) sinkronisasi berulang tidak menggandakan record tanpa ID', () => {
  let daftar = [{ keterangan: 'alpha' }, { keterangan: 'beta' }]
  for (let putaran = 0; putaran < 5; putaran++) {
    // Urutan sengaja diacak tiap putaran, seperti hasil query yang berbeda.
    daftar = mergeCollection([...daftar].reverse(), daftar, {})
  }
  assert.equal(daftar.length, 2, 'record tanpa ID tidak boleh beranak setiap sinkronisasi')
})

test('naturalIdentity membedakan record ber-ID dari record tanpa ID', () => {
  assert.equal(naturalIdentity({ id: 'A-1' }), 'A-1')
  assert.equal(naturalIdentity({ catatan: 'x' }), '')
  assert.equal(naturalIdentity(null), '')
})

test('nisan berkunci kosong tidak menghapus seluruh record tanpa ID', () => {
  // Data lama bisa saja memuat nisan dengan kunci '' akibat bug sebelumnya.
  const graves = { attendance: { '': { deletedAt: 'x' } } }
  const list = [{ catatan: 'satu' }, { catatan: 'dua' }]
  assert.equal(withoutTombstoned('attendance', list, graves).length, 2,
    'nisan kosong tidak boleh menghapus record yang belum punya ID')
})

test('penggabungan state penuh tidak kehilangan record tanpa ID', () => {
  const remote = { attendance: [{ catatan: 'server-1' }, { catatan: 'server-2' }], __tombstones: {} }
  const local = { attendance: [{ catatan: 'perangkat-1' }], __tombstones: {} }
  const hasil = mergeStateWithoutLoss(remote, local, {
    defaultState: { attendance: [] },
    persistentCollections: ['attendance'],
    clientId: 'uji'
  })
  assert.equal(hasil.attendance.length, 3, 'ketiga record harus selamat')
})

test('record tanpa ID yang dihapus tetap terhapus lewat sidik jarinya', () => {
  const record = { catatan: 'akan dihapus' }
  const graves = markTombstone({}, 'attendance', recordIdentity(record))
  assert.deepEqual(withoutTombstoned('attendance', [record], graves), [])
  assert.equal(mergeCollection([record], [record], graves.attendance).length, 0)
})
