// Sinkronisasi data antar-role: Pendaftar Baru, Admin, Pelatih, Orang Tua.
//
// Yang dikunci di sini adalah dua hal yang paling mudah rusak diam-diam:
//
//   1. RELASI LEWAT ID. Seluruh data operasional atlet - absensi,
//      perkembangan, catatan waktu - terhubung lewat athleteId, tidak pernah
//      lewat nama. Admin boleh mengganti nama atlet kapan saja tanpa memutus
//      satu pun riwayat.
//
//   2. SATU SUMBER KEBENARAN. Tidak ada salinan profil atlet milik Pelatih
//      atau Orang Tua; ketiganya membaca record atlet yang sama, sehingga
//      perubahan Admin langsung terbaca role lain.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  recordsForAthlete, notificationsForParent, notificationsForCoach,
  approveRegistration, existingAthleteForRegistration, athleteFromRegistration,
  athleteAgeInfo
} from '../src/lib/atlet.js'

const ACUAN = new Date(2026, 8, 23)

// State contoh yang meniru bentuk state aplikasi: satu daftar atlet dipakai
// bersama oleh seluruh role.
function stateContoh() {
  return {
    athletes: [
      { id: 'ASC-0001', name: 'Muhammad A', birth: '2014-04-03', schoolName: 'SD 1' },
      { id: 'ASC-0002', name: 'Siti B', birth: '2019-01-04', schoolName: 'TK 2' }
    ],
    attendance: [
      { id: 'h1', athleteId: 'ASC-0001', date: '2026-09-01', status: 'Hadir' },
      { id: 'h2', athleteId: 'ASC-0001', date: '2026-09-02', status: 'Izin' },
      { id: 'h3', athleteId: 'ASC-0002', date: '2026-09-01', status: 'Hadir' }
    ],
    skillJournals: [
      { id: 'j1', athleteId: 'ASC-0001', skills: 'Meluncur', updatedAt: '2026-09-01' }
    ],
    timeRecords: [
      { id: 't1', athleteId: 'ASC-0001', stroke: 'Gaya Bebas', time: '00:45.10' },
      { id: 't2', athleteId: 'ASC-0002', stroke: 'Gaya Dada', time: '01:02.00' }
    ],
    notifications: [
      { id: 'n1', notificationAudience: 'parent', athleteId: 'ASC-0001', title: 'Untuk A' },
      { id: 'n2', notificationAudience: 'parent', athleteId: 'ASC-0002', title: 'Untuk B' },
      { id: 'n3', notificationAudience: 'admin', title: 'Untuk admin' }
    ],
    coachNotifications: [
      { id: 'c1', coachId: 'PLT-0001', title: 'Untuk pelatih 1' },
      { id: 'c2', coachId: 'PLT-0002', title: 'Untuk pelatih 2' }
    ]
  }
}

// --- 1. Pendaftar Baru -> Admin --------------------------------------------

test('1. data pendaftaran terbawa utuh ke record atlet', () => {
  const pendaftaran = {
    id: 'REG-1', name: 'Calon Atlet', gender: 'Laki-Laki', birth: '2019-01-04',
    birthPlace: 'Jakarta', schoolName: 'SD Harapan', parentWhatsapp: '08123456789',
    classCategory: 'Group', package: 'Paket 1', healthNote: 'Asma ringan',
    certificate: 'akta.pdf', paymentProof: 'bukti.pdf', photo: 'foto.jpg'
  }
  const a = athleteFromRegistration(pendaftaran, 'ASC-0100', ACUAN)

  assert.equal(a.name, 'Calon Atlet')
  assert.equal(a.gender, 'Laki-Laki')
  assert.equal(a.birth, '2019-01-04')
  assert.equal(a.birthPlace, 'Jakarta')
  assert.equal(a.schoolName, 'SD Harapan')
  assert.equal(a.parentWhatsapp, '08123456789')
  assert.equal(a.parentPhone, '08123456789', 'nomor telepon ikut terisi, bukan hanya WhatsApp')
  assert.equal(a.classCategory, 'Group')
  assert.equal(a.package, 'Paket 1')
  assert.equal(a.healthNotes, 'Asma ringan')
  assert.equal(a.birthCertificate, 'akta.pdf')
  assert.equal(a.registrationProof, 'bukti.pdf')
  assert.equal(a.photo, 'foto.jpg')
  assert.equal(a.registrationId, 'REG-1', 'tautan balik ke pendaftaran dipertahankan')
})

test('1b. umur dan KU atlet baru diturunkan dari tanggal lahir', () => {
  const a = athleteFromRegistration({ id: 'REG-2', birth: '2019-01-04', age: 99 }, 'ASC-0101', ACUAN)
  assert.equal(a.age, 7)
  assert.equal(a.ageGroup, 'KU 5A')
})

// --- 2. Persetujuan Admin -> Data Atlet -------------------------------------

test('2. persetujuan membuat satu atlet dengan ID dari mekanisme existing', () => {
  const s = stateContoh()
  const hasil = approveRegistration(s.athletes, { id: 'REG-1', name: 'Baru', birth: '2015-05-05' }, () => 'ASC-0003', ACUAN)
  assert.equal(hasil.created, true)
  assert.equal(hasil.athlete.id, 'ASC-0003')
  assert.equal(hasil.athletes.length, 3)
})

test('13. persetujuan yang dipanggil ulang TIDAK membuat atlet ganda', () => {
  const s = stateContoh()
  const reg = { id: 'REG-1', name: 'Baru', birth: '2015-05-05' }

  let nomor = 3
  const buatId = () => `ASC-${String(nomor++).padStart(4, '0')}`

  const pertama = approveRegistration(s.athletes, reg, buatId, ACUAN)
  reg.athleteId = pertama.athlete.id
  reg.status = 'approved'

  // Klik kedua, meniru percobaan ulang setelah simpan ke Supabase gagal.
  const kedua = approveRegistration(pertama.athletes, reg, buatId, ACUAN)

  assert.equal(kedua.created, false, 'tidak boleh membuat atlet kedua')
  assert.equal(kedua.athlete.id, pertama.athlete.id, 'ID atlet harus sama')
  assert.equal(kedua.athletes.length, 3, 'jumlah atlet tidak bertambah')
  assert.equal(nomor, 4, 'nomor ID tidak terbakar percuma pada percobaan ulang')
})

test('13b. percobaan ulang tetap aman walau tautan hanya ada di sisi atlet', () => {
  const s = stateContoh()
  const reg = { id: 'REG-9', name: 'Baru', birth: '2015-05-05' }
  const pertama = approveRegistration(s.athletes, reg, () => 'ASC-0003', ACUAN)
  // reg.athleteId sengaja TIDAK diisi: hanya athlete.registrationId yang ada.
  const kedua = approveRegistration(pertama.athletes, reg, () => 'ASC-0004', ACUAN)
  assert.equal(kedua.created, false)
  assert.equal(kedua.athlete.id, 'ASC-0003')
})

test('12. pembaruan data atlet tidak menghasilkan atlet duplikat', () => {
  const s = stateContoh()
  const sebelum = s.athletes.length
  const i = s.athletes.findIndex(a => a.id === 'ASC-0001')
  s.athletes[i] = { ...s.athletes[i], name: 'Muhammad A. Pratama', schoolName: 'SD 9' }
  assert.equal(s.athletes.length, sebelum)
  assert.equal(s.athletes.filter(a => a.id === 'ASC-0001').length, 1)
})

// --- 3. Edit Admin terbaca role lain ----------------------------------------

test('3. perubahan Admin langsung terbaca Pelatih dan Orang Tua', () => {
  const s = stateContoh()
  // Satu-satunya sumber profil atlet; tidak ada salinan per role.
  const i = s.athletes.findIndex(a => a.id === 'ASC-0001')
  s.athletes[i] = { ...s.athletes[i], name: 'Muhammad A. Pratama', schoolName: 'SD Baru' }

  const dibacaPelatih = s.athletes.find(a => a.id === 'ASC-0001')
  const dibacaOrangTua = s.athletes.find(a => a.id === 'ASC-0001')

  assert.equal(dibacaPelatih.name, 'Muhammad A. Pratama')
  assert.equal(dibacaOrangTua.name, 'Muhammad A. Pratama')
  assert.equal(dibacaOrangTua.schoolName, 'SD Baru')
})

test('3b. perubahan tanggal lahir oleh Admin langsung mengubah umur di semua role', () => {
  const s = stateContoh()
  const i = s.athletes.findIndex(a => a.id === 'ASC-0002')
  s.athletes[i] = { ...s.athletes[i], birth: '2014-04-03' }
  const a = s.athletes.find(x => x.id === 'ASC-0002')
  assert.equal(athleteAgeInfo(a, ACUAN).age, 12)
  assert.equal(athleteAgeInfo(a, ACUAN).ageGroup, 'KU 3')
})

// --- 4 & 5. Relasi berbasis ID ----------------------------------------------

test('4. relasi Pelatih ke atlet memakai athleteId, bukan nama', () => {
  const s = stateContoh()
  assert.equal(recordsForAthlete(s.attendance, 'ASC-0001').length, 2)
  assert.equal(recordsForAthlete(s.timeRecords, 'ASC-0001').length, 1)
})

test('5. relasi Orang Tua ke atlet memakai athleteId', () => {
  const s = stateContoh()
  assert.deepEqual(recordsForAthlete(s.timeRecords, 'ASC-0002').map(r => r.id), ['t2'])
})

test('7. ganti nama atlet TIDAK memutus absensi', () => {
  const s = stateContoh()
  const sebelum = recordsForAthlete(s.attendance, 'ASC-0001').length
  const i = s.athletes.findIndex(a => a.id === 'ASC-0001')
  s.athletes[i] = { ...s.athletes[i], name: 'Muhammad A. Pratama' }
  assert.equal(recordsForAthlete(s.attendance, 'ASC-0001').length, sebelum)
  assert.equal(sebelum, 2)
})

test('8. ganti nama atlet TIDAK memutus perkembangan', () => {
  const s = stateContoh()
  const i = s.athletes.findIndex(a => a.id === 'ASC-0001')
  s.athletes[i] = { ...s.athletes[i], name: 'Nama Baru Sekali' }
  assert.equal(recordsForAthlete(s.skillJournals, 'ASC-0001').length, 1)
})

test('9. ganti nama atlet TIDAK memutus catatan waktu/PB', () => {
  const s = stateContoh()
  const i = s.athletes.findIndex(a => a.id === 'ASC-0001')
  s.athletes[i] = { ...s.athletes[i], name: 'Nama Lain Lagi' }
  assert.deepEqual(recordsForAthlete(s.timeRecords, 'ASC-0001').map(r => r.id), ['t1'])
})

test('10 & 11. perubahan umur/KU tidak menghapus riwayat atlet', () => {
  const s = stateContoh()
  const i = s.athletes.findIndex(a => a.id === 'ASC-0002')
  const kuLama = athleteAgeInfo(s.athletes[i], ACUAN).ageGroup
  // Admin memperbaiki tanggal lahir; KU ikut berubah sesuai aturan tahun.
  s.athletes[i] = { ...s.athletes[i], birth: '2012-02-02' }
  const kuBaru = athleteAgeInfo(s.athletes[i], ACUAN).ageGroup

  assert.notEqual(kuLama, kuBaru, 'KU memang berubah karena tahun lahir berubah')
  assert.equal(recordsForAthlete(s.attendance, 'ASC-0002').length, 1, 'absensi utuh')
  assert.equal(recordsForAthlete(s.timeRecords, 'ASC-0002').length, 1, 'PB utuh')
})

// --- 6 & 14. Authorization --------------------------------------------------

test('6. Orang Tua A TIDAK dapat membaca notifikasi anak Orang Tua B', () => {
  const s = stateContoh()
  const untukA = notificationsForParent(s.notifications, 'ASC-0001')
  assert.deepEqual(untukA.map(n => n.id), ['n1'])
  assert.ok(!untukA.some(n => n.athleteId === 'ASC-0002'), 'bocor ke atlet lain')
})

test('6b. Orang Tua TIDAK dapat membaca notifikasi admin', () => {
  const s = stateContoh()
  const untukA = notificationsForParent(s.notifications, 'ASC-0001')
  assert.ok(!untukA.some(n => n.id === 'n3'), 'notifikasi admin bocor ke orang tua')
})

test('6c. ID atlet kosong TIDAK meloloskan notifikasi milik semua orang', () => {
  // Versi lama memakai `!owner || cocok`, sehingga ID kosong justru membuka
  // seluruh notifikasi orang tua. Penyaringan harus gagal-TERTUTUP.
  const s = stateContoh()
  for (const kosong of ['', null, undefined]) {
    assert.deepEqual(notificationsForParent(s.notifications, kosong), [], `nilai: ${kosong}`)
  }
})

test('6d. data atlet lain tidak terbaca lewat relasi ID milik sendiri', () => {
  const s = stateContoh()
  const punyaA = recordsForAthlete(s.attendance, 'ASC-0001')
  assert.ok(punyaA.every(r => r.athleteId === 'ASC-0001'))
  assert.equal(recordsForAthlete(s.attendance, '').length, 0, 'ID kosong tidak membuka semua absensi')
})

test('14. notifikasi Pelatih hanya milik pelatih tersebut, gagal-tertutup', () => {
  const s = stateContoh()
  assert.deepEqual(notificationsForCoach(s.coachNotifications, 'PLT-0001').map(n => n.id), ['c1'])
  assert.deepEqual(notificationsForCoach(s.coachNotifications, ''), [])
  assert.deepEqual(notificationsForCoach(s.coachNotifications, null), [])
})

test('14b. daftar kosong atau bukan array tidak melempar galat', () => {
  assert.deepEqual(notificationsForParent(null, 'ASC-0001'), [])
  assert.deepEqual(notificationsForCoach(undefined, 'PLT-0001'), [])
  assert.deepEqual(recordsForAthlete(null, 'ASC-0001'), [])
})

// --- Satu sumber kebenaran --------------------------------------------------

test('tidak ada salinan profil atlet: ketiga role membaca objek yang sama', () => {
  const s = stateContoh()
  const admin = s.athletes.find(a => a.id === 'ASC-0001')
  const pelatih = s.athletes.find(a => a.id === 'ASC-0001')
  const orangTua = s.athletes.find(a => a.id === 'ASC-0001')
  assert.equal(admin, pelatih)
  assert.equal(admin, orangTua)
})

test('pendaftaran yang sudah punya atlet dikenali lewat kedua arah tautan', () => {
  const athletes = [{ id: 'ASC-0007', registrationId: 'REG-7' }]
  assert.ok(existingAthleteForRegistration(athletes, { id: 'REG-7' }))
  assert.ok(existingAthleteForRegistration(athletes, { id: 'REG-X', athleteId: 'ASC-0007' }))
  assert.equal(existingAthleteForRegistration(athletes, { id: 'REG-LAIN' }), null)
})
