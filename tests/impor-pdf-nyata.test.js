// Acceptance test Import PDF Hasil Perlombaan.
//
// Ini tes yang seharusnya ada sejak v1.2.3. Seluruhnya masuk lewat jalur
// sesungguhnya:
//
//   PDF BINER -> ekstraksi teks -> rekonstruksi baris tabel -> parsing
//   -> pencocokan atlet -> preview -> payload Catatan Waktu
//
// PDF-nya dibuat jsPDF + jspdf-autotable, generator sungguhan yang sudah
// dipakai aplikasi untuk ekspor laporan. Jadi tabelnya punya kolom nyata,
// sel yang terbungkus ke baris berikutnya, dan header yang terulang tiap
// halaman - persis hal yang membuat pengurai v1.2.3 menghasilkan nol record
// yang siap disimpan di Android.
import test from 'node:test'
import assert from 'node:assert/strict'
import { barisTeksPdf } from '../src/lib/pdf-teks.js'
import { buatPdfTabel, buatPdfTeks, buatPdfTanpaTeks } from './bantu/buat-pdf.js'
import {
  uraiBarisHasil, susunBarisImpor, barisSiapSimpan, keCatatanWaktu,
  bolehImporHasilLomba, JENIS_IMPOR,
  SIAP_SIMPAN, SUDAH_ADA, TIDAK_VALID, TIDAK_DITEMUKAN, COCOK_OTOMATIS
} from '../src/lib/impor-hasil-lomba.js'

const ATLET = [
  { id: 'ASC-0001', name: 'ZHEVANNA ALMEERA DEEPIKA JUMAWAL' },
  { id: 'ASC-0002', name: 'M. AKBAR ELANG WICAKSONO' },
  { id: 'ASC-0003', name: 'AQILAH FAHIRA DJAWAS' }
]

// Baris yang HARUS terbaca, persis seperti pada berkas yang gagal di Android.
const BARIS_ZHEVANNA = ['ZHEVANNA ALMEERA DEEPIKA JUMAWAL', '12/09/2026', 'Gaya Dada', '25 meter', '00:41.14']

const TABEL_KECIL = [
  BARIS_ZHEVANNA,
  ['M. AKBAR ELANG WICAKSONO', '12/09/2026', 'Gaya Bebas', '50 meter', '00:39.82'],
  ['AQILAH FAHIRA DJAWAS', '12/09/2026', 'Gaya Punggung', '100 meter', '01:30.25']
]

// Jalur penuh dari byte PDF sampai baris preview.
async function lewatiSeluruhJalur(pdf, { atlet = ATLET, sudahAda = [] } = {}) {
  const sel = await barisTeksPdf(pdf)
  const terurai = uraiBarisHasil(sel)
  const preview = susunBarisImpor(terurai, atlet, sudahAda)
  return { sel, terurai, preview }
}

// --- 1 & 2. Ekstraksi dan rekonstruksi baris tabel --------------------------

test('1. PDF tabel nyata terbaca lapisan teksnya', async () => {
  const sel = await barisTeksPdf(buatPdfTabel(TABEL_KECIL))
  // Tiga baris x lima kolom. Kalau ekstraksi kembali naif, jumlahnya meleset
  // karena sel yang terbungkus terpecah menjadi entri tambahan.
  assert.equal(sel.length, 15, `entri terbaca: ${JSON.stringify(sel)}`)
})

test('2. sel yang terbungkus disambung utuh, bukan terpotong', async () => {
  // Inilah bug v1.2.3: "ZHEVANNA ALMEERA DEEPIKA" dan "JUMAWAL" terpisah,
  // sehingga nama atlet berakhir menjadi "JUMAWAL".
  const { sel } = await lewatiSeluruhJalur(buatPdfTabel(TABEL_KECIL))
  assert.ok(sel.includes('ZHEVANNA ALMEERA DEEPIKA JUMAWAL'),
    `nama panjang terpotong. Entri yang terbaca: ${JSON.stringify(sel.slice(0, 8))}`)
  assert.ok(!sel.includes('JUMAWAL'), 'potongan nama tidak boleh berdiri sendiri')
  assert.ok(!sel.includes('Gaya'), 'potongan gaya tidak boleh berdiri sendiri')
})

test('2b. gaya yang terbungkus tetap menjadi satu nilai kanonik', async () => {
  const { preview } = await lewatiSeluruhJalur(buatPdfTabel(TABEL_KECIL))
  const punggung = preview.find(p => p.namaPdf.includes('AQILAH'))
  assert.equal(punggung.stroke, 'Gaya Punggung')
})

// --- 3 & 4. Record terbaca --------------------------------------------------

test('3. seluruh baris tabel menjadi record, bukan nol', async () => {
  const { terurai, preview } = await lewatiSeluruhJalur(buatPdfTabel(TABEL_KECIL))
  assert.equal(terurai.length, 3)
  assert.equal(preview.length, 3)
})

test('4. contoh ZHEVANNA terbaca lengkap dan benar', async () => {
  const { preview } = await lewatiSeluruhJalur(buatPdfTabel(TABEL_KECIL))
  const z = preview.find(p => p.namaPdf.includes('ZHEVANNA'))
  assert.ok(z, 'baris ZHEVANNA tidak ditemukan')
  assert.deepEqual({
    namaPdf: z.namaPdf, athleteId: z.athleteId, stroke: z.stroke,
    distance: z.distance, date: z.date, time: z.time, jenis: z.jenis, status: z.status
  }, {
    namaPdf: 'ZHEVANNA ALMEERA DEEPIKA JUMAWAL', athleteId: 'ASC-0001', stroke: 'Gaya Dada',
    distance: 25, date: '2026-09-12', time: '00.41.14', jenis: 'Kejuaraan', status: SIAP_SIMPAN
  })
})

// --- 5 & 6. Multi-halaman dan header berulang ------------------------------

function tabelBesar(jumlah = 40) {
  const nama = [
    'ZHEVANNA ALMEERA DEEPIKA JUMAWAL', 'M. AKBAR ELANG WICAKSONO',
    'AQILAH FAHIRA DJAWAS', 'ATLET LUAR YANG TIDAK TERDAFTAR DI ASC'
  ]
  const gaya = ['Gaya Dada', 'Gaya Bebas', 'Gaya Punggung', 'Gaya Kupu-kupu']
  const jarak = ['25 meter', '50 meter', '100 meter', '200 meter']
  const baris = []
  for (let n = 0; n < jumlah; n++) {
    const waktu = `00:${String(30 + (n % 29)).padStart(2, '0')}.${String(n % 100).padStart(2, '0')}`
    baris.push([nama[n % 4], '12/09/2026', gaya[n % 4], jarak[n % 4], waktu])
  }
  return baris
}

test('5 & 6. tabel multi-halaman dengan header berulang terbaca seluruhnya', async () => {
  const baris = tabelBesar(40)
  const { terurai, preview } = await lewatiSeluruhJalur(buatPdfTabel(baris))
  assert.equal(terurai.length, 40, `hanya ${terurai.length} dari 40 baris terbaca`)
  assert.equal(preview.length, 40)
  // Header yang terulang tidak boleh ikut menjadi record.
  assert.ok(!preview.some(p => /nama atlet/i.test(p.namaPdf)), 'header ikut terbaca sebagai record')
})

test('6b. nama panjang pada tabel besar tetap utuh', async () => {
  const { preview } = await lewatiSeluruhJalur(buatPdfTabel(tabelBesar(40)))
  const panjang = preview.filter(p => p.namaPdf === 'ZHEVANNA ALMEERA DEEPIKA JUMAWAL')
  assert.equal(panjang.length, 10, 'nama panjang tidak utuh di seluruh halaman')
})

// --- 7 & 8. Pencocokan dan record yang belum cocok -------------------------

test('7. atlet yang cocok memperoleh athleteId', async () => {
  const { preview } = await lewatiSeluruhJalur(buatPdfTabel(TABEL_KECIL))
  assert.deepEqual(preview.map(p => p.athleteId), ['ASC-0001', 'ASC-0002', 'ASC-0003'])
  assert.ok(preview.every(p => p.statusMatch === COCOK_OTOMATIS))
})

test('8. record yang atletnya tidak ditemukan TETAP muncul di preview', async () => {
  // Gejala v1.2.3: seluruh preview kosong. Parsing dan pencocokan harus
  // terpisah - nama yang belum cocok tidak boleh membuang recordnya.
  const { preview } = await lewatiSeluruhJalur(buatPdfTabel(tabelBesar(40)))
  const hitung = {}
  for (const p of preview) hitung[p.status] = (hitung[p.status] || 0) + 1

  assert.equal(preview.length, 40)
  assert.ok(hitung[TIDAK_DITEMUKAN] > 0, 'atlet luar harus muncul sebagai Tidak Ditemukan')
  assert.ok(hitung[SIAP_SIMPAN] > 0, 'atlet yang cocok harus siap disimpan')
  assert.equal(
    Object.values(hitung).reduce((a, b) => a + b, 0), 40,
    'seluruh record harus punya status, tidak ada yang hilang diam-diam'
  )
})

// --- 9 & 10. Jenis dan jumlah siap simpan ----------------------------------

test('9. seluruh record hasil PDF berjenis Kejuaraan', async () => {
  const { preview } = await lewatiSeluruhJalur(buatPdfTabel(TABEL_KECIL))
  assert.ok(preview.every(p => p.jenis === JENIS_IMPOR))
  const catatan = keCatatanWaktu(preview, { buatId: () => 'x' })
  assert.ok(catatan.length > 0)
  assert.ok(catatan.every(c => c.type === 'Kejuaraan'))
  assert.ok(!catatan.some(c => c.type === 'Latihan'))
})

test('10. readyCount lebih besar dari nol untuk PDF yang sah', async () => {
  const { preview } = await lewatiSeluruhJalur(buatPdfTabel(TABEL_KECIL))
  assert.equal(barisSiapSimpan(preview).length, 3)
})

test('11. readyCount nol ketika tidak satu pun atlet cocok', async () => {
  // Tombol simpan harus nonaktif pada keadaan ini.
  const asing = [['ORANG ASING SEKALI TIDAK TERDAFTAR', '12/09/2026', 'Gaya Dada', '25 meter', '00:41.14']]
  const { preview } = await lewatiSeluruhJalur(buatPdfTabel(asing))
  assert.equal(preview.length, 1, 'record tetap tampil')
  assert.equal(preview[0].status, TIDAK_DITEMUKAN)
  assert.equal(barisSiapSimpan(preview).length, 0)
})

// --- 12 & 13. Dedupe dan PB lewat jalur PDF --------------------------------

test('12. import PDF yang sama dua kali tidak menggandakan record', async () => {
  const pdf = buatPdfTabel(TABEL_KECIL)
  const pertama = await lewatiSeluruhJalur(pdf)
  const disimpan = keCatatanWaktu(pertama.preview, { buatId: () => 'TIM-1' })
  assert.equal(disimpan.length, 3)

  const kedua = await lewatiSeluruhJalur(pdf, { sudahAda: disimpan })
  assert.ok(kedua.preview.every(p => p.status === SUDAH_ADA), 'seharusnya Sudah Tersimpan')
  assert.equal(keCatatanWaktu(kedua.preview, { buatId: () => 'TIM-2' }).length, 0)
})

test('13. PB terdeteksi lewat jalur PDF penuh', async () => {
  const lama = [{ athleteId: 'ASC-0001', stroke: 'Gaya Dada', distance: 25, time: '00.45.00', date: '2026-01-01' }]
  const { preview } = await lewatiSeluruhJalur(buatPdfTabel(TABEL_KECIL), { sudahAda: lama })
  const z = preview.find(p => p.athleteId === 'ASC-0001')
  assert.equal(z.pb, true, '00.41.14 lebih cepat daripada 00.45.00')

  const lambat = [{ athleteId: 'ASC-0001', stroke: 'Gaya Dada', distance: 25, time: '00.35.00', date: '2026-01-01' }]
  const b = await lewatiSeluruhJalur(buatPdfTabel(TABEL_KECIL), { sudahAda: lambat })
  const z2 = b.preview.find(p => p.athleteId === 'ASC-0001')
  assert.equal(z2.pb, false)
  assert.equal(z2.status, SIAP_SIMPAN, 'bukan PB tetap disimpan')
})

// --- 14. DNS / DQ / DNF lewat jalur PDF ------------------------------------

test('14. DNS, DQ, dan DNF dari PDF tidak pernah menjadi waktu', async () => {
  for (const status of ['DNS', 'DQ', 'DNF']) {
    const pdf = buatPdfTabel([['ZHEVANNA ALMEERA DEEPIKA JUMAWAL', '12/09/2026', 'Gaya Dada', '25 meter', status]])
    const { preview } = await lewatiSeluruhJalur(pdf)
    assert.equal(preview.length, 1, `${status}: tetap tampil di preview`)
    assert.equal(preview[0].status, TIDAK_VALID, `${status}`)
    assert.equal(preview[0].time, '', `${status}: tidak boleh punya waktu`)
    assert.notEqual(preview[0].time, '00.00.00')
    assert.equal(keCatatanWaktu(preview, { buatId: () => 'x' }).length, 0)
  }
})

// --- 15. athleteId sebagai kunci persistence -------------------------------

test('15. payload memakai athleteId, bukan nama', async () => {
  const { preview } = await lewatiSeluruhJalur(buatPdfTabel(TABEL_KECIL))
  const catatan = keCatatanWaktu(preview, { buatId: () => 'TIM-1' })
  assert.ok(catatan.every(c => /^ASC-\d{4}$/.test(c.athleteId)), 'athleteId wajib terisi')

  // Halaman atlet/orang tua menyaring dengan athleteId.
  assert.equal(catatan.filter(c => c.athleteId === 'ASC-0001').length, 1)
  assert.equal(catatan.filter(c => c.athleteId === 'ASC-9999').length, 0)
})

// --- 16. Authorization ------------------------------------------------------

test('16. non-admin tidak dapat melakukan import', () => {
  assert.equal(bolehImporHasilLomba('admin'), true)
  for (const bukan of ['coach', 'parent', '', null]) {
    assert.equal(bolehImporHasilLomba(bukan), false, `role: ${bukan}`)
  }
})

// --- 17. PDF tidak dipersist -----------------------------------------------

test('17. byte PDF tidak ikut ke payload, dan dilepas setelah parsing', async () => {
  let pdf = buatPdfTabel(TABEL_KECIL)
  const { preview } = await lewatiSeluruhJalur(pdf)
  const catatan = keCatatanWaktu(preview, { buatId: () => 'TIM-1' })

  const teks = JSON.stringify(catatan)
  assert.ok(!teks.includes('%PDF'), 'byte PDF ikut tersimpan')
  assert.ok(!/base64/i.test(teks))

  pdf = null // pemanggil melepas byte PDF
  assert.equal(pdf, null)
  assert.equal(catatan.length, 3, 'Catatan Waktu yang sudah dibuat tidak ikut hilang')
})

test('17b. byte pemanggil tidak dirusak pdf.js', async () => {
  const pdf = buatPdfTabel(TABEL_KECIL)
  const panjangAwal = pdf.length
  await barisTeksPdf(pdf)
  assert.equal(pdf.length, panjangAwal, 'buffer pemanggil ikut dipindahkan kepemilikannya')
  assert.equal(String.fromCharCode(...pdf.subarray(0, 5)), '%PDF-')
})

// --- 18. Keadaan galat yang jelas ------------------------------------------

test('18. PDF tanpa lapisan teks ditolak dengan pesan yang tepat', async () => {
  await assert.rejects(
    () => barisTeksPdf(buatPdfTanpaTeks()),
    /tidak memiliki teks yang dapat dibaca/
  )
})

test('18b. berkas yang bukan PDF ditolak', async () => {
  await assert.rejects(() => barisTeksPdf(new Uint8Array([1, 2, 3, 4, 5])), /bukan PDF/)
})

test('18c. PDF sah tetapi bukan tabel hasil perlombaan: nol record, bukan galat', async () => {
  const sel = await barisTeksPdf(buatPdfTeks(['Surat Pemberitahuan', 'Kepada Orang Tua Atlet', 'Terima kasih.']))
  assert.ok(sel.length > 0, 'teksnya tetap terbaca')
  const preview = susunBarisImpor(uraiBarisHasil(sel), ATLET, [])
  assert.equal(preview.length, 0, 'tidak ada record, dan itu bukan kegagalan pembacaan')
})

// --- 19. Jalur non-tabel tetap bekerja -------------------------------------

test('19. PDF teks biasa berformat lima baris tetap terbaca', async () => {
  const pdf = buatPdfTeks(BARIS_ZHEVANNA)
  const { preview } = await lewatiSeluruhJalur(pdf)
  assert.equal(preview.length, 1)
  assert.equal(preview[0].athleteId, 'ASC-0001')
  assert.equal(preview[0].time, '00.41.14')
  assert.equal(preview[0].jenis, JENIS_IMPOR)
})
