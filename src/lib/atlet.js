// Umur, kelompok umur (KU), dan relasi data atlet dipusatkan di sini.
//
// Alasan modul ini ada: umur sempat dihitung terhadap tanggal acuan yang
// dipatok mati (1 Januari 2026), sehingga atlet kelahiran 4 Januari 2019
// tetap tercatat 6 tahun pada 23 September 2026 - padahal sudah 7 tahun.
// Rumus umur juga tersebar di beberapa tempat. Satu sumber kebenaran
// menghindari keduanya, dan membuat aturannya dapat diuji tanpa DOM.
//
// TANGGAL LAHIR adalah source of truth. Umur tidak pernah disimpan sebagai
// angka statis: nilai apa pun yang tersimpan selalu dihitung ulang dari
// tanggal lahir terhadap tanggal sistem.

// --- Umur -------------------------------------------------------------------

// Tanggal lahir diterima sebagai 'YYYY-MM-DD', Date, atau apa pun yang dapat
// diurai Date. Bentuk 'YYYY-MM-DD' sengaja diurai sebagai waktu LOKAL, bukan
// UTC, supaya ulang tahun tidak bergeser sehari di zona waktu Indonesia.
function uraiTanggal(nilai) {
  if (nilai instanceof Date) return Number.isNaN(nilai.getTime()) ? null : nilai
  const teks = String(nilai || '').trim()
  if (!teks) return null
  const cocok = teks.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (cocok) {
    const [, th, bl, tg] = cocok
    const d = new Date(Number(th), Number(bl) - 1, Number(tg))
    // Menolak tanggal yang tidak ada, mis. 2019-02-30 yang digeser JS ke Maret.
    if (d.getFullYear() !== Number(th) || d.getMonth() !== Number(bl) - 1 || d.getDate() !== Number(tg)) return null
    return d
  }
  const d = new Date(teks)
  return Number.isNaN(d.getTime()) ? null : d
}

// Umur dalam tahun penuh pada tanggal acuan.
//
// umur = tahun acuan - tahun lahir, dikurangi 1 bila ulang tahun pada tahun
// acuan belum terjadi. Mengembalikan '' bila tanggal lahir tidak sah, supaya
// tampilan tidak pernah menampilkan angka yang dikarang.
export function calculateAge(dateOfBirth, referenceDate = new Date()) {
  const lahir = uraiTanggal(dateOfBirth)
  if (!lahir) return ''
  const acuan = uraiTanggal(referenceDate)
  if (!acuan) return ''

  let umur = acuan.getFullYear() - lahir.getFullYear()
  const bulanBelumLewat = acuan.getMonth() < lahir.getMonth()
  const hariBelumLewat = acuan.getMonth() === lahir.getMonth() && acuan.getDate() < lahir.getDate()
  if (bulanBelumLewat || hariBelumLewat) umur--

  return Math.max(0, umur)
}

// --- Kelompok Umur (KU) -----------------------------------------------------

// ATURAN KU EXISTING ASC, dipertahankan apa adanya.
//
// KU ditentukan oleh TAHUN KELAHIRAN dengan batas tahun tetap (cut-off), BUKAN
// oleh umur berjalan. Karena itu memperbaiki perhitungan umur tidak mengubah
// KU seorang atlet pun - dan memang tidak boleh mengubahnya.
//
// Tabel ini adalah penulisan ulang yang setara persis dari rantai if lama:
//   y<=2010 KU 1; y<=2012 KU 2; y<=2014 KU 3; y<=2016 KU 4; y<=2018 KU 5B;
//   selain itu KU 5A.
export const ATURAN_KU = Object.freeze([
  Object.freeze({ sampaiTahun: 2010, ku: 'KU 1' }),
  Object.freeze({ sampaiTahun: 2012, ku: 'KU 2' }),
  Object.freeze({ sampaiTahun: 2014, ku: 'KU 3' }),
  Object.freeze({ sampaiTahun: 2016, ku: 'KU 4' }),
  Object.freeze({ sampaiTahun: 2018, ku: 'KU 5B' })
])

export const KU_TERMUDA = 'KU 5A'

// KU dari tanggal lahir. Hanya tahunnya yang dipakai, sesuai aturan existing.
export function ageGroupFor(dateOfBirth) {
  const tahun = Number(String(dateOfBirth || '').slice(0, 4))
  if (!tahun) return ''
  for (const aturan of ATURAN_KU) {
    if (tahun <= aturan.sampaiTahun) return aturan.ku
  }
  return KU_TERMUDA
}

// Umur dan KU sebuah record atlet, selalu diturunkan dari tanggal lahir.
// Nilai `age`/`ageGroup` yang tersimpan sengaja diabaikan: nilai tersimpan
// bisa basi, tanggal lahir tidak.
export function athleteAgeInfo(athlete, referenceDate = new Date()) {
  const lahir = athlete?.birth || athlete?.dateOfBirth || ''
  return { age: calculateAge(lahir, referenceDate), ageGroup: ageGroupFor(lahir) }
}

// --- Relasi data operasional ------------------------------------------------

// Seluruh data operasional atlet terhubung lewat athleteId, tidak pernah lewat
// nama. Nama boleh berubah kapan saja tanpa memutus absensi, perkembangan,
// maupun catatan waktu.
export function recordsForAthlete(list, athleteId) {
  const id = String(athleteId || '')
  if (!id) return []
  return (Array.isArray(list) ? list : []).filter(r => String(r?.athleteId || '') === id)
}

// --- Notifikasi -------------------------------------------------------------

export function notificationAudienceOf(n) {
  return n?.notificationAudience || n?.recipientRole || 'admin'
}

export function notificationOwnerId(n) {
  return String(n?.athleteId || n?.coachId || n?.recipientId || '')
}

// Penyaringan notifikasi bersifat GAGAL-TERTUTUP: tanpa pemilik yang jelas,
// hasilnya kosong. Versi lama memakai `!owner || cocok`, sehingga ID pemilik
// yang kosong justru meloloskan notifikasi SELURUH orang tua ke satu akun.
export function notificationsForParent(notifications, athleteId) {
  const owner = String(athleteId || '')
  if (!owner) return []
  return (Array.isArray(notifications) ? notifications : [])
    .filter(n => notificationAudienceOf(n) === 'parent' && notificationOwnerId(n) === owner)
}

export function notificationsForCoach(notifications, coachId) {
  const owner = String(coachId || '')
  if (!owner) return []
  return (Array.isArray(notifications) ? notifications : [])
    .filter(n => String(n?.coachId || n?.recipientId || '') === owner)
}

// --- Persetujuan pendaftaran ------------------------------------------------

// Menyusun record atlet dari sebuah pendaftaran. Umur dan KU diturunkan dari
// tanggal lahir, bukan disalin dari formulir pendaftaran yang bisa saja basi.
export function athleteFromRegistration(registration, athleteId, referenceDate = new Date()) {
  const r = registration || {}
  const { age, ageGroup } = athleteAgeInfo({ birth: r.birth }, referenceDate)
  return {
    id: athleteId,
    name: r.name,
    photo: r.photo || '',
    birth: r.birth,
    age,
    ageGroup,
    gender: r.gender || '',
    classCategory: r.classCategory || '',
    healthNotes: r.healthNote || '',
    birthCertificate: r.certificate || '',
    registrationProof: r.paymentProof || '',
    package: r.package || '',
    parentWhatsapp: r.parentWhatsapp || '',
    parentPhone: r.parentWhatsapp || '',
    birthPlace: r.birthPlace || '',
    schoolName: r.schoolName || '',
    parentPassword: '',
    parentMustChange: true,
    registrationId: r.id,
    trainingCategory: r.trainingCategory || 'Pemula',
    trainingGroups: Array.isArray(r.trainingGroups) ? r.trainingGroups : [ageGroup].filter(Boolean)
  }
}

// Mencari atlet yang SUDAH dibuat dari sebuah pendaftaran, supaya persetujuan
// yang diulang tidak melahirkan atlet kedua.
//
// Pencocokan lewat dua jalur karena keduanya bisa saja tertulis lebih dulu:
// registration.athleteId yang menunjuk balik, dan athlete.registrationId.
export function existingAthleteForRegistration(athletes, registration) {
  const daftar = Array.isArray(athletes) ? athletes : []
  const r = registration || {}
  const idTertaut = String(r.athleteId || '')
  if (idTertaut) {
    const lewatTautan = daftar.find(a => String(a?.id || '') === idTertaut)
    if (lewatTautan) return lewatTautan
  }
  const idPendaftaran = String(r.id || '')
  if (!idPendaftaran) return null
  return daftar.find(a => String(a?.registrationId || '') === idPendaftaran) || null
}

// Persetujuan pendaftaran yang IDEMPOTEN.
//
// Dulu handler-nya selalu melakukan push atlet baru. Bila penyimpanan ke
// Supabase gagal, render() tidak pernah dijalankan sehingga tombol Konfirmasi
// masih terpampang; klik kedua membuat atlet KEDUA dengan ID berbeda untuk
// orang yang sama. Sekarang pendaftaran yang sudah punya atlet mengembalikan
// atlet itu juga.
//
// `buatId` dipanggil HANYA ketika atlet memang belum ada, supaya nomor ID
// tidak terbakar percuma pada percobaan ulang.
export function approveRegistration(athletes, registration, buatId, referenceDate = new Date()) {
  const daftar = Array.isArray(athletes) ? athletes : []
  const sudahAda = existingAthleteForRegistration(daftar, registration)
  if (sudahAda) {
    return { athletes: daftar, athlete: sudahAda, created: false }
  }
  const athleteId = typeof buatId === 'function' ? buatId() : String(buatId || '')
  const athlete = athleteFromRegistration(registration, athleteId, referenceDate)
  return { athletes: daftar.concat([athlete]), athlete, created: true }
}
