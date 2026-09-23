// Penggantian Foto, Akta, dan Bukti Pembayaran.
//
// Satu hal yang dijaga di sini: pengguna tidak boleh kehilangan dokumen karena
// koneksi putus. Berkas lama hanya boleh disentuh setelah berkas baru benar-
// benar terunggah DAN reference-nya tersimpan.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  gantiBerkas, objectKeyDariUrl, masihDipakai,
  HASIL_TIDAK_BERUBAH, HASIL_DIGANTI, HASIL_GAGAL_UNGGAH, HASIL_GAGAL_SIMPAN
} from '../src/lib/berkas-aman.js'

const BUCKET = 'asc-files'
const URL_LAMA = `https://x.supabase.co/storage/v1/object/public/${BUCKET}/asc/photo/2026-01-01/lama.jpg`
const URL_BARU = `https://x.supabase.co/storage/v1/object/public/${BUCKET}/asc/photo/2026-09-23/baru.jpg`

const berkas = (nama = 'baru.jpg', size = 1234) => ({ name: nama, size, type: 'image/jpeg' })

// --- 25. Unggah gagal -------------------------------------------------------

test('25. unggah berkas baru gagal: berkas lama tetap aktif', async () => {
  const dihapus = []
  const hasil = await gantiBerkas({
    berkasBaru: berkas(),
    urlLama: URL_LAMA,
    unggah: async () => { throw new Error('jaringan putus') },
    simpanReference: async () => { throw new Error('tidak boleh sampai ke sini') },
    hapusBerkas: async url => { dihapus.push(url) },
    bolehHapusLama: () => true
  })

  assert.equal(hasil.hasil, HASIL_GAGAL_UNGGAH)
  assert.equal(hasil.url, URL_LAMA, 'reference lama harus dipertahankan')
  assert.deepEqual(dihapus, [], 'tidak boleh menghapus apa pun')
  assert.match(hasil.galat.message, /jaringan putus/)
})

test('25b. unggah yang tidak mengembalikan URL diperlakukan sebagai gagal', async () => {
  const hasil = await gantiBerkas({
    berkasBaru: berkas(),
    urlLama: URL_LAMA,
    unggah: async () => '',
    simpanReference: async () => {}
  })
  assert.equal(hasil.hasil, HASIL_GAGAL_UNGGAH)
  assert.equal(hasil.url, URL_LAMA)
})

// --- 26. Simpan basis data gagal -------------------------------------------

test('26. simpan reference gagal setelah unggah: berkas lama tetap aktif', async () => {
  const dihapus = []
  const hasil = await gantiBerkas({
    berkasBaru: berkas(),
    urlLama: URL_LAMA,
    unggah: async () => URL_BARU,
    simpanReference: async () => { throw new Error('Supabase menolak') },
    hapusBerkas: async url => { dihapus.push(url) },
    bolehHapusLama: () => true
  })

  assert.equal(hasil.hasil, HASIL_GAGAL_SIMPAN)
  assert.equal(hasil.url, URL_LAMA, 'reference lama harus dipertahankan')
  assert.ok(!dihapus.includes(URL_LAMA), 'berkas lama TIDAK boleh dihapus')
  assert.deepEqual(dihapus, [URL_BARU], 'hanya berkas baru yang yatim yang dibersihkan')
})

test('26b. kegagalan pembersihan berkas yatim tidak membuat operasi ikut gagal', async () => {
  const hasil = await gantiBerkas({
    berkasBaru: berkas(),
    urlLama: URL_LAMA,
    unggah: async () => URL_BARU,
    simpanReference: async () => { throw new Error('gagal simpan') },
    hapusBerkas: async () => { throw new Error('gagal hapus juga') },
    bolehHapusLama: () => true
  })
  assert.equal(hasil.hasil, HASIL_GAGAL_SIMPAN)
  assert.equal(hasil.url, URL_LAMA)
})

// --- 27. Penggantian berhasil ----------------------------------------------

test('27. penggantian berhasil: reference baru aktif, berkas lama dibersihkan', async () => {
  const urutan = []
  const hasil = await gantiBerkas({
    berkasBaru: berkas(),
    urlLama: URL_LAMA,
    unggah: async () => { urutan.push('unggah'); return URL_BARU },
    simpanReference: async url => { urutan.push(`simpan:${url}`) },
    hapusBerkas: async url => { urutan.push(`hapus:${url}`) },
    bolehHapusLama: () => true
  })

  assert.equal(hasil.hasil, HASIL_DIGANTI)
  assert.equal(hasil.url, URL_BARU)
  assert.deepEqual(urutan, ['unggah', `simpan:${URL_BARU}`, `hapus:${URL_LAMA}`],
    'urutan wajib: unggah -> simpan -> baru hapus')
})

test('27b. berkas lama yang masih dipakai record lain TIDAK dihapus', async () => {
  const dihapus = []
  const hasil = await gantiBerkas({
    berkasBaru: berkas(),
    urlLama: URL_LAMA,
    unggah: async () => URL_BARU,
    simpanReference: async () => {},
    hapusBerkas: async url => { dihapus.push(url) },
    bolehHapusLama: url => !masihDipakai(url, [URL_LAMA])
  })
  assert.equal(hasil.hasil, HASIL_DIGANTI)
  assert.equal(hasil.url, URL_BARU)
  assert.deepEqual(dihapus, [], 'reference aktif milik record lain tidak boleh dihapus')
})

test('27c. tanpa berkas baru, tidak ada yang berubah dan tidak ada yang dihapus', async () => {
  const dihapus = []
  for (const kosong of [null, undefined, { size: 0 }]) {
    const hasil = await gantiBerkas({
      berkasBaru: kosong,
      urlLama: URL_LAMA,
      unggah: async () => { throw new Error('tidak boleh dipanggil') },
      simpanReference: async () => { throw new Error('tidak boleh dipanggil') },
      hapusBerkas: async url => { dihapus.push(url) }
    })
    assert.equal(hasil.hasil, HASIL_TIDAK_BERUBAH)
    assert.equal(hasil.url, URL_LAMA)
  }
  assert.deepEqual(dihapus, [])
})

test('27d. tanpa berkas lama, penggantian tetap berjalan tanpa penghapusan', async () => {
  const dihapus = []
  const hasil = await gantiBerkas({
    berkasBaru: berkas(),
    urlLama: '',
    unggah: async () => URL_BARU,
    simpanReference: async () => {},
    hapusBerkas: async url => { dihapus.push(url) },
    bolehHapusLama: () => true
  })
  assert.equal(hasil.url, URL_BARU)
  assert.deepEqual(dihapus, [])
})

// --- Alamat objek storage ---------------------------------------------------

test('object key diambil dari URL publik Supabase, bukan potongan string asal', () => {
  assert.equal(objectKeyDariUrl(URL_LAMA, BUCKET), 'asc/photo/2026-01-01/lama.jpg')
  assert.equal(objectKeyDariUrl(`${URL_LAMA}?t=1`, BUCKET), 'asc/photo/2026-01-01/lama.jpg')
})

test('URL yang bentuknya tidak dikenali tidak menghasilkan key', () => {
  // Lebih baik menyisakan berkas yatim daripada menghapus objek yang salah.
  for (const buruk of ['', 'https://contoh.com/foto.jpg', 'bukan-url', null]) {
    assert.equal(objectKeyDariUrl(buruk, BUCKET), '')
  }
  assert.equal(objectKeyDariUrl(URL_LAMA, 'bucket-lain'), '')
  assert.equal(objectKeyDariUrl(URL_LAMA, ''), '')
})

test('key yang memuat .. ditolak', () => {
  const jahat = `https://x.supabase.co/storage/v1/object/public/${BUCKET}/../rahasia.jpg`
  assert.equal(objectKeyDariUrl(jahat, BUCKET), '')
})

test('masihDipakai mengenali reference yang masih aktif', () => {
  assert.equal(masihDipakai(URL_LAMA, [URL_BARU, URL_LAMA]), true)
  assert.equal(masihDipakai(URL_LAMA, [URL_BARU]), false)
  assert.equal(masihDipakai('', [URL_LAMA]), false)
  assert.equal(masihDipakai(URL_LAMA, null), false)
})
