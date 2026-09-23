// Pengambilan teks dari PDF, tanpa library tambahan.
//
// Alasan tidak memakai pdf.js: satu-satunya yang dibutuhkan fitur Import Hasil
// Perlombaan adalah LAPISAN TEKS sebuah PDF. pdf.js membawa renderer, font
// engine, dan worker yang menambah megabyte ke APK untuk kemampuan yang tidak
// dipakai. Inflate zlib sudah tersedia di platform lewat DecompressionStream
// (Chrome/WebView Android 10 ke atas dan Node 18 ke atas), jadi cukup itu.
//
// Yang ditangani: stream FlateDecode dan stream tanpa filter, operator teks
// Tj TJ ' " dengan string literal ( ) maupun heksadesimal < >, serta pemisah
// baris dari Td TD T* dan ET.
//
// Yang TIDAK ditangani, dan memang tidak perlu: PDF terenkripsi, PDF hasil
// pindaian tanpa lapisan teks, dan font dengan pemetaan CID tidak standar.
// Ketiganya dilaporkan apa adanya lewat galat yang jelas - tidak pernah
// menghasilkan teks karangan.

const PENANDA_STREAM = 'stream'
const PENANDA_AKHIR = 'endstream'

function adaDecompressionStream() {
  return typeof DecompressionStream === 'function'
}

// Inflate satu blok byte. PDF FlateDecode memakai zlib (RFC 1950), tetapi
// sebagian penghasil PDF menulis deflate mentah, jadi keduanya dicoba.
async function inflate(bytes) {
  if (!adaDecompressionStream()) {
    throw new Error('Peramban ini tidak mendukung DecompressionStream, sehingga PDF terkompresi tidak dapat dibaca.')
  }
  for (const format of ['deflate', 'deflate-raw']) {
    try {
      const aliran = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format))
      return new Uint8Array(await new Response(aliran).arrayBuffer())
    } catch {
      // Coba format berikutnya.
    }
  }
  return null
}

// Byte PDF dibaca sebagai latin1 supaya posisi byte dan posisi karakter selalu
// satu banding satu. Ini penting karena offset `stream`/`endstream` dihitung
// dari teks, sedangkan isinya diproses sebagai byte.
function keLatin1(bytes) {
  let hasil = ''
  const potong = 0x8000
  for (let i = 0; i < bytes.length; i += potong) {
    hasil += String.fromCharCode.apply(null, bytes.subarray(i, i + potong))
  }
  return hasil
}

// Ambil seluruh isi stream, sudah di-inflate bila perlu.
async function kumpulkanStream(bytes) {
  const teks = keLatin1(bytes)
  const hasil = []
  let posisi = 0

  while (posisi < teks.length) {
    const mulai = teks.indexOf(PENANDA_STREAM, posisi)
    if (mulai === -1) break
    // Hindari salah tangkap kata 'endstream'.
    if (teks.slice(mulai - 3, mulai) === 'end') { posisi = mulai + PENANDA_STREAM.length; continue }

    const kamus = teks.slice(Math.max(0, mulai - 800), mulai)
    let isiMulai = mulai + PENANDA_STREAM.length
    if (teks[isiMulai] === '\r') isiMulai++
    if (teks[isiMulai] === '\n') isiMulai++

    const akhir = teks.indexOf(PENANDA_AKHIR, isiMulai)
    if (akhir === -1) break

    // Penulis PDF umumnya menyisipkan akhir baris sebelum `endstream`. Byte itu
    // bukan bagian dari data terkompresi, dan inflate menolaknya sebagai sisa.
    let batas = akhir
    while (batas > isiMulai && (teks[batas - 1] === '\n' || teks[batas - 1] === '\r')) batas--

    const mentah = bytes.subarray(isiMulai, batas)
    const terkompresi = /\/Filter\s*(\/FlateDecode|\[\s*\/FlateDecode)/.test(kamus)

    if (terkompresi) {
      const terbuka = await inflate(mentah)
      if (terbuka) hasil.push(terbuka)
    } else if (!/\/Filter/.test(kamus)) {
      hasil.push(mentah)
    }
    // Stream dengan filter lain (DCTDecode untuk gambar, dan sebagainya)
    // sengaja dilewati: isinya bukan teks.

    posisi = akhir + PENANDA_AKHIR.length
  }
  return hasil
}

// Urai string literal PDF: (teks) dengan escape \( \) \\ \n \r \t \b \f dan oktal.
function uraiLiteral(teks, mulai) {
  let hasil = ''
  let dalam = 1
  let i = mulai
  while (i < teks.length) {
    const c = teks[i]
    if (c === '\\') {
      const n = teks[i + 1]
      const peta = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }
      if (n in peta) { hasil += peta[n]; i += 2; continue }
      const oktal = teks.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)
      if (oktal) { hasil += String.fromCharCode(parseInt(oktal[0], 8)); i += 1 + oktal[0].length; continue }
      if (n === '\n') { i += 2; continue } // sambungan baris
      i += 2
      continue
    }
    if (c === '(') { dalam++; hasil += c; i++; continue }
    if (c === ')') { dalam--; if (!dalam) return { teks: hasil, akhir: i + 1 }; hasil += c; i++; continue }
    hasil += c
    i++
  }
  return { teks: hasil, akhir: i }
}

// Urai string heksadesimal PDF: <48656C6C6F>
function uraiHex(isi) {
  const bersih = isi.replace(/[^0-9a-fA-F]/g, '')
  const genap = bersih.length % 2 ? bersih + '0' : bersih
  let hasil = ''
  for (let i = 0; i < genap.length; i += 2) {
    hasil += String.fromCharCode(parseInt(genap.slice(i, i + 2), 16))
  }
  // UTF-16BE dengan BOM dipakai sebagian penghasil PDF.
  if (hasil.charCodeAt(0) === 0xfe && hasil.charCodeAt(1) === 0xff) {
    let utf = ''
    for (let i = 2; i + 1 < hasil.length; i += 2) {
      utf += String.fromCharCode((hasil.charCodeAt(i) << 8) | hasil.charCodeAt(i + 1))
    }
    return utf
  }
  return hasil
}

// Ambil teks dari satu content stream.
export function teksDariContentStream(isi) {
  const teks = typeof isi === 'string' ? isi : keLatin1(isi)
  const keluaran = []
  let baris = ''
  let i = 0

  const akhiriBaris = () => {
    const rapi = baris.trim()
    if (rapi) keluaran.push(rapi)
    baris = ''
  }

  while (i < teks.length) {
    const c = teks[i]

    if (c === '(') {
      const { teks: isiLiteral, akhir } = uraiLiteral(teks, i + 1)
      baris += isiLiteral
      i = akhir
      continue
    }

    if (c === '<' && teks[i + 1] !== '<') {
      const tutup = teks.indexOf('>', i + 1)
      if (tutup === -1) break
      baris += uraiHex(teks.slice(i + 1, tutup))
      i = tutup + 1
      continue
    }

    // Operator yang memindahkan posisi teks dianggap sebagai pindah baris.
    if (c === 'T' && (teks[i + 1] === 'd' || teks[i + 1] === 'D' || teks[i + 1] === '*')) {
      akhiriBaris()
      i += 2
      continue
    }
    if (c === 'E' && teks.slice(i, i + 2) === 'ET') {
      akhiriBaris()
      i += 2
      continue
    }

    i++
  }
  akhiriBaris()
  return keluaran
}

// Teks seluruh PDF sebagai daftar baris.
//
// `bytes` adalah Uint8Array/ArrayBuffer isi berkas PDF. Berkas TIDAK disimpan
// ke mana pun: seluruh pemrosesan terjadi di memori dan pemanggil bebas
// melepaskan byte-nya begitu selesai.
export async function barisTeksPdf(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (data.length < 5 || keLatin1(data.subarray(0, 5)) !== '%PDF-') {
    throw new Error('Berkas ini bukan PDF yang sah.')
  }
  if (/\/Encrypt\b/.test(keLatin1(data.subarray(0, Math.min(data.length, 4096))))) {
    throw new Error('PDF ini terkunci kata sandi, sehingga teksnya tidak dapat dibaca.')
  }

  const aliran = await kumpulkanStream(data)
  const baris = []
  for (const blok of aliran) baris.push(...teksDariContentStream(blok))

  if (!baris.length) {
    throw new Error('PDF ini tidak memiliki lapisan teks yang dapat dibaca. Kemungkinan berupa hasil pindaian atau foto, sehingga harus diinput manual.')
  }
  return baris
}
