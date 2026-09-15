// Regresi bagian 3: ID yang sudah memiliki nisan TIDAK BOLEH dipakai ulang.
//
// nextAthleteId() dulu sengaja mencari nomor terkecil yang kosong, sehingga atlet
// baru bisa memperoleh ID yang baru saja dihapus (mis. ASC-0012). Record baru
// seperti itu ditolak refuseTombstonedWrite(), atau ikut tersapu ketika perangkat
// lain menyinkronkan nisannya — data baru hilang tanpa jejak.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  markTombstone, markTombstoneSynced, mergeTombstoneMaps, isTombstoned,
  nextSequentialId, nextAvailableDeterministicId, isIdSafeForNewRecord,
  mergeStateWithoutLoss, withoutTombstoned, resolveCollectionFromSources
} from '../src/lib/sync-merge.js'

// --- ID berurutan (atlet, pelatih) ---------------------------------------

test('ID atlet baru tidak memakai nomor yang sedang dipakai', () => {
  const id = nextSequentialId('athletes', {
    prefix: 'ASC', existingIds: ['ASC-0001', 'ASC-0002', 'ASC-0003'], tombstones: {}
  })
  assert.equal(id, 'ASC-0004')
})

test('ID atlet baru tidak memakai nomor yang pernah dihapus', () => {
  // ASC-0012 dihapus: nomornya kosong, tetapi nisannya masih ada.
  const graves = markTombstone({}, 'athletes', 'ASC-0012')
  const id = nextSequentialId('athletes', {
    prefix: 'ASC',
    existingIds: ['ASC-0001', 'ASC-0011'],
    tombstones: graves
  })
  assert.notEqual(id, 'ASC-0012', 'ID bernisan tidak boleh dipakai ulang')
  assert.equal(id, 'ASC-0013', 'nomor harus melewati seluruh ID bernisan')
  assert.equal(isIdSafeForNewRecord('athletes', id, graves), true)
})

test('lubang nomor di tengah tidak diisi ulang bila pernah dihapus', () => {
  let graves = {}
  for (const id of ['ASC-0002', 'ASC-0003', 'ASC-0004']) graves = markTombstone(graves, 'athletes', id)
  const id = nextSequentialId('athletes', { prefix: 'ASC', existingIds: ['ASC-0001'], tombstones: graves })
  assert.equal(id, 'ASC-0005')
})

test('ID pelatih tidak mundur ke nomor tertinggi yang baru dihapus', () => {
  // PLT-0003 adalah nomor tertinggi lalu dihapus. max+1 akan mengembalikan
  // PLT-0003 lagi, padahal ID itu sudah bernisan.
  const graves = markTombstone({}, 'coaches', 'PLT-0003')
  const id = nextSequentialId('coaches', {
    prefix: 'PLT', existingIds: ['PLT-0001', 'PLT-0002'], tombstones: graves
  })
  assert.notEqual(id, 'PLT-0003')
  assert.equal(id, 'PLT-0004')
})

test('pembuatan berulang setelah penghapusan selalu menghasilkan ID baru', () => {
  let graves = {}
  let dipakai = ['ASC-0001']
  const riwayat = new Set(dipakai)
  for (let putaran = 0; putaran < 10; putaran++) {
    const baru = nextSequentialId('athletes', { prefix: 'ASC', existingIds: dipakai, tombstones: graves })
    assert.equal(riwayat.has(baru), false, `ID ${baru} dipakai ulang pada putaran ${putaran}`)
    riwayat.add(baru)
    dipakai = [...dipakai, baru]
    // Langsung dihapus lagi, meniru admin yang salah input lalu menghapusnya.
    graves = markTombstone(graves, 'athletes', baru)
    dipakai = dipakai.filter(x => x !== baru)
  }
})

// --- ID deterministik (keuangan, notifikasi) ------------------------------

test('transaksi keuangan baru memakai ID berbeda setelah yang lama dihapus', () => {
  const dasar = 'FIN-income-payment-PAY1'
  const graves = markTombstone({}, 'financeTransactions', dasar)
  const baru = nextAvailableDeterministicId('financeTransactions', dasar, graves)
  assert.notEqual(baru, dasar, 'ID deterministik yang bernisan tidak boleh dipakai ulang')
  assert.equal(isIdSafeForNewRecord('financeTransactions', baru, graves), true)
})

test('ID deterministik tetap sama bila belum pernah dihapus', () => {
  const dasar = 'FIN-income-payment-PAY1'
  assert.equal(nextAvailableDeterministicId('financeTransactions', dasar, {}), dasar)
})

test('dua perangkat menghitung ID pengganti yang sama dari nisan yang sama', () => {
  const dasar = 'FIN-income-payment-PAY1'
  const graves = markTombstone({}, 'financeTransactions', dasar)
  const perangkatA = nextAvailableDeterministicId('financeTransactions', dasar, graves)
  const perangkatB = nextAvailableDeterministicId('financeTransactions', dasar, structuredClone(graves))
  assert.equal(perangkatA, perangkatB, 'ID pengganti harus deterministik antarperangkat')
})

test('penghapusan berulang terus menaikkan revisi ID, tidak pernah berputar', () => {
  let graves = {}
  const dasar = 'FIN-income-payment-PAY1'
  const terpakai = new Set()
  for (let i = 0; i < 5; i++) {
    const id = nextAvailableDeterministicId('financeTransactions', dasar, graves)
    assert.equal(terpakai.has(id), false, `ID ${id} dipakai ulang`)
    terpakai.add(id)
    graves = markTombstone(graves, 'financeTransactions', id)
  }
})

// --- Skenario dua perangkat penuh ----------------------------------------

test('dua perangkat: A hapus atlet, B memuat ulang, ID baru bukan ID lama', () => {
  // 1) Perangkat A menghapus ASC-0012.
  const perangkatA = { athletes: [{ id: 'ASC-0011' }, { id: 'ASC-0012', name: 'Lama' }], __tombstones: {} }
  markTombstone(perangkatA.__tombstones, 'athletes', 'ASC-0012')
  perangkatA.athletes = perangkatA.athletes.filter(a => a.id !== 'ASC-0012')

  // 2) Nisan sampai ke server lewat payload bersama.
  markTombstoneSynced(perangkatA.__tombstones, 'athletes', 'ASC-0012')
  const server = mergeStateWithoutLoss(
    { athletes: [{ id: 'ASC-0011' }, { id: 'ASC-0012', name: 'Lama' }], __tombstones: {} },
    perangkatA,
    { defaultState: { athletes: [] }, persistentCollections: ['athletes'], clientId: 'A' }
  )
  assert.deepEqual(server.athletes.map(a => a.id), ['ASC-0011'], 'server masih memuat atlet terhapus')

  // 3) Perangkat B memuat ulang dan mengadopsi nisan dari server.
  const perangkatB = { athletes: [{ id: 'ASC-0011' }, { id: 'ASC-0012', name: 'Lama' }], __tombstones: {} }
  perangkatB.__tombstones = mergeTombstoneMaps(perangkatB.__tombstones, server.__tombstones)
  perangkatB.athletes = withoutTombstoned('athletes', perangkatB.athletes, perangkatB.__tombstones)
  assert.deepEqual(perangkatB.athletes.map(a => a.id), ['ASC-0011'])
  assert.equal(isTombstoned('athletes', 'ASC-0012', perangkatB.__tombstones), true)

  // 4) Perangkat B mendaftarkan atlet baru: ID-nya tidak boleh ASC-0012.
  const idBaru = nextSequentialId('athletes', {
    prefix: 'ASC', existingIds: perangkatB.athletes.map(a => a.id), tombstones: perangkatB.__tombstones
  })
  assert.notEqual(idBaru, 'ASC-0012')
  perangkatB.athletes.push({ id: idBaru, name: 'Atlet Baru' })

  // 5) Setelah kedua perangkat sinkron ulang, atlet baru harus tetap ada.
  const setelahSinkron = mergeStateWithoutLoss(server, perangkatB, {
    defaultState: { athletes: [] }, persistentCollections: ['athletes'], clientId: 'B'
  })
  const ids = setelahSinkron.athletes.map(a => a.id)
  assert.ok(ids.includes(idBaru), 'atlet baru hilang setelah sinkronisasi ulang')
  assert.ok(!ids.includes('ASC-0012'), 'atlet yang dihapus bangkit kembali')

  // Perangkat A juga menerima atlet baru itu tanpa menghidupkan yang lama.
  const kembaliKeA = mergeStateWithoutLoss(setelahSinkron, perangkatA, {
    defaultState: { athletes: [] }, persistentCollections: ['athletes'], clientId: 'A'
  })
  assert.ok(kembaliKeA.athletes.map(a => a.id).includes(idBaru))
  assert.ok(!kembaliKeA.athletes.map(a => a.id).includes('ASC-0012'))
})

test('6) transaksi keuangan yang dihapus tidak bangkit karena ID referensi deterministik', () => {
  const dasar = 'FIN-income-payment-PAY1'
  const transaksiLama = { id: dasar, direction: 'income', referenceType: 'payment', referenceId: 'PAY1', amount: 100000 }

  // Perangkat A menghapus transaksi itu, nisan tersinkron ke server.
  const perangkatA = { financeTransactions: [transaksiLama], __tombstones: {} }
  markTombstone(perangkatA.__tombstones, 'financeTransactions', dasar)
  markTombstoneSynced(perangkatA.__tombstones, 'financeTransactions', dasar)
  perangkatA.financeTransactions = []

  const server = mergeStateWithoutLoss(
    { financeTransactions: [transaksiLama], __tombstones: {} }, perangkatA,
    { defaultState: { financeTransactions: [] }, persistentCollections: ['financeTransactions'], clientId: 'A' }
  )
  assert.deepEqual(server.financeTransactions, [], 'transaksi terhapus masih ada di payload server')

  // Perangkat B membayar ulang referensi yang sama. ID dasarnya identik, jadi
  // tanpa perbaikan ini transaksi lama akan "hidup kembali" atau ditolak.
  const perangkatB = { financeTransactions: [], __tombstones: structuredClone(server.__tombstones) }
  const idBaru = nextAvailableDeterministicId('financeTransactions', dasar, perangkatB.__tombstones)
  assert.notEqual(idBaru, dasar)
  perangkatB.financeTransactions.push({ ...transaksiLama, id: idBaru, amount: 250000 })

  const gabungan = mergeStateWithoutLoss(server, perangkatB, {
    defaultState: { financeTransactions: [] }, persistentCollections: ['financeTransactions'], clientId: 'B'
  })
  const ids = gabungan.financeTransactions.map(t => t.id)
  assert.deepEqual(ids, [idBaru], 'hanya transaksi baru yang boleh ada')
  assert.equal(gabungan.financeTransactions[0].amount, 250000)
})

test('record baru tidak ikut terhapus saat perangkat lain memuat nisan lama', () => {
  const graves = markTombstone({}, 'competitions', 'CMP-1')
  markTombstoneSynced(graves, 'competitions', 'CMP-1')
  const idBaru = nextAvailableDeterministicId('competitions', 'CMP-1', graves)
  const hasil = resolveCollectionFromSources('competitions', {
    remoteItems: [{ id: idBaru, title: 'Event Baru' }],
    remoteTotalCount: 2,
    tombstones: graves
  })
  assert.deepEqual(hasil.map(e => e.id), [idBaru], 'event baru tidak boleh ikut tersaring')
})

test('nisan tidak pernah dibatalkan hanya karena perangkat lain belum tahu', () => {
  const perangkatA = markTombstone({}, 'competitions', 'CMP-1')
  markTombstoneSynced(perangkatA, 'competitions', 'CMP-1')
  const perangkatB = {}
  const gabung = mergeTombstoneMaps(perangkatB, perangkatA)
  assert.equal(isTombstoned('competitions', 'CMP-1', gabung), true)
})
