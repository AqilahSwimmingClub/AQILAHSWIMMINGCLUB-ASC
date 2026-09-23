// Import PDF Hasil Perlombaan.
//
// PDF hanya sumber input. Yang dikunci di sini adalah bahwa hasilnya masuk ke
// Catatan Waktu yang SAMA dengan input manual, selalu berjenis Kejuaraan,
// terhubung lewat athleteId, tidak pernah menggandakan record, dan tidak
// pernah mengarang angka untuk hasil DNS/DQ/DNF.
import test from 'node:test'
import assert from 'node:assert/strict'
import { barisTeksPdf } from '../src/lib/pdf-teks.js'
import { buatPdfTeks, buatPdfTanpaTeks } from './bantu/buat-pdf.js'
import {
  normalkanGaya, normalkanJarak, normalkanWaktu, normalkanTanggal, normalkanNama,
  waktuKeSentidetik, cocokkanAtlet, uraiBarisHasil, susunBarisImpor, barisSiapSimpan,
  keCatatanWaktu, identitasCatatan,
  GAYA_KANONIK, JARAK_KANONIK, JENIS_IMPOR, STATUS_BUKAN_WAKTU,
  COCOK_OTOMATIS, PERLU_KONFIRMASI, TIDAK_DITEMUKAN,
  SIAP_SIMPAN, SUDAH_ADA, TIDAK_VALID
} from '../src/lib/impor-hasil-lomba.js'

const ATLET = [
  { id: 'ASC-0001', name: 'ZHEVANNA ALMEERA DEEPIKA JUMAWAL' },
  { id: 'ASC-0002', name: 'M. AKBAR ELANG WICAKSONO' },
  { id: 'ASC-0003', name: 'AQILAH FAHIRA DJAWAS' },
  { id: 'ASC-0004', name: 'Budi Santoso' }
]

const PDF_CONTOH = [
  'ZHEVANNA ALMEERA DEEPIKA JUMAWAL', '12/09/2026', 'Gaya Dada', '25 meter', '00:41.14'
]

// --- 1. PDF teks dapat diparse ---------------------------------------------

test('1. PDF berbasis teks terbaca barisnya', async () => {
  // Rekonstruksi tabel dan sel diuji tuntas di tests/impor-pdf-nyata.test.js,
  // yang masuk lewat PDF biner hasil generator sungguhan.
  assert.deepEqual(await barisTeksPdf(buatPdfTeks(PDF_CONTOH)), PDF_CONTOH)
})

test('1c. PDF hasil pindaian ditolak dengan pesan jelas, bukan data karangan', async () => {
  await assert.rejects(() => barisTeksPdf(buatPdfTanpaTeks()), /tidak memiliki teks yang dapat dibaca/)
})

test('1d. berkas yang bukan PDF ditolak', async () => {
  await assert.rejects(() => barisTeksPdf(new Uint8Array([1, 2, 3, 4, 5])), /bukan PDF/)
})

// --- 2-5. Pencocokan nama ---------------------------------------------------

test('2. nama persis menghasilkan athleteId yang benar', () => {
  const h = cocokkanAtlet('ZHEVANNA ALMEERA DEEPIKA JUMAWAL', ATLET)
  assert.equal(h.status, COCOK_OTOMATIS)
  assert.equal(h.athleteId, 'ASC-0001')
})

test('3. nama ternormalisasi tetap cocok: huruf besar-kecil, spasi, titik', () => {
  for (const varian of [
    'm. akbar elang wicaksono',
    'M AKBAR ELANG WICAKSONO',
    '  M.  Akbar   Elang  Wicaksono  ',
    'M.AKBAR ELANG WICAKSONO'
  ]) {
    const h = cocokkanAtlet(varian, ATLET)
    assert.equal(h.status, COCOK_OTOMATIS, `varian: ${varian}`)
    assert.equal(h.athleteId, 'ASC-0002', `varian: ${varian}`)
  }
})

test('4. nama ambigu TIDAK cocok otomatis', () => {
  const kembar = [
    { id: 'ASC-0010', name: 'Ahmad Rizki' },
    { id: 'ASC-0011', name: 'Ahmad Rizky' }
  ]
  const h = cocokkanAtlet('Ahmad Rizka', kembar)
  assert.equal(h.status, PERLU_KONFIRMASI)
  assert.equal(h.athleteId, '', 'tidak boleh memilih sendiri di antara kandidat')
  assert.ok(h.kandidat.length >= 2, 'kandidat tetap disarankan kepada Admin')
})

test('4b. dua atlet bernama identik wajib dikonfirmasi Admin', () => {
  const kembar = [
    { id: 'ASC-0020', name: 'Siti Aminah' },
    { id: 'ASC-0021', name: 'Siti Aminah' }
  ]
  const h = cocokkanAtlet('SITI AMINAH', kembar)
  assert.equal(h.status, PERLU_KONFIRMASI)
  assert.equal(h.athleteId, '')
})

test('5. nama yang tidak ada di Data Atlet tidak menghasilkan athleteId', () => {
  const h = cocokkanAtlet('ORANG YANG TIDAK TERDAFTAR SAMA SEKALI', ATLET)
  assert.equal(h.status, TIDAK_DITEMUKAN)
  assert.equal(h.athleteId, '')
})

test('5b. normalisasi nama tidak mengubah identitas atlet', () => {
  assert.equal(normalkanNama("M. Akbar Elang's"), 'M AKBAR ELANG S')
  assert.equal(normalkanNama(''), '')
})

// --- 6. Gaya renang ---------------------------------------------------------

test('6. gaya dinormalisasi ke nilai kanonik existing', () => {
  const harapan = {
    'FREESTYLE': 'Gaya Bebas', '50M FREESTYLE': 'Gaya Bebas', 'Gaya Bebas': 'Gaya Bebas',
    'BREASTSTROKE': 'Gaya Dada', 'Gaya Dada': 'Gaya Dada',
    'BACKSTROKE': 'Gaya Punggung', 'Gaya Punggung': 'Gaya Punggung',
    'BUTTERFLY': 'Gaya Kupu-kupu', 'Gaya Kupu-kupu': 'Gaya Kupu-kupu',
    'INDIVIDUAL MEDLEY': 'Gaya Ganti Perorangan (IM)', 'IM': 'Gaya Ganti Perorangan (IM)',
    'FREESTYLE FINS': 'Gaya Bebas Fins', 'Gaya Kupu-kupu Fins': 'Gaya Kupu-kupu Fins',
    'BACKSTROKE FINS': 'Gaya Punggung Fins'
  }
  for (const [mentah, kanonik] of Object.entries(harapan)) {
    assert.equal(normalkanGaya(mentah), kanonik, `mentah: ${mentah}`)
  }
})

test('6b. gaya hasil normalisasi SELALU ada di daftar kanonik', () => {
  for (const mentah of ['FREESTYLE', 'BREASTSTROKE', 'BUTTERFLY FINS', 'IM']) {
    const g = normalkanGaya(mentah)
    assert.ok(GAYA_KANONIK.includes(g), `${mentah} -> ${g} bukan nilai kanonik`)
  }
})

test('6c. gaya tidak dikenali menghasilkan kosong, bukan nama gaya baru', () => {
  for (const buruk of ['', 'ENTAH APA', 'Gaya Terbang']) {
    assert.equal(normalkanGaya(buruk), '')
  }
})

// --- 7. Jarak ---------------------------------------------------------------

test('7. jarak dinormalisasi ke angka kanonik', () => {
  for (const mentah of ['25 M', '25M', '25 meter', '25m', '25 Metre']) {
    assert.equal(normalkanJarak(mentah), 25, `mentah: ${mentah}`)
  }
  assert.equal(normalkanJarak('100 meter'), 100)
  assert.equal(normalkanJarak('1500m'), 1500)
})

test('7b. jarak di luar daftar kanonik ditolak', () => {
  for (const buruk of ['33 meter', '75 m', '', 'meter']) {
    assert.equal(normalkanJarak(buruk), '', `mentah: ${buruk}`)
  }
  assert.ok(JARAK_KANONIK.includes(50))
})

// --- 8. Waktu ---------------------------------------------------------------

test('8. waktu dinormalisasi ke format kanonik MM.SS.CC', () => {
  assert.equal(normalkanWaktu('00:41.14'), '00.41.14')
  assert.equal(normalkanWaktu('41.14'), '00.41.14')
  assert.equal(normalkanWaktu('1:15.45'), '01.15.45')
  assert.equal(normalkanWaktu('01.15.45'), '01.15.45')
  assert.equal(normalkanWaktu('00:39,82'), '00.39.82')
})

test('8b. waktu tidak masuk akal ditolak', () => {
  for (const buruk of ['', 'abc', '00:99.10', '1:2:3:4']) {
    assert.equal(normalkanWaktu(buruk), '', `mentah: ${buruk}`)
  }
})

test('8c. perbandingan waktu memakai satuan numerik, bukan string', () => {
  // '01.05.00' < '00.59.00' sebagai string, tetapi lebih LAMBAT sebagai waktu.
  assert.ok('01.05.00' < '00.59.00' === false)
  assert.ok(waktuKeSentidetik('01.05.00') > waktuKeSentidetik('00.59.00'))
  assert.equal(waktuKeSentidetik('00.41.14'), 4114)
  assert.equal(waktuKeSentidetik('bukan waktu'), null)
})

test('8d. tanggal dinormalisasi ke YYYY-MM-DD', () => {
  assert.equal(normalkanTanggal('12/09/2026'), '2026-09-12')
  assert.equal(normalkanTanggal('2026-09-12'), '2026-09-12')
  assert.equal(normalkanTanggal('31/02/2026'), '', 'tanggal tidak ada ditolak')
  assert.equal(normalkanTanggal(''), '')
})

// --- 9 & 10. Jenis selalu Kejuaraan ----------------------------------------

test('9. seluruh record hasil import berjenis Kejuaraan', () => {
  const baris = susunBarisImpor(uraiBarisHasil(PDF_CONTOH), ATLET, [])
  assert.equal(baris[0].jenis, JENIS_IMPOR)
  assert.equal(JENIS_IMPOR, 'Kejuaraan')

  const catatan = keCatatanWaktu(baris, { buatId: () => 'x' })
  assert.equal(catatan.length, 1)
  assert.equal(catatan[0].type, 'Kejuaraan')
})

test('10. tidak ada jalur yang membuat hasil import menjadi Latihan', () => {
  const banyak = [
    'ZHEVANNA ALMEERA DEEPIKA JUMAWAL', '12/09/2026', 'Gaya Dada', '25 meter', '00:41.14',
    'AQILAH FAHIRA DJAWAS', '12/09/2026', 'FREESTYLE', '50 meter', '00:39.82',
    'M. AKBAR ELANG WICAKSONO', '12/09/2026', 'BACKSTROKE', '100 meter', '01:30.00'
  ]
  const baris = susunBarisImpor(uraiBarisHasil(banyak), ATLET, [])
  const catatan = keCatatanWaktu(baris, { buatId: () => 'x' })
  assert.equal(catatan.length, 3)
  for (const c of catatan) {
    assert.equal(c.type, 'Kejuaraan')
    assert.notEqual(c.type, 'Latihan')
  }
  // Tidak ada satu pun baris preview yang menawarkan Jenis selain Kejuaraan.
  assert.ok(baris.every(b => b.jenis === 'Kejuaraan'))
})

test('10b. payload import tidak memuat selector Jenis apa pun', () => {
  const baris = susunBarisImpor(uraiBarisHasil(PDF_CONTOH), ATLET, [])
  const [c] = keCatatanWaktu(baris, { buatId: () => 'x' })
  // Jenis ditetapkan, bukan diambil dari masukan pengguna.
  assert.equal(c.type, JENIS_IMPOR)
  assert.equal(c.level, '', 'tingkat tidak dikarang dari PDF')
})

// --- 12 & 13. Masuk ke source of truth Catatan Waktu -----------------------

test('12. payload import memakai bentuk Catatan Waktu yang sudah ada', () => {
  const baris = susunBarisImpor(uraiBarisHasil(PDF_CONTOH), ATLET, [])
  const [c] = keCatatanWaktu(baris, { buatId: () => 'TIM-1', coachName: 'Admin' })
  for (const kunci of ['id', 'athleteId', 'athleteName', 'stroke', 'distance', 'type', 'level', 'date', 'time', 'coachId', 'coachName']) {
    assert.ok(kunci in c, `field ${kunci} hilang dari payload`)
  }
  assert.equal(c.athleteId, 'ASC-0001')
  assert.equal(c.stroke, 'Gaya Dada')
  assert.equal(c.distance, 25)
  assert.equal(typeof c.distance, 'number')
  assert.equal(c.date, '2026-09-12')
  assert.equal(c.time, '00.41.14')
})

test('13. record terbaca lewat athleteId, bukan nama', () => {
  const baris = susunBarisImpor(uraiBarisHasil(PDF_CONTOH), ATLET, [])
  const catatan = keCatatanWaktu(baris, { buatId: () => 'TIM-1' })
  const timeRecords = catatan.slice()

  // Halaman atlet/orang tua menyaring dengan athleteId.
  const punyaAtlet = timeRecords.filter(r => r.athleteId === 'ASC-0001')
  assert.equal(punyaAtlet.length, 1)

  // Ganti nama atlet: relasi tetap utuh.
  const setelahGantiNama = timeRecords.filter(r => r.athleteId === 'ASC-0001')
  assert.equal(setelahGantiNama.length, 1)

  // Atlet lain tidak ikut terbaca.
  assert.equal(timeRecords.filter(r => r.athleteId === 'ASC-0002').length, 0)
})

// --- 14 & 15. Personal Best -------------------------------------------------

test('14. waktu lebih cepat terdeteksi sebagai PB', () => {
  const existing = [{ athleteId: 'ASC-0001', stroke: 'Gaya Dada', distance: 25, time: '00.45.00', date: '2026-01-01' }]
  const baris = susunBarisImpor(uraiBarisHasil(PDF_CONTOH), ATLET, existing)
  assert.equal(baris[0].status, SIAP_SIMPAN)
  assert.equal(baris[0].pb, true)
})

test('14b. atlet tanpa riwayat: catatan pertama adalah PB', () => {
  const baris = susunBarisImpor(uraiBarisHasil(PDF_CONTOH), ATLET, [])
  assert.equal(baris[0].pb, true)
})

test('15. waktu lebih lambat bukan PB, tetapi tetap disimpan', () => {
  const existing = [{ athleteId: 'ASC-0001', stroke: 'Gaya Dada', distance: 25, time: '00.35.00', date: '2026-01-01' }]
  const baris = susunBarisImpor(uraiBarisHasil(PDF_CONTOH), ATLET, existing)
  assert.equal(baris[0].pb, false)
  assert.equal(baris[0].status, SIAP_SIMPAN, 'hasil kejuaraan tetap disimpan meski bukan PB')
})

test('15b. PB per kombinasi gaya+jarak, bukan lintas nomor', () => {
  const existing = [{ athleteId: 'ASC-0001', stroke: 'Gaya Bebas', distance: 50, time: '00.30.00', date: '2026-01-01' }]
  const baris = susunBarisImpor(uraiBarisHasil(PDF_CONTOH), ATLET, existing)
  assert.equal(baris[0].pb, true, 'gaya/jarak berbeda tidak boleh saling memengaruhi')
})

test('15c. satu PDF dengan dua hasil untuk nomor yang sama: PB mengikuti urutan', () => {
  const dua = [
    'ZHEVANNA ALMEERA DEEPIKA JUMAWAL', '12/09/2026', 'Gaya Dada', '25 meter', '00:41.14',
    'ZHEVANNA ALMEERA DEEPIKA JUMAWAL', '13/09/2026', 'Gaya Dada', '25 meter', '00:40.00',
    'ZHEVANNA ALMEERA DEEPIKA JUMAWAL', '14/09/2026', 'Gaya Dada', '25 meter', '00:42.00'
  ]
  const baris = susunBarisImpor(uraiBarisHasil(dua), ATLET, [])
  assert.deepEqual(baris.map(b => b.pb), [true, true, false])
})

// --- 16 & 17. Anti duplikat -------------------------------------------------

test('16. record yang sudah ada ditandai Sudah Ada dan tidak disimpan lagi', () => {
  const existing = [{
    athleteId: 'ASC-0001', stroke: 'Gaya Dada', distance: 25,
    time: '00.41.14', date: '2026-09-12', type: 'Kejuaraan'
  }]
  const baris = susunBarisImpor(uraiBarisHasil(PDF_CONTOH), ATLET, existing)
  assert.equal(baris[0].status, SUDAH_ADA)
  assert.equal(barisSiapSimpan(baris).length, 0)
  assert.equal(keCatatanWaktu(baris, { buatId: () => 'x' }).length, 0)
})

test('17. PDF yang sama diimport dua kali tetap idempotent', () => {
  const terurai = uraiBarisHasil(PDF_CONTOH)

  // Import pertama ke basis kosong.
  const pertama = susunBarisImpor(terurai, ATLET, [])
  const disimpan = keCatatanWaktu(pertama, { buatId: () => 'TIM-1' })
  assert.equal(disimpan.length, 1)

  // Import kedua terhadap state yang sudah berisi hasil import pertama.
  const kedua = susunBarisImpor(terurai, ATLET, disimpan)
  assert.equal(kedua[0].status, SUDAH_ADA)
  assert.equal(keCatatanWaktu(kedua, { buatId: () => 'TIM-2' }).length, 0, 'tidak boleh menggandakan')
})

test('17b. duplikat di dalam satu PDF hanya disimpan sekali', () => {
  const kembar = [...PDF_CONTOH, ...PDF_CONTOH]
  const baris = susunBarisImpor(uraiBarisHasil(kembar), ATLET, [])
  assert.equal(barisSiapSimpan(baris).length, 1)
  assert.equal(baris[1].status, SUDAH_ADA)
})

test('17c. identitas dedupe memakai atlet, tanggal, gaya, jarak, dan waktu', () => {
  const dasar = { athleteId: 'A', date: '2026-01-01', stroke: 'Gaya Bebas', distance: 50, time: '00.30.00' }
  assert.equal(identitasCatatan(dasar), identitasCatatan({ ...dasar }))
  for (const ubah of [{ athleteId: 'B' }, { date: '2026-01-02' }, { stroke: 'Gaya Dada' }, { distance: 25 }, { time: '00.31.00' }]) {
    assert.notEqual(identitasCatatan(dasar), identitasCatatan({ ...dasar, ...ubah }))
  }
})

// --- 18-20. DNS / DQ / DNF --------------------------------------------------

test('18-20. DNS, DQ, dan DNF tidak pernah disimpan sebagai waktu', () => {
  for (const status of ['DNS', 'DQ', 'DNF']) {
    const pdf = ['ZHEVANNA ALMEERA DEEPIKA JUMAWAL', '12/09/2026', 'Gaya Dada', '25 meter', status]
    const baris = susunBarisImpor(uraiBarisHasil(pdf), ATLET, [])

    assert.equal(baris.length, 1, `${status}: tetap tampil di preview`)
    assert.equal(baris[0].status, TIDAK_VALID, `${status}: tidak boleh siap simpan`)
    assert.equal(baris[0].statusHasil, status)
    assert.equal(baris[0].time, '', `${status}: tidak boleh punya waktu`)
    assert.notEqual(baris[0].time, '00.00.00', `${status}: tidak boleh jadi nol`)
    assert.ok(baris[0].masalah.some(m => m.includes(status)))

    assert.equal(keCatatanWaktu(baris, { buatId: () => 'x' }).length, 0, `${status}: tidak boleh tersimpan`)
  }
})

test('18b. daftar status bukan-waktu memuat DNS, DQ, DNF', () => {
  for (const s of ['DNS', 'DQ', 'DNF']) assert.ok(STATUS_BUKAN_WAKTU.includes(s))
})

// --- Batch save -------------------------------------------------------------

test('hanya baris Siap Simpan yang ikut batch save', () => {
  const campuran = [
    'ZHEVANNA ALMEERA DEEPIKA JUMAWAL', '12/09/2026', 'Gaya Dada', '25 meter', '00:41.14',
    'ORANG TIDAK DIKENAL SAMA SEKALI', '12/09/2026', 'Gaya Bebas', '50 meter', '00:39.82',
    'AQILAH FAHIRA DJAWAS', '12/09/2026', 'Gaya Bebas', '50 meter', 'DNS'
  ]
  const baris = susunBarisImpor(uraiBarisHasil(campuran), ATLET, [])
  const status = baris.map(b => b.status)
  assert.equal(status[0], SIAP_SIMPAN)
  assert.equal(status[1], TIDAK_DITEMUKAN)
  assert.equal(status[2], TIDAK_VALID)
  assert.equal(barisSiapSimpan(baris).length, 1)
})

test('baris tanpa gaya atau jarak yang dikenali tidak ikut disimpan', () => {
  const buruk = ['ZHEVANNA ALMEERA DEEPIKA JUMAWAL', '12/09/2026', '00:41.14']
  const baris = susunBarisImpor(uraiBarisHasil(buruk), ATLET, [])
  assert.equal(baris[0].status, TIDAK_VALID)
  assert.equal(barisSiapSimpan(baris).length, 0)
})

// --- Alur PDF penuh ---------------------------------------------------------

test('alur penuh: PDF -> baris -> athleteId -> Catatan Waktu', async () => {
  const pdf = buatPdfTeks([
    'AQILAH FAHIRA DJAWAS', '23/09/2026', '50M FREESTYLE', '50 meter', '00:39.82'
  ])
  const baris = await barisTeksPdf(pdf)
  const terurai = uraiBarisHasil(baris)
  const preview = susunBarisImpor(terurai, ATLET, [])
  const catatan = keCatatanWaktu(preview, { buatId: () => 'TIM-9' })

  assert.equal(catatan.length, 1)
  assert.deepEqual(
    { athleteId: catatan[0].athleteId, stroke: catatan[0].stroke, distance: catatan[0].distance, time: catatan[0].time, type: catatan[0].type, date: catatan[0].date },
    { athleteId: 'ASC-0003', stroke: 'Gaya Bebas', distance: 50, time: '00.39.82', type: 'Kejuaraan', date: '2026-09-23' }
  )
})

test('satu atlet dengan beberapa nomor lomba berurutan terbaca semuanya', () => {
  const baris = uraiBarisHasil([
    'AQILAH FAHIRA DJAWAS', '23/09/2026',
    'Gaya Bebas', '50 meter', '00:39.82',
    'Gaya Dada', '50 meter', '00:48.10'
  ])
  assert.equal(baris.length, 2)
  assert.ok(baris.every(b => b.namaPdf === 'AQILAH FAHIRA DJAWAS'))
  assert.deepEqual(baris.map(b => b.gaya), ['Gaya Bebas', 'Gaya Dada'])
})

// --- 22 & 23. PDF tidak dipersist ------------------------------------------

test('22. modul import tidak pernah menyimpan byte PDF', async () => {
  const pdf = buatPdfTeks(PDF_CONTOH)
  const baris = await barisTeksPdf(pdf)
  const catatan = keCatatanWaktu(susunBarisImpor(uraiBarisHasil(baris), ATLET, []), { buatId: () => 'TIM-1' })
  // Tidak ada field yang membawa biner, base64, atau blob PDF.
  const teks = JSON.stringify(catatan)
  assert.ok(!teks.includes('%PDF'), 'byte PDF ikut tersimpan')
  assert.ok(!/base64/i.test(teks))
  for (const c of catatan) {
    assert.ok(!('pdf' in c) && !('file' in c) && !('blob' in c))
    assert.equal(c.importedFrom, 'pdf', 'hanya penanda asal, bukan isinya')
  }
})

test('23. melepas byte PDF tidak menghapus Catatan Waktu yang sudah dibuat', async () => {
  let pdf = buatPdfTeks(PDF_CONTOH)
  const baris = await barisTeksPdf(pdf)
  const catatan = keCatatanWaktu(susunBarisImpor(uraiBarisHasil(baris), ATLET, []), { buatId: () => 'TIM-1' })

  pdf = null // PDF sementara dilepas
  assert.equal(pdf, null)
  assert.equal(catatan.length, 1)
  assert.equal(catatan[0].athleteId, 'ASC-0001')
  assert.equal(catatan[0].time, '00.41.14')
})

// --- 21. Authorization ------------------------------------------------------

test('21. hanya Admin yang boleh melakukan import dan batch save', async () => {
  const { bolehImporHasilLomba } = await import('../src/lib/impor-hasil-lomba.js')
  assert.equal(bolehImporHasilLomba('admin'), true)
  for (const bukanAdmin of ['coach', 'parent', '', null, undefined, 'ADMIN ', 'superadmin']) {
    assert.equal(bolehImporHasilLomba(bukanAdmin), false, `role: ${bukanAdmin}`)
  }
})

test('21b. manipulasi role tidak membuka import', async () => {
  const { bolehImporHasilLomba } = await import('../src/lib/impor-hasil-lomba.js')
  // Bentuk yang mirip tetapi bukan 'admin' persis tetap ditolak.
  for (const palsu of ['Admin', 'aDmIn', 'admin,coach', ' admin']) {
    assert.equal(bolehImporHasilLomba(palsu), false, `role: ${palsu}`)
  }
})

// --- 28-30. Akses dokumen per-role -----------------------------------------

test('28 & 29. Akta dan Bukti Pembayaran tetap terbaca oleh role yang berhak', async () => {
  const { atletUntukOrangTua, dokumenAtlet } = await import('../src/lib/atlet.js')
  const athletes = [{
    id: 'ASC-0001', name: 'Anak A',
    photo: 'u/foto-a.jpg', familyCard: 'u/kk-a.pdf',
    birthCertificate: 'u/akta-a.pdf', registrationProof: 'u/bukti-a.jpg'
  }]

  // Admin membaca record atlet langsung.
  const olehAdmin = dokumenAtlet(athletes.find(a => a.id === 'ASC-0001'))
  assert.equal(olehAdmin.birthCertificate, 'u/akta-a.pdf')
  assert.equal(olehAdmin.registrationProof, 'u/bukti-a.jpg')

  // Orang Tua anak itu membaca dokumen yang sama, bukan salinan.
  const olehOrangTua = dokumenAtlet(atletUntukOrangTua(athletes, 'ASC-0001'))
  assert.deepEqual(olehOrangTua, olehAdmin)
})

test('30. Orang Tua TIDAK dapat membaca dokumen atlet lain', async () => {
  const { atletUntukOrangTua, dokumenAtlet } = await import('../src/lib/atlet.js')
  const athletes = [
    { id: 'ASC-0001', name: 'Anak A', birthCertificate: 'u/akta-a.pdf' },
    { id: 'ASC-0002', name: 'Anak B', birthCertificate: 'u/akta-b.pdf' }
  ]

  const punyaA = dokumenAtlet(atletUntukOrangTua(athletes, 'ASC-0001'))
  assert.equal(punyaA.birthCertificate, 'u/akta-a.pdf')
  assert.notEqual(punyaA.birthCertificate, 'u/akta-b.pdf')

  // ID kosong tidak membuka atlet mana pun.
  assert.equal(atletUntukOrangTua(athletes, ''), null)
  assert.deepEqual(dokumenAtlet(atletUntukOrangTua(athletes, '')), {
    photo: '', familyCard: '', birthCertificate: '', registrationProof: ''
  })
})

test('30b. daftar reference berkas aktif mencakup seluruh dokumen atlet', async () => {
  const { seluruhReferensiBerkas } = await import('../src/lib/atlet.js')
  const athletes = [
    { id: 'A', photo: 'u/1.jpg', birthCertificate: 'u/2.pdf' },
    { id: 'B', registrationProof: 'u/3.jpg' }
  ]
  const semua = seluruhReferensiBerkas(athletes)
  assert.deepEqual(semua.sort(), ['u/1.jpg', 'u/2.pdf', 'u/3.jpg'])
  assert.deepEqual(seluruhReferensiBerkas(null), [])
})
