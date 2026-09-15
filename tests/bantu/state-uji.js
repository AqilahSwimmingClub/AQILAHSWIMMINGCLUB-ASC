// State pengujian yang aman: seluruhnya data fiktif, tanpa kredensial asli dan
// tanpa data atlet sungguhan. Ditanam ke localStorage sebelum aplikasi dimuat,
// sehingga E2E masuk sebagai Admin tanpa mengetik kata sandi apa pun dan setiap
// halaman punya isi nyata untuk diukur (nominal panjang, tabel, grafik, form).

const HARI_INI = '2026-09-15'
const BULAN_INI = '2026-09'
const WAKTU = `${HARI_INI}T08:00:00.000Z`

const atlet = [
  { id: 'ASC-9001', name: 'Uji Satu Nama Atlet Yang Panjang Sekali', photo: '', birth: '2014-04-03', gender: 'L', trainingCategory: 'Prestasi', trainingGroups: ['KU 3'], parentWhatsapp: '0800000001' },
  { id: 'ASC-9002', name: 'Uji Dua', photo: '', birth: '2016-05-06', gender: 'P', trainingCategory: 'Pemula', trainingGroups: ['KU 4'], parentWhatsapp: '0800000002' },
  { id: 'ASC-9003', name: 'Uji Tiga', photo: '', birth: '2019-07-07', gender: 'L', trainingCategory: 'Pemula', trainingGroups: ['KU 5A'], parentWhatsapp: '0800000003' }
]

const pelatih = [
  { id: 'PLT-9001', name: 'Pelatih Uji', username: 'pelatihuji', password: 'x', active: true, mustChangePassword: false, photo: '' }
]

// Nominal sengaja besar: inilah kasus yang dulu keluar/menimpa kartu lain.
const keuangan = [
  { id: 'FIN-uji-1', direction: 'income', referenceType: 'payment', referenceId: 'PAY-1', amount: 128750000, category: 'SPP', transactionType: 'spp', description: 'Pemasukan SPP bulan berjalan', transactionDate: `${BULAN_INI}-02T08:00:00.000Z`, createdBy: 'Uji', createdRole: 'admin' },
  { id: 'FIN-uji-2', direction: 'income', referenceType: 'payment', referenceId: 'PAY-2', amount: 2560000, category: 'LOMBA', transactionType: 'competition', description: 'Pemasukan lomba', transactionDate: `${HARI_INI}T08:00:00.000Z`, createdBy: 'Uji', createdRole: 'admin' },
  { id: 'FIN-uji-3', direction: 'expense', referenceType: 'coach_salary', referenceId: 'SAL-1', amount: 45300000, category: 'GAJI', transactionType: 'salary', description: 'Pengeluaran gaji pelatih', transactionDate: `${HARI_INI}T09:00:00.000Z`, createdBy: 'Uji', createdRole: 'admin' },
  { id: 'FIN-uji-4', direction: 'expense', referenceType: 'lainnya', referenceId: 'OPS-1', amount: 875000, category: 'LAINNYA', transactionType: 'manual', description: 'Pengeluaran operasional', transactionDate: `${BULAN_INI}-04T08:00:00.000Z`, createdBy: 'Uji', createdRole: 'admin' }
]

export const STATE_UJI = {
  athletes: atlet,
  coaches: pelatih,
  attendance: [
    { id: 'ATT-uji-1', athleteId: 'ASC-9001', athleteName: atlet[0].name, date: HARI_INI, status: 'hadir', note: '' },
    { id: 'ATT-uji-2', athleteId: 'ASC-9002', athleteName: atlet[1].name, date: HARI_INI, status: 'izin', note: 'Sakit' }
  ],
  timeRecords: [
    { id: 'TIM-uji-1', athleteId: 'ASC-9001', athleteName: atlet[0].name, date: HARI_INI, stroke: 'Gaya Bebas', distance: '50', time: '00:35.20', note: '' },
    { id: 'TIM-uji-2', athleteId: 'ASC-9001', athleteName: atlet[0].name, date: HARI_INI, stroke: 'Gaya Dada', distance: '50', time: '00:44.10', note: '' }
  ],
  trainingPrograms: [
    { id: 'PRG-uji-1', title: 'Program Uji Ketahanan', date: HARI_INI, categories: ['Prestasi'], groups: ['KU 3'], duration: '90 menit', totalMeters: 2000, details: 'Pemanasan\nInti\nPendinginan', image: '' }
  ],
  payments: [
    { id: 'PAY-1', athleteId: 'ASC-9001', athleteName: atlet[0].name, paymentType: 'spp', month: BULAN_INI, amount: 128750000, status: 'approved', submittedAt: WAKTU, proof: '' },
    { id: 'PAY-2', athleteId: 'ASC-9002', athleteName: atlet[1].name, paymentType: 'competition', competitionName: 'Kejuaraan Uji', amount: 2560000, status: 'pending', submittedAt: WAKTU, proof: '' }
  ],
  schedules: [
    { id: 'SCH-uji-1', day: 'Jumat', time: '16:00', location: 'Kolam Renang Uji', group: 'Prestasi' }
  ],
  announcements: [
    { id: 'ANN-uji-1', title: 'Pengumuman Uji', body: 'Isi pengumuman untuk pengujian tata letak.', date: HARI_INI }
  ],
  pendingRegistrations: [
    { id: 'REG-uji-1', name: 'Calon Atlet Uji', gender: 'P', birth: '2017-01-01', parentWhatsapp: '0800000009', classCategory: 'Pemula', package: 'Paket A', status: 'pending', submittedAt: WAKTU, healthNote: '' }
  ],
  notifications: [
    { id: 'NTF-uji-1', type: 'spp_payment', title: 'Notifikasi Uji', message: 'Pesan notifikasi untuk pengujian.', target: 'payments', notificationAudience: 'admin', createdAt: WAKTU, read: false }
  ],
  coachNotifications: [],
  financeTransactions: keuangan,
  competitions: [
    { id: 'CMP-uji-1', title: 'Kejuaraan Uji Tingkat Provinsi', eventDate: '2026-11-01', location: 'Kolam Uji', registrationDeadline: '2026-10-20', organizer: 'Panitia Uji', feePerRace: 150000, flyer: '', description: 'Event untuk pengujian.' }
  ],
  competitionRegistrations: [
    { id: 'CRG-uji-1', athleteId: 'ASC-9001', athleteName: atlet[0].name, competitionId: 'CMP-uji-1', competitionTitle: 'Kejuaraan Uji Tingkat Provinsi', races: ['50m Gaya Bebas'], amount: 150000, status: 'submitted', submittedAt: WAKTU, proof: '' }
  ],
  weeklyTargets: [
    { id: 'WTG-uji-1', athleteId: 'ASC-9001', mission: 'Meluncur tanpa papan 5 meter', status: 'Belum Dinilai', note: '', coachName: 'Pelatih Uji', updatedAt: WAKTU }
  ],
  skillJournals: [
    { id: 'SKJ-uji-1', athleteId: 'ASC-9001', coachName: 'Pelatih Uji', mastered: ['Meluncur'], notYet: ['Menyelam'], freestyle: 'Belum Mulai', breaststroke: 'Belum Mulai', backstroke: 'Belum Mulai', butterfly: 'Belum Mulai', note: '', updatedAt: WAKTU }
  ],
  drylandTasks: [],
  rescheduleRequests: [],
  athletePackages: [
    { id: 'PKG-uji-1', athleteId: 'ASC-9001', packageName: 'Paket A', remainingSessions: 8, expiryDate: '2026-12-31', updatedAt: WAKTU }
  ],
  invoices: [
    { id: 'INV-uji-1', athleteId: 'ASC-9001', athleteName: atlet[0].name, type: 'spp', title: 'Tagihan SPP September', amount: 128750000, dueDate: '2026-09-30', status: 'unpaid', description: 'Tagihan uji nominal panjang' },
    { id: 'INV-uji-2', athleteId: 'ASC-9002', athleteName: atlet[1].name, type: 'competition', title: 'Tagihan Lomba', amount: 2560000, dueDate: '2026-10-05', status: 'paid', description: '' }
  ],
  coachSalaries: [
    { id: 'SAL-1', coachId: 'PLT-9001', coachName: 'Pelatih Uji', period: BULAN_INI, amount: 45300000, status: 'paid', paidAt: WAKTU, note: 'Gaji uji', proof: '', updatedAt: WAKTU }
  ],
  auditTrail: [],
  versionHistory: [],
  parentReminders: {}
}

// Nama kunci cache harus sama persis dengan MODULE_CACHE_KEYS di src/main.js.
export const KUNCI_CACHE = {
  athletes: 'asc_cache_athletes', attendance: 'asc_cache_attendance', timeRecords: 'asc_cache_time_records',
  trainingPrograms: 'asc_cache_training_programs', payments: 'asc_cache_payments', schedules: 'asc_cache_schedules',
  announcements: 'asc_cache_announcements', coaches: 'asc_cache_coaches', pendingRegistrations: 'asc_cache_registrations',
  notifications: 'asc_cache_notifications', coachNotifications: 'asc_cache_coach_notifications',
  financeTransactions: 'asc_cache_finance_transactions', competitions: 'asc_cache_competitions',
  competitionRegistrations: 'asc_cache_competition_registrations', weeklyTargets: 'asc_cache_weekly_targets',
  skillJournals: 'asc_cache_skill_journals', drylandTasks: 'asc_cache_dryland_tasks',
  rescheduleRequests: 'asc_cache_reschedule_requests', athletePackages: 'asc_cache_athlete_packages',
  invoices: 'asc_cache_invoices', coachSalaries: 'asc_cache_coach_salaries', auditTrail: 'asc_cache_audit_trail',
  versionHistory: 'asc_cache_version_history', parentReminders: 'asc_cache_parent_reminders'
}

// Tanam state uji sebelum skrip aplikasi berjalan.
export async function seedStateUji(page, state = STATE_UJI) {
  await page.addInitScript(({ data, kunci }) => {
    try {
      // Sesi admin tanpa mengetik kredensial apa pun.
      localStorage.setItem('asc_role', 'admin')
      localStorage.setItem('asc_current_page', 'dashboard')
      localStorage.setItem('aqilah_sc_data', JSON.stringify({
        storageVersion: 2,
        settings: { clubName: 'AQILAH Swimming Club', coachName: 'Pelatih Uji' },
        session: { role: 'admin', currentPage: 'dashboard' }
      }))
      Object.entries(kunci).forEach(([koleksi, key]) => {
        if (data[koleksi] !== undefined) localStorage.setItem(key, JSON.stringify(data[koleksi]))
      })
    } catch (error) {
      console.warn('State uji tidak dapat ditanam', error)
    }
  }, { data: state, kunci: KUNCI_CACHE })
}
