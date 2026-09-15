// Regresi audit B1: nisan penghapusan TIDAK boleh dianggap tersinkron kalau
// Supabase belum benar-benar menerimanya. Kalau dianggap tersinkron, retry
// berhenti dan record bisa hidup kembali di perangkat lain.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  markTombstone, pendingTombstoneIds, isTombstoned,
  commitTombstone, TombstoneWriteError
} from '../src/lib/sync-merge.js'

// Supabase palsu yang dapat diatur: berapa baris yang ter-update dan apakah
// penulisan baris nisan berhasil.
function supabasePalsu({ rows = 0, updateError = null, insertError = null } = {}) {
  const jejak = { update: 0, insert: 0, antrean: [] }
  return {
    jejak,
    opsi: {
      updateDeletedAt: async () => { jejak.update++; return { rows, error: updateError } },
      insertTombstoneRow: async () => { jejak.insert++; return { error: insertError } },
      queueRetry: (collection, id) => jejak.antrean.push(`${collection}:${id}`)
    }
  }
}

test('UPDATE mengenai baris: nisan ditandai tersinkron', async () => {
  const graves = markTombstone({}, 'competitions', 'CMP-1')
  const fake = supabasePalsu({ rows: 1 })
  const hasil = await commitTombstone('competitions', 'CMP-1', { ...fake.opsi, tombstones: graves })
  assert.equal(hasil, true)
  assert.deepEqual(pendingTombstoneIds('competitions', graves), [])
  assert.equal(fake.jejak.insert, 0, 'baris nisan tidak perlu dibuat bila UPDATE berhasil')
  assert.deepEqual(fake.jejak.antrean, [])
})

test('UPDATE nol baris lalu baris nisan berhasil dibuat: tersinkron', async () => {
  // Record hanya hidup di payload legacy, jadi UPDATE tidak menemukan baris.
  const graves = markTombstone({}, 'pendingRegistrations', 'REG-1')
  const fake = supabasePalsu({ rows: 0, insertError: null })
  await commitTombstone('pendingRegistrations', 'REG-1', { ...fake.opsi, tombstones: graves })
  assert.equal(fake.jejak.insert, 1, 'baris nisan harus dibuat saat UPDATE nol baris')
  assert.deepEqual(pendingTombstoneIds('pendingRegistrations', graves), [])
})

test('UPDATE nol baris dan UPSERT gagal: nisan TETAP pending, bukan tersinkron', async () => {
  // Inilah bug audit: dulu hanya warning, lalu tetap ditandai tersinkron.
  const graves = markTombstone({}, 'competitions', 'CMP-1')
  const fake = supabasePalsu({ rows: 0, insertError: new Error('null value in column "direction"') })

  await assert.rejects(
    () => commitTombstone('competitions', 'CMP-1', { ...fake.opsi, tombstones: graves }),
    TombstoneWriteError,
    'kegagalan menulis nisan harus dilaporkan sebagai error'
  )

  assert.deepEqual(pendingTombstoneIds('competitions', graves), ['CMP-1'],
    'nisan yang gagal ditulis harus tetap berstatus pending')
  assert.deepEqual(fake.jejak.antrean, ['competitions:CMP-1'],
    'penghapusan yang gagal harus masuk antrean retry')
  // Record tetap terhapus di perangkat ini walau sinkronisasinya tertunda.
  assert.equal(isTombstoned('competitions', 'CMP-1', graves), true)
})

test('UPDATE error: nisan tetap pending dan masuk antrean retry', async () => {
  const graves = markTombstone({}, 'invoices', 'INV-1')
  const fake = supabasePalsu({ rows: 0, updateError: new Error('jaringan putus') })
  await assert.rejects(
    () => commitTombstone('invoices', 'INV-1', { ...fake.opsi, tombstones: graves }),
    TombstoneWriteError
  )
  assert.equal(fake.jejak.insert, 0, 'jangan mencoba membuat baris nisan bila UPDATE error')
  assert.deepEqual(pendingTombstoneIds('invoices', graves), ['INV-1'])
  assert.deepEqual(fake.jejak.antrean, ['invoices:INV-1'])
})

test('retry setelah kegagalan: percobaan kedua berhasil dan menandai tersinkron', async () => {
  const graves = markTombstone({}, 'competitions', 'CMP-1')

  // Percobaan pertama: Supabase menolak baris nisan.
  const gagal = supabasePalsu({ rows: 0, insertError: new Error('Supabase tidak tersedia') })
  await assert.rejects(() => commitTombstone('competitions', 'CMP-1', { ...gagal.opsi, tombstones: graves }))
  assert.deepEqual(pendingTombstoneIds('competitions', graves), ['CMP-1'])

  // Percobaan kedua saat Supabase kembali normal.
  const berhasil = supabasePalsu({ rows: 0, insertError: null })
  const hasil = await commitTombstone('competitions', 'CMP-1', { ...berhasil.opsi, tombstones: graves })
  assert.equal(hasil, true)
  assert.deepEqual(pendingTombstoneIds('competitions', graves), [],
    'setelah retry berhasil, nisan baru boleh dianggap tersinkron')
  assert.deepEqual(berhasil.jejak.antrean, [], 'retry yang berhasil tidak mengantre lagi')
})

test('error membawa koleksi dan ID supaya dapat dicoba ulang dengan tepat', async () => {
  const graves = markTombstone({}, 'competitions', 'CMP-7')
  const fake = supabasePalsu({ rows: 0, insertError: new Error('gagal') })
  await assert.rejects(
    () => commitTombstone('competitions', 'CMP-7', { ...fake.opsi, tombstones: graves }),
    error => {
      assert.equal(error.collection, 'competitions')
      assert.equal(error.recordId, 'CMP-7')
      assert.match(error.message, /akan dicoba ulang/)
      return true
    }
  )
})

test('banyak penghapusan gagal: semuanya tetap pending dan terantre', async () => {
  let graves = {}
  for (const id of ['CMP-1', 'CMP-2', 'CMP-3']) graves = markTombstone(graves, 'competitions', id)
  const antrean = []
  for (const id of ['CMP-1', 'CMP-2', 'CMP-3']) {
    await assert.rejects(() => commitTombstone('competitions', id, {
      tombstones: graves,
      updateDeletedAt: async () => ({ rows: 0, error: null }),
      insertTombstoneRow: async () => ({ error: new Error('offline') }),
      queueRetry: (c, i) => antrean.push(`${c}:${i}`)
    }))
  }
  assert.deepEqual(pendingTombstoneIds('competitions', graves).sort(), ['CMP-1', 'CMP-2', 'CMP-3'])
  assert.deepEqual(antrean, ['competitions:CMP-1', 'competitions:CMP-2', 'competitions:CMP-3'])
})
