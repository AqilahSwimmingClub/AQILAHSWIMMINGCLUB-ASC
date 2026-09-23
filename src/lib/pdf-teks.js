// Pengambilan teks dari PDF, berbasis POSISI.
//
// Mengapa ditulis ulang di v1.2.4
// ------------------------------
// Versi sebelumnya memindai byte PDF sendiri dan mengeluarkan teks per BARIS
// VISUAL. Pada PDF tabel hasil perlombaan yang sesungguhnya, satu sel yang
// terlalu panjang dibungkus menjadi beberapa baris visual, sehingga:
//
//   "ZHEVANNA ALMEERA DEEPIKA"   <- baris visual 1
//   "JUMAWAL"                    <- baris visual 2
//
// terbaca sebagai dua hal berbeda, dan nama atlet berakhir menjadi "JUMAWAL".
// Hal yang sama terjadi pada "Gaya" + "Punggung". Akibatnya nama tidak pernah
// cocok dengan Data Atlet dan tidak satu pun baris siap disimpan - persis
// gejala yang muncul di Android.
//
// Sekarang teks diambil lewat pdf.js beserta koordinatnya, lalu SEL tabel
// direkonstruksi: item dikelompokkan per baris visual berdasarkan Y, kolom
// dikenali dari sebaran X, dan baris visual yang merupakan sambungan digabung
// ke dalam sel kolomnya masing-masing. Keluarannya adalah isi sel yang sudah
// utuh, dalam urutan pembacaan - bentuk yang memang sudah ditangani pengurai
// record.
//
// pdf.js juga menyelesaikan hal yang tidak mungkin ditangani pemindai byte
// buatan sendiri: font subset dengan /ToUnicode CMap, yang lazim pada PDF
// keluaran Word, Excel, dan Google Docs.

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

// Worker pdf.js WAJIB berkas lokal yang ikut dikemas ke APK. Tidak ada CDN dan
// tidak ada jaringan: import PDF harus bekerja sepenuhnya offline.
// main.js memanggil ini sekali dengan URL hasil bundling Vite.
export function aturWorkerPdf(url) {
  if (url) pdfjs.GlobalWorkerOptions.workerSrc = url
}

// Toleransi Y untuk menganggap dua item berada pada baris visual yang sama.
const TOLERANSI_BARIS = 2.2

// Dua ambang yang berbeda, dan perbedaannya penting.
//
// JARAK_GABUNG_SEL: jarak maksimum antara akhir sebuah item teks dan awal item
// berikutnya supaya keduanya dianggap masih satu sel. Harus SEMPIT - kira-kira
// selebar satu spasi. Ambang yang longgar membuat seluruh baris menyatu
// menjadi satu sel, kolom tidak lagi terdeteksi, dan rekonstruksi tabel gagal.
//
// TOLERANSI_KOLOM: seberapa jauh dua posisi X boleh berbeda namun tetap
// dianggap kolom yang sama. Ini boleh lebih longgar karena isi sel yang
// berbeda panjang membuat awal kolom sedikit bergeser.
const JARAK_GABUNG_SEL = 4
const TOLERANSI_KOLOM = 12

// Kata yang menandai baris header tabel. Header berulang pada setiap halaman,
// dan harus mengakhiri baris yang sedang dikumpulkan - bukan ikut tergabung.
const KATA_HEADER = ['nama', 'tanggal', 'gaya', 'jarak', 'waktu', 'catatan', 'perlombaan', 'atlet', 'renang']

function terlihatSepertiHeader(sel) {
  const teks = sel.join(' ').toLowerCase()
  if (!teks.trim()) return false
  const cocok = KATA_HEADER.filter(k => teks.includes(k)).length
  return cocok >= 2 && !/\d{1,2}[:.]\d{2}/.test(teks)
}

// Apakah sebuah baris visual memuat kolom terakhir tabel hasil perlombaan,
// yaitu catatan waktu atau status seperti DNS/DQ/DNF.
//
// Inilah penanda paling dapat diandalkan bahwa baris itu adalah BARIS DATA,
// bukan sambungan. Menghitung jumlah kolom terisi saja tidak cukup: ketika
// dua sel terbungkus sekaligus - nama menjadi "... DI" + "ASC" dan gaya
// menjadi "Gaya" + "Kupu-kupu" - baris sambungannya mengisi dua kolom dan
// ikut dikira baris data, sehingga satu record terbelah dua.
function memuatWaktu(sel) {
  return sel.some(s =>
    /\b\d{1,2}[:.]\d{2}([:.]\d{1,2})?\b/.test(s) ||
    /^\s*(DNS|DQ|DSQ|DNF|NS|WD)\s*$/i.test(s))
}

// --- Pengelompokan item menjadi baris visual dan sel ------------------------

function barisVisual(items) {
  const bersih = items
    .filter(it => it && typeof it.str === 'string' && it.str.trim())
    .map(it => {
      const t = it.transform || []
      return { teks: it.str, x: Number(t[4]) || 0, y: Number(t[5]) || 0, lebar: Number(it.width) || 0 }
    })
  if (!bersih.length) return []

  // Y menurun dari atas ke bawah halaman.
  bersih.sort((a, b) => (b.y - a.y) || (a.x - b.x))

  const baris = []
  for (const item of bersih) {
    const terakhir = baris[baris.length - 1]
    if (terakhir && Math.abs(terakhir.y - item.y) <= TOLERANSI_BARIS) {
      terakhir.item.push(item)
      // Y baris diambil rata-rata supaya pergeseran kecil tidak menumpuk.
      terakhir.y = (terakhir.y * (terakhir.item.length - 1) + item.y) / terakhir.item.length
    } else {
      baris.push({ y: item.y, item: [item] })
    }
  }

  // Item dalam satu baris digabung menjadi sel berdasarkan jarak X.
  return baris.map(b => {
    b.item.sort((p, q) => p.x - q.x)
    const sel = []
    for (const it of b.item) {
      const terakhir = sel[sel.length - 1]
      if (terakhir && it.x - (terakhir.x + terakhir.lebar) <= JARAK_GABUNG_SEL) {
        terakhir.teks = `${terakhir.teks} ${it.teks}`.replace(/\s+/g, ' ').trim()
        terakhir.lebar = (it.x + it.lebar) - terakhir.x
      } else {
        sel.push({ teks: it.teks.trim(), x: it.x, lebar: it.lebar })
      }
    }
    return sel.filter(s => s.teks)
  }).filter(sel => sel.length)
}

// Batas kolom diambil dari posisi X sel yang paling sering muncul.
function batasKolom(semuaBaris) {
  const titik = []
  for (const sel of semuaBaris) for (const s of sel) titik.push(s.x)
  if (!titik.length) return []
  titik.sort((a, b) => a - b)

  // Kelompokkan X yang berdekatan menjadi satu kolom.
  const kolom = []
  for (const x of titik) {
    const terakhir = kolom[kolom.length - 1]
    if (terakhir && x - terakhir.x <= TOLERANSI_KOLOM) {
      terakhir.jumlah++
      terakhir.x = (terakhir.x * (terakhir.jumlah - 1) + x) / terakhir.jumlah
    } else {
      kolom.push({ x, jumlah: 1 })
    }
  }
  // Kolom yang hanya muncul sekali biasanya judul atau catatan kaki.
  return kolom.filter(k => k.jumlah >= 2).map(k => k.x).sort((a, b) => a - b)
}

function indeksKolom(x, batas) {
  let pilih = 0
  let jarak = Infinity
  batas.forEach((b, i) => {
    const d = Math.abs(x - b)
    if (d < jarak) { jarak = d; pilih = i }
  })
  return pilih
}

// --- Rekonstruksi baris logis ----------------------------------------------

// Menggabungkan baris visual menjadi baris logis tabel, lalu mengeluarkan isi
// setiap sel sebagai satu entri teks. Sel yang terbungkus ke baris berikutnya
// disambung ke sel kolomnya sendiri, bukan menjadi entri baru.
export function selDariBarisVisual(semuaBaris) {
  const batas = batasKolom(semuaBaris)
  const keluaran = []

  // Tanpa struktur kolom yang meyakinkan, teks dikeluarkan apa adanya per
  // baris visual. PDF non-tabel tetap terbaca seperti sebelumnya.
  if (batas.length < 2) {
    for (const sel of semuaBaris) keluaran.push(sel.map(s => s.teks).join(' '))
    return keluaran.filter(Boolean)
  }

  let kini = null
  const tutup = () => {
    if (!kini) return
    for (const isi of kini) if (isi && isi.trim()) keluaran.push(isi.trim())
    kini = null
  }

  for (const sel of semuaBaris) {
    const teksSel = sel.map(s => s.teks)

    if (terlihatSepertiHeader(teksSel)) { tutup(); continue }

    const kolomTerisi = new Set(sel.map(s => indeksKolom(s.x, batas)))
    // Baris data dikenali dari kehadiran kolom waktu. Tabel yang kolom
    // terakhirnya bukan waktu tetap tertangani lewat ambang jumlah kolom.
    const barisData = memuatWaktu(teksSel) ||
      kolomTerisi.size >= Math.ceil(batas.length * 0.6)

    // Baris data memulai record baru; baris sambungan menempel pada record
    // yang sedang dikumpulkan, di kolomnya sendiri.
    if (barisData && kini && kini.some(Boolean)) tutup()

    if (!kini) kini = new Array(batas.length).fill('')
    for (const s of sel) {
      const i = indeksKolom(s.x, batas)
      kini[i] = kini[i] ? `${kini[i]} ${s.teks}` : s.teks
    }
  }
  tutup()

  return keluaran
}

// --- API utama --------------------------------------------------------------

// Teks seluruh PDF sebagai daftar entri siap diurai.
//
// `bytes` adalah isi berkas PDF. Berkas TIDAK disimpan ke mana pun: seluruh
// pemrosesan terjadi di memori, dan pemanggil bebas melepaskan byte-nya
// begitu selesai.
export async function barisTeksPdf(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (data.length < 5 || String.fromCharCode(...data.subarray(0, 5)) !== '%PDF-') {
    throw new Error('Berkas ini bukan PDF yang sah.')
  }

  let dokumen
  try {
    dokumen = await pdfjs.getDocument({
      // pdf.js memindahkan kepemilikan buffer; salinan menjaga byte pemanggil.
      data: data.slice(),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: false,
      disableAutoFetch: true,
      disableStream: true
    }).promise
  } catch (galat) {
    if (/password|encrypt/i.test(galat?.message || '')) {
      throw new Error('PDF ini terkunci kata sandi, sehingga teksnya tidak dapat dibaca.')
    }
    throw new Error('PDF ini tidak dapat dibuka. Pastikan berkasnya tidak rusak.')
  }

  const keluaran = []
  try {
    for (let halaman = 1; halaman <= dokumen.numPages; halaman++) {
      const page = await dokumen.getPage(halaman)
      try {
        const isi = await page.getTextContent()
        keluaran.push(...selDariBarisVisual(barisVisual(isi.items)))
      } finally {
        page.cleanup()
      }
    }
  } finally {
    // Dokumen dilepas apa pun yang terjadi; tidak ada yang disimpan.
    await dokumen.destroy()
  }

  if (!keluaran.length) {
    throw new Error('PDF tidak memiliki teks yang dapat dibaca. Gunakan PDF hasil perlombaan berbasis teks.')
  }
  return keluaran
}
