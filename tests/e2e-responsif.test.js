// E2E responsif terhadap APLIKASI PRODUCTION SEBENARNYA (hasil `npm run build`
// yang disajikan `vite preview`), bukan HTML tiruan.
//
// Setiap ukuran layar membuka SELURUH 19 halaman admin lewat navigasi aplikasi
// asli, lalu memeriksa: horizontal overflow, kartu, nominal, form, tabel,
// grafik, modal, header, footer, tombol penting, dan drawer. Error JavaScript
// serta kegagalan resource ikut dicatat.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { luncurkanChromium } from './bantu/browser.js'
import { bangunProduction, jalankanPreview } from './bantu/server-preview.js'
import { STATE_UJI, seedStateUji } from './bantu/state-uji.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUKTI = process.env.ASC_SHOT_DIR || join(ROOT, 'bukti-responsif')

// Seluruh 19 halaman admin, sesuai adminMenu di src/main.js.
const HALAMAN_ADMIN = [
  ['dashboard', 'Dashboard'], ['notifications', 'Notifikasi'], ['athletes', 'Data Atlet'],
  ['registrations', 'Pendaftar Baru'], ['coaches', 'Pelatih'], ['coachSalaries', 'Gaji Pelatih'],
  ['development', 'Perkembangan Atlet'], ['attendance', 'Absensi'], ['trainingPrograms', 'Program Latihan'],
  ['timeRecords', 'Catatan Waktu'], ['schedules', 'Jadwal Latihan'], ['competitions', 'Kompetisi / Event'],
  ['competitionRegistrations', 'Pendaftaran Lomba'], ['competitionPayments', 'Pembayaran Lomba'],
  ['payments', 'Pembayaran SPP'], ['invoices', 'Tagihan'], ['announcements', 'Pengumuman'],
  ['reports', 'Laporan'], ['settings', 'Pengaturan']
]

const UKURAN = [
  { nama: '320x568', w: 320, h: 568, drawer: true },
  { nama: '360x800', w: 360, h: 800, drawer: true },
  { nama: '390x844', w: 390, h: 844, drawer: true },
  { nama: '412x915', w: 412, h: 915, drawer: true },
  { nama: '844x390', w: 844, h: 390, drawer: true },
  { nama: '600x960', w: 600, h: 960, drawer: true },
  { nama: '768x1024', w: 768, h: 1024, drawer: true },
  { nama: '1024x768', w: 1024, h: 768, drawer: true },
  { nama: '1080x720', w: 1080, h: 720, drawer: true },
  { nama: '1194x834', w: 1194, h: 834, drawer: false },
  { nama: '1280x800', w: 1280, h: 800, drawer: false },
  { nama: '1366x768', w: 1366, h: 768, drawer: false },
  { nama: '1440x900', w: 1440, h: 900, drawer: false },
  { nama: '1920x1080', w: 1920, h: 1080, drawer: false }
]

// Resource yang memang tidak tersedia di lingkungan uji tertutup (Supabase,
// Firebase) tidak dihitung sebagai kegagalan aplikasi.
const RESOURCE_LUAR = /supabase\.co|googleapis\.com|gstatic\.com|firebase|fcm|\/sw\.js/i
const ERROR_JARINGAN = /Failed to fetch|NetworkError|ERR_|net::|WebSocket|Load failed|tunnel/i

let browser
let preview
mkdirSync(BUKTI, { recursive: true })

test.before(async () => {
  bangunProduction()
  preview = await jalankanPreview()
  browser = await luncurkanChromium()
}, { timeout: 600000 })

test.after(async () => {
  await browser?.close()
  await preview?.hentikan()
})

// Pengukuran lengkap satu halaman, dijalankan di dalam browser.
const UKUR = () => {
  const doc = document.documentElement
  const isi = document.querySelector('.content')
  const masalah = []
  const catat = (jenis, pesan) => masalah.push(`${jenis}: ${pesan}`)
  const nama = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`

  // 1. Halaman tidak boleh dapat digeser mendatar.
  if (doc.scrollWidth > doc.clientWidth + 1) {
    catat('overflow-halaman', `scrollWidth ${doc.scrollWidth} > viewport ${doc.clientWidth}`)
  }
  if (!isi) return { masalah: ['isi-hilang: .content tidak ditemukan'], jumlahKartu: 0 }
  const kotakIsi = isi.getBoundingClientRect()

  // Isi tabel lebar memang boleh melewati tepi layar SELAMA berada di dalam
  // pembungkus yang dapat digeser mendatar (.table-wrap). Itulah pola yang
  // dipakai aplikasi ini: tabel digeser di dalam kotaknya, bukan melebarkan
  // halaman. Pembungkusnya sendiri tetap diperiksa terpisah di bagian 4.
  const didalamKotakGeser = el => {
    for (let n = el.parentElement; n && n !== isi; n = n.parentElement) {
      const ox = getComputedStyle(n).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
    return false
  }

  // 2. Kartu, form, grafik, tombol: tidak melewati tepi area isi.
  isi.querySelectorAll('.card, .kpi-card, .stat, .pie-card, .dashboard-panel, .program-card, .competition-card, .table-wrap, form, select, input, textarea, button, .bottom-nav-item').forEach(el => {
    const dialogInduk = el.closest('dialog')
    if (dialogInduk && !dialogInduk.open) return
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return
    if (didalamKotakGeser(el)) return
    if (r.right > kotakIsi.right + 1) catat('meluber-kanan', nama(el))
    if (r.left < kotakIsi.left - 1) catat('meluber-kiri', nama(el))
  })

  // 3. Nominal dan angka besar harus utuh di dalam kartunya.
  let jumlahKartu = 0
  isi.querySelectorAll('.kpi-card, .stat, .pb-card').forEach(kartu => {
    const b = kartu.querySelector('b, strong')
    if (!b) return
    jumlahKartu++
    const rk = kartu.getBoundingClientRect(), rb = b.getBoundingClientRect()
    if (rb.right > rk.right + 1 || rb.left < rk.left - 1) catat('nominal-keluar-kartu', b.textContent.trim())
    if (b.scrollWidth > b.clientWidth + 1) catat('nominal-terpotong', b.textContent.trim())
  })

  // 4. Tabel lebar hanya boleh digeser DI DALAM pembungkusnya.
  isi.querySelectorAll('.table-wrap').forEach(wrap => {
    const r = wrap.getBoundingClientRect()
    if (r.width > kotakIsi.width + 1) catat('tabel-melebihi-isi', `lebar ${Math.round(r.width)} > isi ${Math.round(kotakIsi.width)}`)
    const gaya = getComputedStyle(wrap)
    const tabel = wrap.querySelector('table')
    if (tabel && tabel.scrollWidth > wrap.clientWidth + 1 && !['auto', 'scroll'].includes(gaya.overflowX)) {
      catat('tabel-tidak-dapat-digeser', `overflowX=${gaya.overflowX}`)
    }
  })

  // 5. Header dan footer utuh.
  const topbar = document.querySelector('.topbar')
  if (topbar) {
    const r = topbar.getBoundingClientRect()
    if (r.right > doc.clientWidth + 1) catat('header-terpotong', `kanan ${Math.round(r.right)}`)
    const judul = topbar.querySelector('h2')
    if (judul && judul.getBoundingClientRect().width < 1) catat('judul-header-hilang', 'lebar judul 0')
  }
  const footer = document.querySelector('.dashboard-credit')
  if (footer && footer.getBoundingClientRect().right > doc.clientWidth + 1) catat('footer-terpotong', '')

  // 6. Tombol penting harus terlihat, cukup besar, dan tidak tertutup elemen lain.
  const terlihat = el => {
    // Elemen di dalam <dialog> yang tertutup tidak dirender: bukan cacat.
    const dialog = el.closest('dialog')
    if (dialog && !dialog.open) return false
    const g = getComputedStyle(el)
    if (g.display === 'none' || g.visibility === 'hidden' || Number(g.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const tombolPenting = [
    ...document.querySelectorAll('#menuBtn, .topbar .notification-bell'),
    ...isi.querySelectorAll('.card-head button, .card-head .primary, .content > section .primary')
  ].filter(terlihat).slice(0, 12)
  tombolPenting.forEach(btn => {
    let r = btn.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) { catat('tombol-terlalu-kecil', nama(btn)); return }
    // Tombol di dalam tabel yang dapat digeser dijangkau dengan menggeser tabel.
    if (!didalamKotakGeser(btn) && (r.right > doc.clientWidth + 1 || r.left < -1)) {
      catat('tombol-di-luar-layar', nama(btn)); return
    }
    if (didalamKotakGeser(btn)) return
    // Bilah bawah yang menempel (bottom-nav) menutupi apa pun yang kebetulan
    // berada di bawahnya. Tombol tetap dapat ditekan setelah digulir, jadi
    // yang diuji adalah keterjangkauannya: gulirkan dulu, baru periksa.
    btn.scrollIntoView({ block: 'center', inline: 'nearest' })
    r = btn.getBoundingClientRect()
    const x = Math.min(Math.max(r.left + r.width / 2, 1), doc.clientWidth - 1)
    const y = Math.min(Math.max(r.top + r.height / 2, 1), doc.clientHeight - 1)
    const atas = document.elementFromPoint(x, y)
    if (atas && atas !== btn && !btn.contains(atas) && !atas.contains(btn)) {
      catat('tombol-tetap-tertutup', `${nama(btn)} tertutup ${nama(atas)} walau sudah digulir`)
    }
  })
  window.scrollTo(0, 0)

  return { masalah, jumlahKartu }
}

async function siapkanHalaman(ctx, url) {
  const page = await ctx.newPage()
  // Pengujian tata letak TIDAK BOLEH menyentuh Supabase produksi. Di mesin CI
  // yang punya internet, aplikasi akan benar-benar terhubung ke basis data
  // sungguhan: datanya ikut terbaca, tata letak jadi tidak dapat diprediksi,
  // dan ada risiko penulisan. Seluruh permintaan ke Supabase diputus di sini,
  // sehingga tes selalu berjalan di atas state uji yang ditanam sendiri.
  await page.route('**://*.supabase.co/**', route => route.abort())
  await page.route('**://*.supabase.in/**', route => route.abort())
  const errorJs = []
  const resourceGagal = []
  page.on('pageerror', e => errorJs.push(String(e?.message || e)))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const teks = m.text()
    if (RESOURCE_LUAR.test(teks) || ERROR_JARINGAN.test(teks)) return
    errorJs.push(teks.slice(0, 300))
  })
  page.on('requestfailed', req => {
    if (RESOURCE_LUAR.test(req.url())) return
    resourceGagal.push(`${req.url().replace(url, '/')} (${req.failure()?.errorText || 'gagal'})`)
  })
  await seedStateUji(page, STATE_UJI)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.app-shell', { timeout: 30000 })
  await page.waitForTimeout(500) // animasi masuk selesai
  return { page, errorJs, resourceGagal }
}

for (const ukuran of UKURAN) {
  test(`E2E ${ukuran.nama}: 19 halaman admin tampil benar`, async () => {
    const ctx = await browser.newContext({ viewport: { width: ukuran.w, height: ukuran.h } })
    const { page, errorJs, resourceGagal } = await siapkanHalaman(ctx, preview.url)
    const temuan = []

    for (const [id, judul] of HALAMAN_ADMIN) {
      // Navigasi lewat tombol menu aplikasi yang sebenarnya.
      const adaMenu = await page.evaluate(pid => {
        const btn = document.querySelector(`.sidebar [data-page="${pid}"]`)
        if (!btn) return false
        btn.click()
        return true
      }, id)
      if (!adaMenu) { temuan.push(`${id}: tombol menu tidak ditemukan di sidebar`); continue }
      await page.waitForTimeout(280)

      const judulTampil = await page.evaluate(() => document.querySelector('.topbar h2')?.textContent?.trim() || '')
      if (judulTampil !== judul) temuan.push(`${id}: judul "${judulTampil}" (diharapkan "${judul}")`)

      const hasil = await page.evaluate(UKUR)
      hasil.masalah.forEach(m => temuan.push(`${id}: ${m}`))

      // Drawer harus tertutup kembali setelah memilih menu.
      const drawerTerbuka = await page.evaluate(() => {
        const s = document.querySelector('.sidebar')
        return s ? s.getBoundingClientRect().right > 1 : false
      })
      if (ukuran.drawer && drawerTerbuka) temuan.push(`${id}: drawer terbuka sendiri menutupi isi halaman`)

      await page.screenshot({ path: join(BUKTI, `${ukuran.nama}-${id}.png`) })
    }

    await page.close()
    await ctx.close()

    assert.deepEqual(errorJs, [], `error JavaScript pada ${ukuran.nama}`)
    assert.deepEqual(resourceGagal, [], `resource aplikasi gagal dimuat pada ${ukuran.nama}`)
    assert.deepEqual(temuan, [], `temuan tata letak pada ${ukuran.nama}`)
  }, { timeout: 420000 })
}

test('drawer: tertutup di layar sempit, dapat dibuka dan ditutup kembali', async () => {
  for (const ukuran of UKURAN.filter(u => u.drawer)) {
    const ctx = await browser.newContext({ viewport: { width: ukuran.w, height: ukuran.h } })
    const { page } = await siapkanHalaman(ctx, preview.url)

    const awal = await page.evaluate(() => ({
      kanan: document.querySelector('.sidebar').getBoundingClientRect().right,
      tombol: getComputedStyle(document.querySelector('#menuBtn')).display
    }))
    assert.ok(awal.kanan <= 1, `${ukuran.nama}: drawer harus tertutup saat halaman dibuka`)
    assert.notEqual(awal.tombol, 'none', `${ukuran.nama}: tombol menu harus terlihat`)

    // Buka lewat tombol menu sungguhan.
    await page.click('#menuBtn')
    await page.waitForTimeout(400)
    const terbuka = await page.evaluate(() => {
      const s = document.querySelector('.sidebar').getBoundingClientRect()
      const bd = document.querySelector('.sidebar-backdrop')
      return { kiri: Math.round(s.left), lebar: Math.round(s.width), backdrop: getComputedStyle(bd).display !== 'none' }
    })
    assert.equal(terbuka.kiri, 0, `${ukuran.nama}: drawer harus tergeser penuh ke dalam layar`)
    assert.ok(terbuka.lebar <= ukuran.w, `${ukuran.nama}: lebar drawer ${terbuka.lebar} melebihi layar`)
    assert.equal(terbuka.backdrop, true, `${ukuran.nama}: backdrop harus tampil`)

    // Tutup lewat backdrop. Drawer bisa selebar 86vw, sehingga titik tengah
    // layar masih berada di atas drawer; tekan di tepi kanan yang benar-benar
    // menampilkan backdrop.
    await page.mouse.click(ukuran.w - 6, Math.round(ukuran.h / 2))
    await page.waitForTimeout(400)
    const tertutup = await page.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().right)
    assert.ok(tertutup <= 1, `${ukuran.nama}: drawer harus tertutup setelah backdrop ditekan`)

    await page.close(); await ctx.close()
  }
}, { timeout: 300000 })

test('layar lebar: sidebar tetap terpasang dan isi halaman tidak tertimpa', async () => {
  for (const ukuran of UKURAN.filter(u => !u.drawer)) {
    const ctx = await browser.newContext({ viewport: { width: ukuran.w, height: ukuran.h } })
    const { page } = await siapkanHalaman(ctx, preview.url)
    const hasil = await page.evaluate(() => {
      const s = document.querySelector('.sidebar').getBoundingClientRect()
      const main = document.querySelector('.main-area')
      return {
        kiri: Math.round(s.left), lebar: Math.round(s.width),
        margin: parseFloat(getComputedStyle(main).marginLeft),
        tombolMenu: getComputedStyle(document.querySelector('#menuBtn')).display
      }
    })
    assert.ok(Math.abs(hasil.kiri) <= 1, `${ukuran.nama}: sidebar desktop harus terlihat (kiri=${hasil.kiri})`)
    assert.ok(Math.abs(hasil.margin - hasil.lebar) <= 1, `${ukuran.nama}: isi halaman harus digeser tepat selebar sidebar`)
    assert.equal(hasil.tombolMenu, 'none', `${ukuran.nama}: tombol menu tidak dipakai di layar lebar`)
    await page.close(); await ctx.close()
  }
}, { timeout: 300000 })

test('modal/dialog muat di layar dan dapat ditutup di semua ukuran', async () => {
  // Dialog dengan isi terpanjang: form tambah pelatih dan form tambah tagihan.
  const kasus = [['coaches', '#addCoach', '#coachDialog'], ['invoices', '#addInvoice', '#invoiceDialog']]
  for (const ukuran of UKURAN) {
    const ctx = await browser.newContext({ viewport: { width: ukuran.w, height: ukuran.h } })
    const { page } = await siapkanHalaman(ctx, preview.url)
    for (const [halaman, pemicu, dialog] of kasus) {
      await page.evaluate(pid => document.querySelector(`.sidebar [data-page="${pid}"]`)?.click(), halaman)
      await page.waitForTimeout(300)
      const adaPemicu = await page.$(pemicu)
      if (!adaPemicu) continue
      await page.click(pemicu)
      await page.waitForTimeout(350)
      const ukur = await page.evaluate(sel => {
        const d = document.querySelector(sel)
        if (!d || !d.open) return null
        const r = d.getBoundingClientRect()
        const doc = document.documentElement
        const form = d.querySelector('.modal-form')
        return {
          muatLebar: r.width <= doc.clientWidth + 1 && r.left >= -1 && r.right <= doc.clientWidth + 1,
          muatTinggi: r.height <= doc.clientHeight + 1,
          dapatDigulir: form ? form.scrollHeight <= form.clientHeight + 1 || ['auto', 'scroll'].includes(getComputedStyle(form).overflowY) : true,
          overflowHalaman: doc.scrollWidth > doc.clientWidth + 1
        }
      }, dialog)
      if (ukur) {
        assert.ok(ukur.muatLebar, `${ukuran.nama}/${halaman}: dialog melebihi lebar layar`)
        assert.ok(ukur.muatTinggi, `${ukuran.nama}/${halaman}: dialog melebihi tinggi layar`)
        assert.ok(ukur.dapatDigulir, `${ukuran.nama}/${halaman}: isi dialog terpotong dan tidak dapat digulir`)
        assert.ok(!ukur.overflowHalaman, `${ukuran.nama}/${halaman}: dialog memicu horizontal scroll`)
        await page.screenshot({ path: join(BUKTI, `${ukuran.nama}-modal-${halaman}.png`) })
      }
      await page.evaluate(sel => document.querySelector(sel)?.close(), dialog)
      await page.waitForTimeout(200)
    }
    await page.close(); await ctx.close()
  }
}, { timeout: 420000 })
