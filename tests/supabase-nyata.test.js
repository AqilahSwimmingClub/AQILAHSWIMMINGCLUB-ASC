// Pengujian sinkronisasi NYATA terhadap Supabase.
//
// Tes ini hanya berjalan bila kredensial lingkungan pengujian tersedia:
//   ASC_TEST_SUPABASE_URL dan ASC_TEST_SUPABASE_KEY
// Tanpa keduanya, tes ini DILEWATI dengan jelas. Tidak ada hasil yang dikarang:
// bila dilewati, artinya pengujian backend nyata memang belum dilakukan.
//
// Keamanan data:
//   - seluruh record memakai prefix unik E2E-ASC-<timestamp>-<acak>;
//   - tidak ada data pengguna sungguhan yang dibaca, diubah, atau dihapus;
//   - pembersihan dijalankan di blok finally, termasuk ketika tes gagal.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.ASC_TEST_SUPABASE_URL || ''
const KEY = process.env.ASC_TEST_SUPABASE_KEY || ''
const ADA_KREDENSIAL = Boolean(URL && KEY)
const ALASAN_LEWAT =
  'Kredensial Supabase pengujian tidak tersedia (ASC_TEST_SUPABASE_URL / ASC_TEST_SUPABASE_KEY). ' +
  'Pengujian backend nyata BELUM DILAKUKAN.'

// Prefix unik per proses: tidak mungkin bertabrakan dengan data sungguhan.
const PREFIX = `E2E-ASC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const idUji = (bagian) => `${PREFIX}-${bagian}`

// Dua klien terpisah meniru dua perangkat berbeda.
const buatKlien = () => ADA_KREDENSIAL
  ? createClient(URL, KEY, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 1 } } })
  : null

const TABEL = {
  competitions: 'asc_competitions',
  pendingRegistrations: 'asc_registrations',
  financeTransactions: 'asc_finance_transactions'
}

// Baris minimal per tabel. Kolom wajib (mis. direction) ikut diisi.
function barisUji(koleksi, id) {
  const now = new Date().toISOString()
  const dasar = { legacy_id: id, data: { id, uji: true, prefix: PREFIX }, deleted_at: null, updated_at: now }
  if (koleksi === 'competitions') return { ...dasar, title: `${PREFIX} Event Uji`, fee_per_race: 0 }
  if (koleksi === 'financeTransactions') {
    return { ...dasar, direction: 'income', amount: 0, transaction_date: now, category: 'UJI', description: `${PREFIX} transaksi uji` }
  }
  return dasar
}

// Hapus seluruh jejak pengujian, apa pun yang terjadi sebelumnya.
async function bersihkan(klien, dibuat) {
  const gagal = []
  for (const [koleksi, id] of dibuat) {
    try {
      const { error } = await klien.from(TABEL[koleksi]).delete().eq('legacy_id', id)
      if (error) gagal.push(`${TABEL[koleksi]}:${id} -> ${error.message}`)
    } catch (error) { gagal.push(`${TABEL[koleksi]}:${id} -> ${error?.message || error}`) }
  }
  if (gagal.length) console.warn('Sebagian data uji belum terhapus:\n' + gagal.join('\n'))
  return gagal
}

test('Supabase nyata: create -> perangkat kedua membaca -> delete -> tetap hilang', {
  skip: ADA_KREDENSIAL ? false : ALASAN_LEWAT
}, async () => {
  const perangkatA = buatKlien()
  const perangkatB = buatKlien()
  const dibuat = []
  try {
    for (const koleksi of Object.keys(TABEL)) {
      const id = idUji(koleksi)
      const tabel = TABEL[koleksi]

      // 1) Perangkat A membuat record.
      const { error: errBuat } = await perangkatA.from(tabel).upsert(barisUji(koleksi, id), { onConflict: 'legacy_id' })
      assert.equal(errBuat, null, `${tabel}: gagal membuat record uji: ${errBuat?.message || ''}`)
      dibuat.push([koleksi, id])

      // 2) Perangkat kedua membacanya (hanya yang belum terhapus).
      const { data: terbaca, error: errBaca } = await perangkatB.from(tabel)
        .select('legacy_id').eq('legacy_id', id).is('deleted_at', null)
      assert.equal(errBaca, null, `${tabel}: gagal dibaca perangkat kedua`)
      assert.equal(terbaca?.length, 1, `${tabel}: perangkat kedua tidak melihat record baru`)

      // 3) Perangkat A menghapus (soft delete, sama seperti aplikasi).
      const hapusPada = new Date().toISOString()
      const { data: terhapus, error: errHapus } = await perangkatA.from(tabel)
        .update({ deleted_at: hapusPada, updated_at: hapusPada }).eq('legacy_id', id).select('legacy_id')
      assert.equal(errHapus, null, `${tabel}: gagal menghapus record uji`)
      assert.equal(terhapus?.length, 1, `${tabel}: penghapusan tidak mengenai baris mana pun`)

      // 4) Perangkat kedua memuat ulang: record harus tetap hilang.
      const { data: setelahHapus, error: errUlang } = await perangkatB.from(tabel)
        .select('legacy_id').eq('legacy_id', id).is('deleted_at', null)
      assert.equal(errUlang, null, `${tabel}: gagal memuat ulang`)
      assert.equal(setelahHapus?.length, 0, `${tabel}: record yang dihapus muncul kembali di perangkat kedua`)

      // 5) Menyimpan ulang record bernisan TIDAK boleh menghidupkannya. Aplikasi
      //    mencegahnya lewat refuseTombstonedWrite(); di sini dipastikan bahwa
      //    baris tersebut memang masih bertanda terhapus di server.
      const { data: masihTerhapus } = await perangkatB.from(tabel)
        .select('legacy_id,deleted_at').eq('legacy_id', id).maybeSingle()
      assert.ok(masihTerhapus?.deleted_at, `${tabel}: deleted_at hilang setelah dibaca ulang`)
    }
  } finally {
    // Pembersihan selalu dijalankan, termasuk ketika assertion di atas gagal.
    await bersihkan(perangkatA, dibuat)
  }
})

test('Supabase nyata: seluruh data uji sudah terhapus setelah pengujian', {
  skip: ADA_KREDENSIAL ? false : ALASAN_LEWAT
}, async () => {
  const klien = buatKlien()
  for (const tabel of Object.values(TABEL)) {
    const { data, error } = await klien.from(tabel).select('legacy_id').like('legacy_id', `${PREFIX}%`)
    assert.equal(error, null, `${tabel}: gagal memverifikasi pembersihan`)
    assert.equal(data?.length || 0, 0, `${tabel}: masih ada sisa data uji ${PREFIX}`)
  }
})

test('status pengujian backend nyata dilaporkan apa adanya', () => {
  if (!ADA_KREDENSIAL) {
    console.log(`[Supabase nyata] DILEWATI — ${ALASAN_LEWAT}`)
  } else {
    console.log(`[Supabase nyata] DIJALANKAN dengan prefix data uji ${PREFIX}`)
  }
  // Tes ini sengaja selalu lulus: tugasnya hanya membuat status terlihat jelas
  // di keluaran, supaya tidak ada yang mengira backend sudah diuji padahal belum.
  assert.ok(true)
})
