// Penggantian berkas yang tidak pernah membuat pengguna kehilangan dokumen.
//
// Urutannya menentukan segalanya. Yang berbahaya adalah menghapus berkas lama
// lebih dulu lalu mengunggah yang baru: begitu koneksi putus di tengah, Akta
// atau Bukti Pembayaran hilang dan tidak ada cara memulihkannya.
//
// Urutan aman yang dipakai di sini:
//   1. proses dan unggah berkas BARU
//   2. pastikan unggahan berhasil
//   3. perbarui reference di basis data
//   4. pastikan pembaruan berhasil
//   5. baru berkas lama boleh dibersihkan
//
// Pada kegagalan langkah mana pun, reference LAMA tetap aktif. Berkas lama
// tidak pernah disentuh sebelum langkah 4 benar-benar selesai.

// --- Alamat objek storage ---------------------------------------------------

// Mengambil object key dari URL publik Supabase Storage.
//
// Bentuknya: .../storage/v1/object/public/<bucket>/<path...>
// Penghapusan memakai key ini, bukan potongan string sembarangan, supaya tidak
// pernah salah sasaran. URL yang tidak berbentuk demikian mengembalikan '',
// dan berkasnya sengaja TIDAK dihapus - lebih baik menyisakan berkas yatim
// daripada menghapus sesuatu yang salah.
export function objectKeyDariUrl(url, bucket) {
  const teks = String(url || '')
  const namaBucket = String(bucket || '')
  if (!teks || !namaBucket) return ''
  const penanda = `/storage/v1/object/public/${namaBucket}/`
  const posisi = teks.indexOf(penanda)
  if (posisi === -1) return ''
  const key = teks.slice(posisi + penanda.length).split('?')[0]
  if (!key || key.includes('..')) return ''
  try { return decodeURIComponent(key) } catch { return key }
}

// Apakah sebuah URL masih dipakai record lain?
//
// Berkas hanya boleh dihapus bila tidak ada satu pun reference tersisa.
// `referensiLain` adalah seluruh nilai URL yang masih tersimpan di state
// setelah pembaruan, tanpa nilai yang baru saja digantikan.
export function masihDipakai(url, referensiLain) {
  const target = String(url || '')
  if (!target) return false
  return (Array.isArray(referensiLain) ? referensiLain : []).some(x => String(x || '') === target)
}

// --- Perencanaan penggantian ------------------------------------------------

export const HASIL_TIDAK_BERUBAH = 'tidak-berubah'
export const HASIL_DIGANTI = 'diganti'
export const HASIL_GAGAL_UNGGAH = 'gagal-unggah'
export const HASIL_GAGAL_SIMPAN = 'gagal-simpan'

// Mengganti berkas dengan urutan aman.
//
// Parameter berupa fungsi supaya modul ini dapat diuji tanpa jaringan:
//   unggah()        -> mengembalikan URL berkas baru, atau melempar galat
//   simpanReference(urlBaru) -> menyimpan ke basis data, atau melempar galat
//   hapusBerkas(url)         -> membersihkan satu berkas (opsional)
//   bolehHapusLama(urlLama)  -> penjaga terakhir sebelum berkas lama dihapus
//
// Mengembalikan { hasil, url, galat, dibersihkan } dan TIDAK PERNAH melempar:
// pemanggil selalu memperoleh URL yang harus dipakai, termasuk saat gagal.
export async function gantiBerkas({
  berkasBaru,
  urlLama = '',
  unggah,
  simpanReference,
  hapusBerkas = null,
  bolehHapusLama = () => false
} = {}) {
  // Tidak ada berkas baru: apa pun yang terjadi, yang lama tetap dipakai.
  if (!berkasBaru || !berkasBaru.size) {
    return { hasil: HASIL_TIDAK_BERUBAH, url: urlLama, galat: null, dibersihkan: [] }
  }

  // Langkah 1-2: unggah berkas baru lebih dulu.
  let urlBaru = ''
  try {
    urlBaru = await unggah(berkasBaru)
    if (!urlBaru) throw new Error('Alamat berkas hasil unggah tidak tersedia.')
  } catch (galat) {
    // Berkas lama tidak disentuh sama sekali.
    return { hasil: HASIL_GAGAL_UNGGAH, url: urlLama, galat, dibersihkan: [] }
  }

  // Langkah 3-4: simpan reference baru.
  try {
    await simpanReference(urlBaru)
  } catch (galat) {
    // Unggahan berhasil tetapi tidak jadi dipakai. Berkas BARU itulah yang
    // yatim, jadi hanya berkas baru yang dibersihkan - berkas lama masih
    // menjadi reference aktif dan tidak boleh disentuh.
    const dibersihkan = []
    if (hapusBerkas) {
      try { await hapusBerkas(urlBaru); dibersihkan.push(urlBaru) } catch { /* diabaikan */ }
    }
    return { hasil: HASIL_GAGAL_SIMPAN, url: urlLama, galat, dibersihkan }
  }

  // Langkah 5: barulah berkas lama boleh dibersihkan.
  const dibersihkan = []
  if (hapusBerkas && urlLama && urlLama !== urlBaru) {
    let boleh = false
    try { boleh = await bolehHapusLama(urlLama) } catch { boleh = false }
    if (boleh) {
      try { await hapusBerkas(urlLama); dibersihkan.push(urlLama) } catch { /* diabaikan */ }
    }
  }

  return { hasil: HASIL_DIGANTI, url: urlBaru, galat: null, dibersihkan }
}
