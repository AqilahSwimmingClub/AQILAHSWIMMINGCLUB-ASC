// Regresi: data yang sudah dihapus tidak boleh hidup kembali.
// Setiap test di bawah ini mewakili satu jalur nyata yang dulu menghidupkan
// kembali pendaftar baru / event / record lain setelah reload atau sinkronisasi.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  markTombstone, clearTombstone, isTombstoned, mergeTombstoneMaps, withoutTombstoned,
  purgeTombstoned, resurrectedIds, pendingTombstoneIds, markTombstoneSynced,
  mergeStateWithoutLoss, mergeCollection, resolveCollectionFromSources, recordIdentity
} from '../src/lib/sync-merge.js'

const REG = { id: 'REG-1', name: 'Calon Atlet', status: 'pending' }
const EVENT = { id: 'CMP-1', title: 'Kejuaraan Daerah', eventDate: '2026-10-01' }

test('nisan menandai record terhapus dan menyaringnya dari daftar mana pun', () => {
  const graves = markTombstone({}, 'pendingRegistrations', 'REG-1')
  assert.equal(isTombstoned('pendingRegistrations', 'REG-1', graves), true)
  assert.deepEqual(withoutTombstoned('pendingRegistrations', [REG], graves), [])
})

test('pendaftar baru yang dihapus tidak kembali dari fallback payload legacy', () => {
  // Inilah bug aslinya: tabel asc_registrations sudah kosong, tetapi salinan beku
  // di class_app_data masih memuat pendaftar tersebut dan dipakai sebagai fallback.
  const graves = markTombstone({}, 'pendingRegistrations', 'REG-1')
  const hasil = resolveCollectionFromSources('pendingRegistrations', {
    remoteItems: [],
    remoteTotalCount: 0,
    legacyFallback: [REG],
    deviceItems: [],
    tombstones: graves
  })
  assert.deepEqual(hasil, [])
})

test('event yang dihapus tidak kembali dari fallback payload legacy', () => {
  const graves = markTombstone({}, 'competitions', 'CMP-1')
  const hasil = resolveCollectionFromSources('competitions', {
    remoteItems: [],
    remoteTotalCount: 0,
    legacyFallback: [EVENT],
    deviceItems: [EVENT],
    tombstones: graves
  })
  assert.deepEqual(hasil, [])
})

test('record terhapus yang masih hidup di tabel Supabase tetap disaring', () => {
  // Penghapusan gagal terkirim: baris masih deleted_at NULL di server.
  const graves = markTombstone({}, 'competitions', 'CMP-1')
  const lain = { id: 'CMP-2', title: 'Event Lain' }
  const hasil = resolveCollectionFromSources('competitions', {
    remoteItems: [EVENT, lain],
    remoteTotalCount: 2,
    tombstones: graves
  })
  assert.deepEqual(hasil, [lain])
})

test('record bernisan yang masih hidup di server terdeteksi untuk dihapus ulang', () => {
  const graves = markTombstone({}, 'competitions', 'CMP-1')
  assert.deepEqual(resurrectedIds('competitions', [EVENT, { id: 'CMP-2' }], graves), ['CMP-1'])
  assert.deepEqual(resurrectedIds('competitions', [{ id: 'CMP-2' }], graves), [])
})

test('nisan baru berstatus belum tersinkron sampai Supabase mengonfirmasi', () => {
  const graves = markTombstone({}, 'invoices', 'INV-1')
  assert.deepEqual(pendingTombstoneIds('invoices', graves), ['INV-1'])
  markTombstoneSynced(graves, 'invoices', 'INV-1', '2026-09-15T00:00:00.000Z')
  assert.deepEqual(pendingTombstoneIds('invoices', graves), [])
  // Record tetap terhapus setelah tersinkron.
  assert.equal(isTombstoned('invoices', 'INV-1', graves), true)
})

test('penggabungan nisan tidak pernah membatalkan penghapusan perangkat lain', () => {
  const hpA = markTombstone({}, 'competitions', 'CMP-1')
  const hpB = {}
  const merged = mergeTombstoneMaps(hpB, hpA, {})
  assert.equal(isTombstoned('competitions', 'CMP-1', merged), true)
})

test('status tersinkron bertahan saat nisan dari dua perangkat digabung', () => {
  const tersinkron = markTombstone({}, 'competitions', 'CMP-1')
  markTombstoneSynced(tersinkron, 'competitions', 'CMP-1', '2026-09-15T00:00:00.000Z')
  const belum = markTombstone({}, 'competitions', 'CMP-1')
  const merged = mergeTombstoneMaps(tersinkron, belum)
  assert.deepEqual(pendingTombstoneIds('competitions', merged), [])
})

test('mergeCollection tidak memasukkan kembali record bernisan dari sisi mana pun', () => {
  const graves = { 'CMP-1': { deletedAt: 'x' } }
  assert.deepEqual(mergeCollection([EVENT], [EVENT], graves), [])
  assert.deepEqual(mergeCollection([EVENT], [], graves), [])
  assert.deepEqual(mergeCollection([], [EVENT], graves), [])
})

test('payload yang dikirim ke Supabase sudah bersih dari record terhapus', () => {
  // Sebelum perbaikan, salinan legacy tetap memuat event terhapus sehingga
  // perangkat lain terus menghidupkannya kembali.
  const remote = { competitions: [EVENT], pendingRegistrations: [REG], __tombstones: {} }
  const local = {
    competitions: [],
    pendingRegistrations: [],
    __tombstones: markTombstone(markTombstone({}, 'competitions', 'CMP-1'), 'pendingRegistrations', 'REG-1')
  }
  const snapshot = mergeStateWithoutLoss(remote, local, {
    defaultState: { competitions: [], pendingRegistrations: [] },
    persistentCollections: ['competitions', 'pendingRegistrations'],
    clientId: 'device-a'
  })
  assert.deepEqual(snapshot.competitions, [])
  assert.deepEqual(snapshot.pendingRegistrations, [])
})

test('data yang tidak dihapus tetap aman saat digabung (tidak ada reset data)', () => {
  const remote = { athletes: [{ id: 'ASC-1', name: 'A' }], __tombstones: {} }
  const local = { athletes: [{ id: 'ASC-2', name: 'B' }], __tombstones: {} }
  const snapshot = mergeStateWithoutLoss(remote, local, {
    defaultState: { athletes: [] },
    persistentCollections: ['athletes'],
    clientId: 'device-a'
  })
  assert.deepEqual(snapshot.athletes.map(a => a.id).sort(), ['ASC-1', 'ASC-2'])
})

test('perubahan lokal menimpa versi lama server untuk record yang sama', () => {
  const remote = { athletes: [{ id: 'ASC-1', name: 'Lama' }], __tombstones: {} }
  const local = { athletes: [{ id: 'ASC-1', name: 'Baru' }], __tombstones: {} }
  const snapshot = mergeStateWithoutLoss(remote, local, {
    defaultState: { athletes: [] },
    persistentCollections: ['athletes'],
    clientId: 'device-a'
  })
  assert.deepEqual(snapshot.athletes, [{ id: 'ASC-1', name: 'Baru' }])
})

test('purgeTombstoned membersihkan seluruh koleksi sekaligus', () => {
  const state = {
    competitions: [EVENT, { id: 'CMP-2' }],
    pendingRegistrations: [REG],
    athletes: [{ id: 'ASC-1' }],
    __tombstones: markTombstone(markTombstone({}, 'competitions', 'CMP-1'), 'pendingRegistrations', 'REG-1')
  }
  purgeTombstoned(state, state.__tombstones)
  assert.deepEqual(state.competitions, [{ id: 'CMP-2' }])
  assert.deepEqual(state.pendingRegistrations, [])
  assert.deepEqual(state.athletes, [{ id: 'ASC-1' }])
})

test('pendaftaran baru dengan ID yang sama boleh dibuat setelah nisan dicabut', () => {
  const graves = markTombstone({}, 'pendingRegistrations', 'REG-1')
  clearTombstone(graves, 'pendingRegistrations', 'REG-1')
  assert.equal(isTombstoned('pendingRegistrations', 'REG-1', graves), false)
  assert.deepEqual(withoutTombstoned('pendingRegistrations', [REG], graves), [REG])
})

test('record tanpa id dikenali lewat identitas gabungannya', () => {
  const absen = { athleteId: 'ASC-1', date: '2026-09-15', type: 'hadir' }
  const identity = recordIdentity(absen)
  assert.equal(identity, 'ASC-1|2026-09-15|hadir')
  const graves = markTombstone({}, 'attendance', identity)
  assert.deepEqual(withoutTombstoned('attendance', [absen], graves), [])
})

test('gangguan jaringan tidak menghapus data perangkat', () => {
  // Tabel gagal dibaca dan fallback kosong: data perangkat dipertahankan.
  const hasil = resolveCollectionFromSources('competitions', {
    remoteItems: [],
    remoteError: new Error('jaringan putus'),
    remoteTotalCount: null,
    legacyFallback: [],
    deviceItems: [EVENT],
    tombstones: {}
  })
  assert.deepEqual(hasil, [EVENT])
})

test('tabel yang benar-benar kosong mengosongkan daftar, bukan memakai fallback lama', () => {
  const hasil = resolveCollectionFromSources('invoices', {
    remoteItems: [],
    remoteTotalCount: 3,
    legacyFallback: [{ id: 'INV-lama' }],
    deviceItems: [{ id: 'INV-lama' }],
    tombstones: {}
  })
  assert.deepEqual(hasil, [])
})

// ---------------------------------------------------------------------------
// Simulasi dua perangkat: persis skenario yang dilaporkan pengguna.
// HP menghapus pendaftar/event, lalu website memuat ulang dan sinkron.
// ---------------------------------------------------------------------------

// Meniru langkah-langkah nyata: hapus di perangkat, kirim payload ke server,
// lalu perangkat kedua memuat payload itu bersama fallback legacy-nya.
function hapusDiPerangkat(state, collection, id) {
  markTombstone(state.__tombstones, collection, id)
  state[collection] = state[collection].filter(item => String(item.id) !== String(id))
  return state
}

function muatDiPerangkatLain(perangkat, payloadServer, { remoteItems = [], remoteTotalCount = null } = {}) {
  // Nisan dari payload server diadopsi lebih dulu (adoptTombstones di main.js).
  perangkat.__tombstones = mergeTombstoneMaps(perangkat.__tombstones, payloadServer.__tombstones)
  const keys = new Set([...Object.keys(remoteItems), 'competitions', 'pendingRegistrations'])
  keys.forEach(key => {
    if (!Array.isArray(payloadServer[key]) && !Array.isArray(perangkat[key])) return
    perangkat[key] = resolveCollectionFromSources(key, {
      remoteItems: remoteItems[key] || [],
      remoteTotalCount,
      legacyFallback: payloadServer[key] || [],
      deviceItems: perangkat[key] || [],
      tombstones: perangkat.__tombstones
    })
  })
  return perangkat
}

test('dua perangkat: pendaftar baru yang dihapus di HP tidak muncul lagi di website', () => {
  const server = { pendingRegistrations: [REG], competitions: [], __tombstones: {} }
  const hp = { pendingRegistrations: [REG], competitions: [], __tombstones: {} }
  const website = { pendingRegistrations: [REG], competitions: [], __tombstones: {} }

  hapusDiPerangkat(hp, 'pendingRegistrations', 'REG-1')

  // HP menyimpan ke Supabase: payload bersama ikut dibersihkan.
  const payloadBaru = mergeStateWithoutLoss(server, hp, {
    defaultState: { pendingRegistrations: [], competitions: [] },
    persistentCollections: ['pendingRegistrations', 'competitions'],
    clientId: 'hp'
  })
  assert.deepEqual(payloadBaru.pendingRegistrations, [], 'payload server masih memuat pendaftar terhapus')

  // Website memuat ulang: tabel asc_registrations sudah kosong.
  muatDiPerangkatLain(website, payloadBaru, { remoteItems: { pendingRegistrations: [] }, remoteTotalCount: 1 })
  assert.deepEqual(website.pendingRegistrations, [], 'pendaftar terhapus muncul kembali di website')
  assert.equal(isTombstoned('pendingRegistrations', 'REG-1', website.__tombstones), true)
})

test('dua perangkat: event yang dihapus tidak muncul lagi setelah reload', () => {
  const server = { competitions: [EVENT], pendingRegistrations: [], __tombstones: {} }
  const hp = { competitions: [EVENT], pendingRegistrations: [], __tombstones: {} }
  const website = { competitions: [EVENT], pendingRegistrations: [], __tombstones: {} }

  hapusDiPerangkat(hp, 'competitions', 'CMP-1')
  const payloadBaru = mergeStateWithoutLoss(server, hp, {
    defaultState: { competitions: [], pendingRegistrations: [] },
    persistentCollections: ['competitions', 'pendingRegistrations'],
    clientId: 'hp'
  })

  // Kasus terburuk: tabel asc_competitions gagal dibaca, jadi fallback legacy dipakai.
  muatDiPerangkatLain(website, payloadBaru, { remoteItems: { competitions: [] }, remoteTotalCount: null })
  assert.deepEqual(website.competitions, [], 'event terhapus muncul kembali di perangkat lain')
})

test('dua perangkat: penghapusan tidak ikut menghapus data perangkat lain', () => {
  const EVENT_B = { id: 'CMP-9', title: 'Event dari website' }
  const server = { competitions: [EVENT], pendingRegistrations: [], __tombstones: {} }
  const hp = { competitions: [EVENT], pendingRegistrations: [], __tombstones: {} }
  hapusDiPerangkat(hp, 'competitions', 'CMP-1')

  // Sementara itu website membuat event baru.
  const website = { competitions: [EVENT, EVENT_B], pendingRegistrations: [], __tombstones: {} }
  const payloadHp = mergeStateWithoutLoss(server, hp, {
    defaultState: { competitions: [], pendingRegistrations: [] },
    persistentCollections: ['competitions', 'pendingRegistrations'],
    clientId: 'hp'
  })
  const gabungan = mergeStateWithoutLoss(payloadHp, website, {
    defaultState: { competitions: [], pendingRegistrations: [] },
    persistentCollections: ['competitions', 'pendingRegistrations'],
    clientId: 'website'
  })
  // Yang dihapus tetap hilang, yang baru tetap selamat: tidak ada reset data.
  assert.deepEqual(gabungan.competitions.map(e => e.id), ['CMP-9'])
})
