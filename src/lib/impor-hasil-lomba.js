// Import Hasil Perlombaan: dari baris teks PDF menjadi Catatan Waktu.
//
// PDF hanya SUMBER INPUT. Modul ini tidak menyimpan apa pun sendiri: keluarannya
// adalah payload Catatan Waktu dengan bentuk yang sudah dipakai aplikasi, yang
// kemudian masuk lewat state.timeRecords dan jalur simpan yang sama dengan
// input manual. Tidak ada koleksi kedua, tidak ada salinan per-role.
//
// Relasi permanen selalu athleteId. Nama atlet hanya dipakai saat mencocokkan.

// --- Nilai kanonik yang sudah ada di aplikasi --------------------------------
// Diambil apa adanya dari form Catatan Waktu; JANGAN menambah nilai baru.

export const GAYA_KANONIK = Object.freeze([
  'Gaya Bebas', 'Gaya Dada', 'Gaya Punggung', 'Gaya Kupu-kupu',
  'Gaya Ganti Perorangan (IM)', 'Gaya Bebas Fins', 'Gaya Kupu-kupu Fins', 'Gaya Punggung Fins'
])

export const JARAK_KANONIK = Object.freeze([25, 50, 100, 200, 400, 800, 1500])

// Jenis Catatan Waktu yang sudah ada: 'Latihan' dan 'Kejuaraan'.
// Hasil import SELALU Kejuaraan - tidak ada pilihan, dan tidak pernah Latihan.
export const JENIS_IMPOR = 'Kejuaraan'

// Status hasil yang bukan angka waktu. Skema Catatan Waktu tidak punya kolom
// race status, jadi hasil seperti ini TIDAK PERNAH disimpan sebagai waktu -
// dan tidak pernah dijadikan 00.00.00.
export const STATUS_BUKAN_WAKTU = Object.freeze(['DNS', 'DQ', 'DNF', 'DSQ', 'NS', 'WD'])

// --- Normalisasi gaya -------------------------------------------------------

const PETA_GAYA = Object.freeze({
  freestyle: 'Gaya Bebas', free: 'Gaya Bebas', crawl: 'Gaya Bebas', bebas: 'Gaya Bebas',
  breaststroke: 'Gaya Dada', breast: 'Gaya Dada', dada: 'Gaya Dada',
  backstroke: 'Gaya Punggung', back: 'Gaya Punggung', punggung: 'Gaya Punggung',
  butterfly: 'Gaya Kupu-kupu', fly: 'Gaya Kupu-kupu', kupu: 'Gaya Kupu-kupu', 'kupukupu': 'Gaya Kupu-kupu',
  medley: 'Gaya Ganti Perorangan (IM)', im: 'Gaya Ganti Perorangan (IM)', ganti: 'Gaya Ganti Perorangan (IM)',
  'individualmedley': 'Gaya Ganti Perorangan (IM)'
})

function kataKunci(teks) {
  return String(teks || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '')
}

// Gaya dari teks bebas. Mengembalikan '' bila tidak dikenali - tidak pernah
// menebak, dan tidak pernah membuat nama gaya baru.
export function normalkanGaya(mentah) {
  const teks = String(mentah || '')
  if (!teks.trim()) return ''

  const kunci = kataKunci(teks)
  if (!kunci) return ''

  // Cocok persis dengan nilai kanonik lebih dulu.
  for (const gaya of GAYA_KANONIK) {
    if (kataKunci(gaya) === kunci) return gaya
  }

  // Pencocokan dilakukan per KATA, bukan per substring. Substring membuat nama
  // orang seperti "IMRAN" salah dikenali sebagai IM, dan "BACKUP" sebagai
  // punggung. Kata utuh menghindari seluruh kelas kesalahan itu.
  const kata = String(teks)
    .toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().split(/\s+/).filter(Boolean)
  if (!kata.length) return ''

  const pakaiFins = kata.includes('fins') || kata.includes('fin')

  let dasar = ''
  // Bentuk dua kata diperiksa lebih dulu supaya tidak kalah oleh kata tunggal.
  if (kunci.includes('individualmedley')) {
    dasar = { petunjuk: 'individualmedley', gaya: PETA_GAYA.individualmedley }
  }
  if (!dasar) {
    for (const k of kata) {
      const gaya = PETA_GAYA[k]
      if (gaya && (!dasar || k.length > dasar.petunjuk.length)) dasar = { petunjuk: k, gaya }
    }
  }
  if (!dasar) return ''

  if (!pakaiFins) return dasar.gaya
  const denganFins = `${dasar.gaya} Fins`
  return GAYA_KANONIK.includes(denganFins) ? denganFins : dasar.gaya
}

// --- Normalisasi jarak ------------------------------------------------------

// '25 M', '25M', '25 meter', '50m' -> angka kanonik. '' bila di luar daftar.
export function normalkanJarak(mentah) {
  const teks = String(mentah || '')
  const cocok = teks.match(/(\d{2,4})\s*(?:m\b|meter|metre|mtr)?/i)
  if (!cocok) return ''
  const angka = Number(cocok[1])
  return JARAK_KANONIK.includes(angka) ? angka : ''
}

// --- Normalisasi waktu ------------------------------------------------------

// Format kanonik Catatan Waktu adalah MM.SS.CC (dengan titik), sama dengan
// yang dihasilkan form manual. timeToCentiseconds() di aplikasi membaca
// bentuk itu; fungsi di bawah menghasilkan bentuk yang sama persis.
export function normalkanWaktu(mentah) {
  const teks = String(mentah || '').trim().replace(/,/g, '.')
  if (!teks) return ''

  // MM:SS.CC atau MM.SS.CC
  let cocok = teks.match(/^(\d{1,2})[:.](\d{1,2})[:.](\d{1,2})$/)
  if (cocok) {
    const [, m, s, c] = cocok
    if (Number(s) > 59) return ''
    return `${String(Number(m)).padStart(2, '0')}.${String(Number(s)).padStart(2, '0')}.${String(Number(c)).padStart(2, '0')}`
  }

  // SS.CC saja, mis. 41.14 -> 00.41.14
  cocok = teks.match(/^(\d{1,2})[:.](\d{1,2})$/)
  if (cocok) {
    const [, s, c] = cocok
    if (Number(s) > 59) return ''
    return `00.${String(Number(s)).padStart(2, '0')}.${String(Number(c)).padStart(2, '0')}`
  }

  return ''
}

// Nilai numerik untuk membandingkan waktu. Sengaja meniru timeToCentiseconds()
// di aplikasi supaya perbandingan PB memakai satuan yang sama persis.
export function waktuKeSentidetik(nilai) {
  const bagian = String(nilai || '').trim().replace(':', '.').split('.').map(Number)
  if (bagian.length !== 3 || bagian.some(Number.isNaN)) return null
  return (bagian[0] * 60 + bagian[1]) * 100 + bagian[2]
}

// --- Normalisasi tanggal ----------------------------------------------------

// '12/09/2026' (hari/bulan/tahun) dan '2026-09-12' -> 'YYYY-MM-DD',
// bentuk yang dipakai input type="date" dan field date Catatan Waktu.
export function normalkanTanggal(mentah) {
  const teks = String(mentah || '').trim()
  if (!teks) return ''

  let cocok = teks.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (cocok) return sahkanTanggal(cocok[1], cocok[2], cocok[3])

  cocok = teks.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/)
  if (cocok) return sahkanTanggal(cocok[3], cocok[2], cocok[1])

  return ''
}

function sahkanTanggal(th, bl, tg) {
  const tahun = Number(th), bulan = Number(bl), tanggal = Number(tg)
  const d = new Date(tahun, bulan - 1, tanggal)
  if (d.getFullYear() !== tahun || d.getMonth() !== bulan - 1 || d.getDate() !== tanggal) return ''
  return `${String(tahun).padStart(4, '0')}-${String(bulan).padStart(2, '0')}-${String(tanggal).padStart(2, '0')}`
}

// --- Normalisasi nama -------------------------------------------------------

// Nama dinormalisasi HANYA untuk mencari kandidat. Identitas atlet tidak pernah
// diubah: yang disimpan tetap athleteId dan nama asli dari Data Atlet.
export function normalkanNama(mentah) {
  return String(mentah || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[.,'`’]/g, ' ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Jarak Levenshtein, dibatasi supaya perbedaan besar berhenti lebih awal.
function jarakEdit(a, b, batas = 3) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > batas) return batas + 1
  let sebelum = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const kini = [i]
    let minBaris = i
    for (let j = 1; j <= b.length; j++) {
      const biaya = a[i - 1] === b[j - 1] ? 0 : 1
      kini[j] = Math.min(sebelum[j] + 1, kini[j - 1] + 1, sebelum[j - 1] + biaya)
      if (kini[j] < minBaris) minBaris = kini[j]
    }
    if (minBaris > batas) return batas + 1
    sebelum = kini
  }
  return sebelum[b.length]
}

export const COCOK_OTOMATIS = 'Cocok Otomatis'
export const PERLU_KONFIRMASI = 'Perlu Konfirmasi'
export const TIDAK_DITEMUKAN = 'Tidak Ditemukan'

// Mencocokkan nama PDF dengan Data Atlet.
//
// Bertingkat: cocok persis setelah normalisasi, lalu kandidat aman
// (satu-satunya yang sangat mirip), lalu saran fuzzy.
//
// Hasil yang ambigu - lebih dari satu kandidat - TIDAK PERNAH cocok otomatis.
export function cocokkanAtlet(namaPdf, athletes) {
  const daftar = Array.isArray(athletes) ? athletes : []
  const target = normalkanNama(namaPdf)
  if (!target) return { status: TIDAK_DITEMUKAN, athleteId: '', kandidat: [] }

  const bernama = daftar
    .filter(a => a && a.id)
    .map(a => ({ atlet: a, normal: normalkanNama(a.name) }))

  const persis = bernama.filter(x => x.normal === target)
  if (persis.length === 1) {
    return { status: COCOK_OTOMATIS, athleteId: persis[0].atlet.id, kandidat: [persis[0].atlet] }
  }
  // Dua atlet dengan nama identik: Admin harus memilih, bukan aplikasi.
  if (persis.length > 1) {
    return { status: PERLU_KONFIRMASI, athleteId: '', kandidat: persis.map(x => x.atlet) }
  }

  const berjarak = bernama
    .map(x => ({ ...x, jarak: jarakEdit(target, x.normal, 3) }))
    .filter(x => x.jarak <= 3)
    .sort((a, b) => a.jarak - b.jarak)

  if (!berjarak.length) return { status: TIDAK_DITEMUKAN, athleteId: '', kandidat: [] }

  const terbaik = berjarak[0]
  const seimbang = berjarak.filter(x => x.jarak === terbaik.jarak)

  // Satu kandidat yang jelas lebih dekat daripada yang lain, dan bedanya kecil.
  const tunggalDanAman = seimbang.length === 1 && terbaik.jarak <= 2 &&
    (berjarak.length === 1 || berjarak[1].jarak > terbaik.jarak)

  return {
    status: tunggalDanAman ? COCOK_OTOMATIS : PERLU_KONFIRMASI,
    athleteId: tunggalDanAman ? terbaik.atlet.id : '',
    kandidat: berjarak.slice(0, 5).map(x => x.atlet)
  }
}

// --- Parsing baris PDF ------------------------------------------------------

function barisTanggal(b) { return normalkanTanggal(b) }
function barisWaktu(b) { return normalkanWaktu(b) }
function barisStatus(b) {
  const kunci = String(b || '').trim().toUpperCase().replace(/[^A-Z]/g, '')
  return STATUS_BUKAN_WAKTU.includes(kunci) ? kunci : ''
}
function barisJarak(b) {
  return /\d{2,4}\s*(m\b|meter|metre|mtr)/i.test(String(b || '')) ? normalkanJarak(b) : ''
}
function barisGaya(b) { return normalkanGaya(b) }

function mungkinNama(b) {
  const teks = String(b || '').trim()
  if (teks.length < 3 || teks.length > 80) return false
  if (barisTanggal(teks) || barisWaktu(teks) || barisStatus(teks)) return false
  if (barisJarak(teks) || barisGaya(teks)) return false
  // Nama memuat huruf, dan bukan sekadar angka atau label.
  if (!/[A-Za-z]{2}/.test(teks)) return false
  if (/^(no|nama|tim|club|event|hasil|prestasi|penyisihan|final|akhir|total|peringkat|rank|team)\b/i.test(teks)) return false
  return true
}

// Menyusun record dari baris teks.
//
// Baris diproses berurutan sambil mengingat nilai terakhir yang terlihat untuk
// setiap field. Sebuah record dibentuk ketika baris waktu - atau baris status
// seperti DNS/DQ/DNF - ditemui. Cara ini menangani format standar lima baris
// maupun tabel hasil resmi yang urutan kolomnya berbeda.
export function uraiBarisHasil(baris, { tanggalBawaan = '' } = {}) {
  const daftar = Array.isArray(baris) ? baris : []
  const hasil = []

  let nama = ''
  let tanggal = normalkanTanggal(tanggalBawaan)
  let gaya = ''
  let jarak = ''

  for (const mentah of daftar) {
    const teks = String(mentah || '').trim()
    if (!teks) continue

    const tgl = barisTanggal(teks)
    if (tgl) { tanggal = tgl; continue }

    // Satu baris kerap memuat keduanya sekaligus, mis. '50M FREESTYLE'.
    // Keduanya diambil, supaya gaya tidak hilang hanya karena jarak diproses
    // lebih dulu.
    const jrk = barisJarak(teks)
    const gy = barisGaya(teks)
    if (jrk || gy) {
      if (jrk) jarak = jrk
      if (gy) gaya = gy
      continue
    }

    const status = barisStatus(teks)
    const waktu = status ? '' : barisWaktu(teks)

    if (status || waktu) {
      hasil.push({
        namaPdf: nama,
        tanggal,
        gaya,
        jarak,
        waktu,
        status,
        barisAsli: teks
      })
      // Nama tidak direset: satu atlet bisa punya beberapa nomor berurutan.
      continue
    }

    if (mungkinNama(teks)) {
      nama = teks
      // Nomor lomba biasanya ditulis ulang untuk atlet berikutnya.
      gaya = ''
      jarak = ''
    }
  }

  return hasil
}

// --- Dedupe -----------------------------------------------------------------

// Identitas sebuah Catatan Waktu untuk keperluan dedupe: atlet, tanggal, gaya,
// jarak, dan waktu. Kombinasi itu sudah cukup membedakan dua hasil yang berbeda,
// dan membuat import PDF yang sama dua kali tidak menggandakan apa pun.
export function identitasCatatan(record) {
  const r = record || {}
  return [
    String(r.athleteId || ''),
    String(r.date || ''),
    String(r.stroke || ''),
    String(Number(r.distance || 0)),
    String(r.time || '')
  ].join('|')
}

// --- Penyusunan baris preview ----------------------------------------------

export const SIAP_SIMPAN = 'Siap Simpan'
export const SUDAH_ADA = 'Sudah Ada'
export const TIDAK_VALID = 'Tidak Valid'

// Menyusun baris preview lengkap dengan status pencocokan, dedupe, dan PB.
//
// `existingRecords` adalah state.timeRecords apa adanya - sumber kebenaran yang
// sama yang dibaca Admin, Pelatih, dan Orang Tua.
export function susunBarisImpor(terurai, athletes, existingRecords = []) {
  const sudahAda = new Set((Array.isArray(existingRecords) ? existingRecords : []).map(identitasCatatan))

  // PB dihitung dengan aturan yang sama dengan personalBestSummary(): paling
  // cepat per kombinasi gaya + jarak untuk atlet tersebut.
  const terbaik = new Map()
  for (const r of (Array.isArray(existingRecords) ? existingRecords : [])) {
    const nilai = waktuKeSentidetik(r?.time)
    if (nilai === null) continue
    const kunci = `${r?.athleteId || ''}|${r?.stroke || ''}|${Number(r?.distance || 0)}`
    if (!terbaik.has(kunci) || nilai < terbaik.get(kunci)) terbaik.set(kunci, nilai)
  }

  // Dedupe juga berlaku di dalam satu PDF yang sama.
  const dalamBatch = new Set()

  return terurai.map((baris, urutan) => {
    const cocok = cocokkanAtlet(baris.namaPdf, athletes)
    const atlet = (Array.isArray(athletes) ? athletes : []).find(a => a?.id === cocok.athleteId) || null

    const masalah = []
    if (baris.status) masalah.push(`Hasil ${baris.status} tidak dapat disimpan sebagai catatan waktu.`)
    if (!baris.status && !baris.waktu) masalah.push('Waktu tidak terbaca.')
    if (!baris.gaya) masalah.push('Gaya renang tidak dikenali.')
    if (!baris.jarak) masalah.push('Jarak tidak dikenali.')
    if (!baris.tanggal) masalah.push('Tanggal perlombaan tidak terbaca.')

    const calon = {
      athleteId: cocok.athleteId,
      athleteName: atlet?.name || '',
      stroke: baris.gaya,
      distance: baris.jarak || 0,
      type: JENIS_IMPOR,
      level: '',
      date: baris.tanggal,
      time: baris.waktu
    }

    const identitas = identitasCatatan(calon)
    const duplikat = Boolean(cocok.athleteId) && !masalah.length &&
      (sudahAda.has(identitas) || dalamBatch.has(identitas))

    let status
    if (masalah.length) status = TIDAK_VALID
    else if (cocok.status !== COCOK_OTOMATIS) status = cocok.status
    else if (duplikat) status = SUDAH_ADA
    else { status = SIAP_SIMPAN; dalamBatch.add(identitas) }

    // PB hanya bermakna bila waktunya valid dan atletnya sudah pasti.
    let pb = false
    if (status === SIAP_SIMPAN) {
      const nilai = waktuKeSentidetik(baris.waktu)
      const kunci = `${cocok.athleteId}|${baris.gaya}|${Number(baris.jarak || 0)}`
      const sebelumnya = terbaik.has(kunci) ? terbaik.get(kunci) : null
      pb = nilai !== null && (sebelumnya === null || nilai < sebelumnya)
      // Satu PDF bisa memuat beberapa hasil untuk kombinasi yang sama; PB
      // harus mengikuti urutan, bukan menandai semuanya sebagai PB.
      if (pb) terbaik.set(kunci, nilai)
    }

    return {
      urutan,
      namaPdf: baris.namaPdf,
      statusMatch: cocok.status,
      kandidat: cocok.kandidat,
      athleteId: cocok.athleteId,
      athleteName: atlet?.name || '',
      stroke: baris.gaya,
      distance: baris.jarak || '',
      jenis: JENIS_IMPOR,
      date: baris.tanggal,
      time: baris.waktu,
      statusHasil: baris.status,
      status,
      pb,
      masalah
    }
  })
}

// Baris yang boleh ikut "Simpan Semua yang Cocok".
// Hanya yang berstatus Siap Simpan: ambigu, tidak ditemukan, duplikat, dan
// tidak valid semuanya tertinggal sampai Admin menanganinya sendiri.
export function barisSiapSimpan(baris) {
  return (Array.isArray(baris) ? baris : []).filter(b => b?.status === SIAP_SIMPAN)
}

// Mengubah baris preview menjadi payload Catatan Waktu.
//
// Bentuknya sama persis dengan payload form manual, sehingga masuk lewat
// state.timeRecords yang sama dan otomatis terbaca oleh setiap halaman yang
// sudah membaca Catatan Waktu athleteId tersebut.
export function keCatatanWaktu(baris, { buatId, coachId = '', coachName = 'Admin', sekarang = () => new Date().toISOString() } = {}) {
  return barisSiapSimpan(baris).map(b => ({
    id: typeof buatId === 'function' ? buatId() : '',
    athleteId: b.athleteId,
    athleteName: b.athleteName,
    stroke: b.stroke,
    distance: Number(b.distance || 0),
    // Jenis hasil import SELALU Kejuaraan. Tidak ada jalur yang membuatnya
    // menjadi Latihan, dan tidak ada selector Jenis pada proses import.
    type: JENIS_IMPOR,
    level: '',
    date: b.date,
    time: b.time,
    coachId,
    coachName,
    importedFrom: 'pdf',
    createdAt: sekarang()
  }))
}

// --- Authorization ----------------------------------------------------------

// Import Hasil Perlombaan hanya untuk Admin.
//
// Pemeriksaan ada di sini, bukan sekadar menyembunyikan tombol, supaya Pelatih
// atau Orang Tua tetap ditolak walau memanggil alurnya lewat currentPage atau
// state yang dimanipulasi.
export function bolehImporHasilLomba(role) {
  return String(role || '') === 'admin'
}
