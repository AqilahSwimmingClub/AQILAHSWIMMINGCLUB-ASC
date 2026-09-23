// PDF uji dibuat oleh GENERATOR SUNGGUHAN, bukan dirangkai tangan.
//
// Ini penting. Fixture buatan tangan di v1.2.3 menulis satu baris teks per
// entri, sehingga pengurai yang hanya membaca baris visual tampak benar -
// padahal pada PDF tabel yang sesungguhnya sel yang panjang terbungkus ke
// beberapa baris dan pengurai itu gagal total.
//
// jsPDF + jspdf-autotable sudah menjadi dependensi aplikasi ini (dipakai untuk
// ekspor laporan). Keluarannya PDF nyata: teks terkompresi, tabel dengan
// kolom, sel yang terbungkus, dan header yang terulang di setiap halaman.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

export const KEPALA_ASC = [
  ['Nama Atlet', 'Tanggal Perlombaan', 'Gaya Renang', 'Jarak Perlombaan', 'Catatan Waktu']
]

// Tabel hasil perlombaan bergaya ASC.
//
// `baris` adalah array of array sesuai KEPALA_ASC.
export function buatPdfTabel(baris, { judul = 'ASC Catatan Waktu', kepala = KEPALA_ASC, startY = 20 } = {}) {
  const doc = new jsPDF()
  if (judul) doc.text(judul, 14, 14)
  autoTable(doc, { head: kepala, body: baris, startY, styles: { fontSize: 9 } })
  return new Uint8Array(doc.output('arraybuffer'))
}

// PDF berisi teks biasa tanpa tabel, untuk memastikan jalur non-tabel tetap
// bekerja seperti sebelumnya.
export function buatPdfTeks(baris, { judul = '' } = {}) {
  const doc = new jsPDF()
  let y = 20
  if (judul) { doc.text(judul, 14, 14); y = 26 }
  for (const b of baris) { doc.text(String(b), 14, y); y += 8 }
  return new Uint8Array(doc.output('arraybuffer'))
}

// PDF tanpa lapisan teks sama sekali, meniru hasil pindaian.
export function buatPdfTanpaTeks() {
  const doc = new jsPDF()
  doc.setFillColor(200, 200, 200)
  doc.rect(20, 20, 100, 60, 'F')
  return new Uint8Array(doc.output('arraybuffer'))
}
