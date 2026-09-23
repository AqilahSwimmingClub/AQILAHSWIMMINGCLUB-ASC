// Membuat PDF berisi lapisan teks, untuk menguji pengurai tanpa berkas biner
// yang ikut masuk repositori. Strukturnya minimal tetapi sah: header, katalog,
// satu halaman, dan satu content stream berisi operator teks.
import { deflateSync } from 'node:zlib'

function escapePdf(teks) {
  return String(teks).replace(/([\\()])/g, '\\$1')
}

// baris: array string. Setiap baris menjadi satu operasi Td + Tj.
export function buatPdfTeks(baris, { kompres = true } = {}) {
  const isi = ['BT', '/F1 12 Tf']
  baris.forEach((b, i) => {
    isi.push(`1 0 0 1 72 ${700 - i * 16} Td`)
    isi.push(`(${escapePdf(b)}) Tj`)
  })
  isi.push('ET')
  const contentText = isi.join('\n')
  const contentBytes = kompres
    ? new Uint8Array(deflateSync(Buffer.from(contentText, 'latin1')))
    : new Uint8Array(Buffer.from(contentText, 'latin1'))

  const objek = []
  objek[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objek[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
  objek[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
  objek[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'

  const bagian = []
  const tulis = s => bagian.push(Buffer.from(s, 'latin1'))

  tulis('%PDF-1.4\n')
  for (const nomor of [1, 2, 3]) tulis(`${nomor} 0 obj\n${objek[nomor]}\nendobj\n`)

  const kamus = kompres
    ? `<< /Length ${contentBytes.length} /Filter /FlateDecode >>`
    : `<< /Length ${contentBytes.length} >>`
  tulis(`4 0 obj\n${kamus}\nstream\n`)
  bagian.push(Buffer.from(contentBytes))
  tulis('\nendstream\nendobj\n')

  tulis(`5 0 obj\n${objek[5]}\nendobj\n`)
  tulis('trailer\n<< /Size 6 /Root 1 0 R >>\n%%EOF\n')

  return new Uint8Array(Buffer.concat(bagian))
}

// PDF tanpa lapisan teks sama sekali, meniru hasil pindaian.
export function buatPdfTanpaTeks() {
  const bagian = [Buffer.from('%PDF-1.4\n', 'latin1')]
  bagian.push(Buffer.from('1 0 obj\n<< /Type /Catalog >>\nendobj\n', 'latin1'))
  bagian.push(Buffer.from('trailer\n<< /Size 2 /Root 1 0 R >>\n%%EOF\n', 'latin1'))
  return new Uint8Array(Buffer.concat(bagian))
}
