// Regresi tata letak: dijalankan di Chromium sungguhan dengan src/style.css asli.
// Menjaga tiga hal: nominal rupiah tidak keluar kartu, tidak ada horizontal
// scroll di ukuran HP/tablet/desktop, dan sidebar menjadi drawer di layar sempit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { luncurkanChromium } from './bantu/browser.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSS = readFileSync(join(ROOT, 'src/style.css'), 'utf8')

// Ukuran nyata: HP kecil -> HP besar -> tablet portrait/landscape -> desktop.
const UKURAN = [
  { nama: 'HP 360x640 portrait', width: 360, height: 640 },
  { nama: 'HP 390x844 portrait', width: 390, height: 844 },
  { nama: 'HP 412x915 portrait', width: 412, height: 915 },
  { nama: 'HP 844x390 landscape', width: 844, height: 390 },
  { nama: 'Tablet 768x1024 portrait', width: 768, height: 1024 },
  { nama: 'Tablet 1024x768 landscape', width: 1024, height: 768 },
  // Ukuran dari screenshot pengguna: dulu memakai sidebar tetap 260 px.
  { nama: 'Tablet 1080x720 landscape', width: 1080, height: 720 },
  { nama: 'Desktop 1280x800', width: 1280, height: 800 },
  { nama: 'Desktop 1920x1080', width: 1920, height: 1080 }
]

// Potongan halaman Pembayaran SPP persis seperti yang dihasilkan financeDashboard().
const KARTU = [
  ['Total Pemasukan Hari Ini', 'Rp0', 'green'],
  ['Total Pengeluaran Hari Ini', 'Rp0', 'orange'],
  ['Saldo Kas Saat Ini', 'Rp2.560.000', 'purple'],
  ['Pemasukan Bulan Ini', 'Rp128.750.000', 'green'],
  ['Pengeluaran Bulan Ini', 'Rp0', 'orange'],
  ['Saldo Bulan Ini', 'Rp0', 'purple'],
  ['Jumlah Transaksi Bulan Ini', '1', '']
]

const HALAMAN = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${CSS}</style></head><body>
<div class="app-shell app-enter">
  <aside class="sidebar"><div class="logo-box"><b>A</b><span>AQILAH SWIMMING CLUB</span></div>
    <nav>${['Dashboard', 'Notifikasi', 'Data Atlet', 'Pendaftar Baru', 'Pelatih', 'Gaji Pelatih', 'Perkembangan Atlet', 'Absensi', 'Program Latihan', 'Catatan Waktu', 'Jadwal Latihan']
      .map(n => `<button class="nav-item" data-page="x"><i>◆</i>${n}</button>`).join('')}</nav>
    <button class="danger logout">Keluar</button></aside>
  <button type="button" class="sidebar-backdrop" aria-label="Tutup menu navigasi"></button>
  <section class="main-area">
    <header class="topbar"><button id="menuBtn" class="menu-btn">☰</button>
      <div class="topbar-title"><h2>Pembayaran SPP</h2><small>Selasa, 15 September 2026</small></div>
      <button class="notification-bell">🔔</button>
      <span id="syncBadge" class="sync-badge">HP dan website sudah tersinkron</span></header>
    <main class="content">
      <div class="dashboard-kpis finance-kpis">${KARTU
        .map(([label, value, warna]) => `<article class="kpi-card ${warna}"><div><span>${label}</span><b>${value}</b></div></article>`)
        .join('')}</div>
      <div class="grid-2">
        <section class="card"><h3>Input Target Mingguan</h3>
          <label>Atlet<select><option>ASC-0001 — Clarissa Serevin Sinambela — KU 4 — -</option></select></label>
          <label>Misi Hari Ini<input placeholder="Meluncur tanpa papan 5 meter"></label>
          <label>Catatan<textarea></textarea></label>
          <button class="primary">Simpan Target</button></section>
        <section class="card"><h3>Jurnal Perkembangan Atlet</h3>
          <label>Atlet<select><option>ASC-0001 — Clarissa Serevin Sinambela — KU 4 — -</option></select></label>
          <label>Kemampuan Dasar<textarea placeholder="Pisahkan dengan koma"></textarea></label>
          <button class="primary">Simpan Jurnal</button></section>
      </div>
      <section class="card"><h3>Verifikasi Pendaftar Baru</h3><div class="table-wrap"><table>
        <thead><tr>${['Foto', 'Kode/Nama', 'JK', 'Lahir/Umur', 'WhatsApp', 'Kelas', 'Paket', 'Dokumen', 'Status', 'Aksi']
          .map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody><tr><td colspan="10" class="empty">Belum ada pendaftaran baru.</td></tr></tbody></table></div></section>
    </main>
  </section>
</div></body></html>`

let browser
test.before(async () => { browser = await luncurkanChromium() })
test.after(async () => { await browser?.close() })

async function bukaHalaman(width, height) {
  const page = await browser.newPage({ viewport: { width, height } })
  await page.setContent(HALAMAN, { waitUntil: 'load' })
  return page
}

for (const { nama, width, height } of UKURAN) {
  test(`${nama}: tidak ada horizontal scroll`, async () => {
    const page = await bukaHalaman(width, height)
    const lebar = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      klien: document.documentElement.clientWidth
    }))
    await page.close()
    // Toleransi 1 px untuk pembulatan sub-pixel.
    assert.ok(lebar.scroll <= lebar.klien + 1,
      `halaman melebar ${lebar.scroll}px pada viewport ${lebar.klien}px`)
  })

  test(`${nama}: nominal rupiah tetap di dalam kartunya`, async () => {
    const page = await bukaHalaman(width, height)
    const pelanggaran = await page.evaluate(() => {
      const hasil = []
      document.querySelectorAll('.kpi-card').forEach(kartu => {
        const kotakKartu = kartu.getBoundingClientRect()
        const nilai = kartu.querySelector('b')
        const kotakNilai = nilai.getBoundingClientRect()
        // Nilai tidak boleh melewati tepi kanan/kiri kartunya sendiri.
        if (kotakNilai.right > kotakKartu.right + 1 || kotakNilai.left < kotakKartu.left - 1) {
          hasil.push(`${nilai.textContent} keluar dari kartu ${kartu.querySelector('span').textContent}`)
        }
        // Teks juga tidak boleh terpotong secara horizontal di dalam elemennya.
        if (nilai.scrollWidth > nilai.clientWidth + 1) {
          hasil.push(`${nilai.textContent} terpotong di dalam kartunya`)
        }
      })
      return hasil
    })
    await page.close()
    assert.deepEqual(pelanggaran, [])
  })

  test(`${nama}: kartu KPI tidak saling menimpa`, async () => {
    const page = await bukaHalaman(width, height)
    const tumpang = await page.evaluate(() => {
      const kotak = [...document.querySelectorAll('.kpi-card')].map(k => k.getBoundingClientRect())
      const hasil = []
      for (let i = 0; i < kotak.length; i++) {
        for (let j = i + 1; j < kotak.length; j++) {
          const a = kotak[i], b = kotak[j]
          const beririsan = a.left < b.right - 1 && b.left < a.right - 1 &&
            a.top < b.bottom - 1 && b.top < a.bottom - 1
          if (beririsan) hasil.push(`kartu ${i + 1} dan ${j + 1} bertumpuk`)
        }
      }
      return hasil
    })
    await page.close()
    assert.deepEqual(tumpang, [])
  })

  test(`${nama}: kartu dan form tidak melewati lebar isi halaman`, async () => {
    const page = await bukaHalaman(width, height)
    const meluber = await page.evaluate(() => {
      const isi = document.querySelector('.content').getBoundingClientRect()
      const hasil = []
      document.querySelectorAll('.content .card, .content .kpi-card, .content select, .content input, .content textarea, .content button')
        .forEach(el => {
          const kotak = el.getBoundingClientRect()
          if (kotak.width > 0 && kotak.right > isi.right + 1) {
            hasil.push(`${el.tagName.toLowerCase()}.${el.className || '-'} melewati tepi kanan`)
          }
        })
      return hasil
    })
    await page.close()
    assert.deepEqual(meluber, [])
  })
}

test('layar sempit (<=1100px): sidebar menjadi drawer dan tombol menu terlihat', async () => {
  for (const { width, height } of UKURAN.filter(u => u.width <= 1100)) {
    const page = await bukaHalaman(width, height)
    const hasil = await page.evaluate(() => {
      const sidebar = document.querySelector('.sidebar')
      const tombol = document.querySelector('#menuBtn')
      const main = document.querySelector('.main-area')
      return {
        tersembunyi: sidebar.getBoundingClientRect().right <= 1,
        tombolTampil: getComputedStyle(tombol).display !== 'none',
        marginKiri: getComputedStyle(main).marginLeft
      }
    })
    await page.close()
    assert.equal(hasil.tersembunyi, true, `drawer harus tertutup pada ${width}px`)
    assert.equal(hasil.tombolTampil, true, `tombol menu harus terlihat pada ${width}px`)
    assert.equal(hasil.marginKiri, '0px', `isi halaman harus penuh pada ${width}px`)
  }
})

test('layar sempit: drawer terbuka menutupi layar dan backdrop aktif', async () => {
  const page = await bukaHalaman(1080, 720)
  await page.evaluate(() => {
    // Animasi dimatikan supaya posisi akhir dapat diukur tanpa menunggu transisi.
    const s = document.createElement('style')
    s.textContent = '*{transition:none!important;animation:none!important}'
    document.head.appendChild(s)
    document.querySelector('.sidebar').classList.add('show')
    document.querySelector('.sidebar-backdrop').classList.add('show')
  })
  const terbuka = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect()
    const backdrop = document.querySelector('.sidebar-backdrop')
    return {
      kiri: Math.round(sidebar.left),
      lebar: Math.round(sidebar.width),
      backdropTampil: getComputedStyle(backdrop).display !== 'none'
    }
  })
  await page.close()
  assert.equal(terbuka.kiri, 0, 'drawer harus tergeser penuh ke dalam layar')
  assert.ok(terbuka.lebar > 100 && terbuka.lebar <= 320, `lebar drawer ${terbuka.lebar}px`)
  assert.equal(terbuka.backdropTampil, true)
})

test('layar lebar (>1100px): sidebar tetap terpasang, bukan drawer', async () => {
  const page = await bukaHalaman(1280, 800)
  await page.waitForTimeout(700) // animasi masuk sidebar selesai dulu
  const hasil = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect()
    return {
      kiri: Math.round(sidebar.left),
      lebar: Math.round(sidebar.width),
      marginIsi: getComputedStyle(document.querySelector('.main-area')).marginLeft,
      tombolMenu: getComputedStyle(document.querySelector('#menuBtn')).display
    }
  })
  await page.close()
  assert.equal(hasil.kiri, 0, 'sidebar desktop harus terlihat')
  // Isi halaman harus digeser tepat selebar sidebar, tanpa celah atau tumpang tindih.
  assert.equal(hasil.marginIsi, `${hasil.lebar}px`)
  assert.equal(hasil.tombolMenu, 'none', 'tombol menu tidak dipakai di desktop')
})

test('tabel lebar digeser di dalam pembungkusnya, bukan melebarkan halaman', async () => {
  const page = await bukaHalaman(1024, 768)
  const hasil = await page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap')
    return {
      overflowX: getComputedStyle(wrap).overflowX,
      lebarWrap: Math.round(wrap.getBoundingClientRect().width),
      lebarIsi: Math.round(document.querySelector('.content').getBoundingClientRect().width)
    }
  })
  await page.close()
  assert.equal(hasil.overflowX, 'auto')
  assert.ok(hasil.lebarWrap <= hasil.lebarIsi + 1, 'pembungkus tabel tidak boleh melebihi isi halaman')
})


test('animasi masuk dashboard tidak memaksa drawer terbuka', async () => {
  // .app-enter memakai animation-fill-mode:both. Keyframe terakhirnya dulu
  // berisi transform:translateX(0), yang mengalahkan posisi tertutup drawer,
  // sehingga menu samping terbuka sendiri dan menutupi isi halaman.
  for (const { nama, width, height } of UKURAN.filter(u => u.width <= 1100)) {
    const page = await bukaHalaman(width, height)
    await page.waitForTimeout(700) // biarkan animasi masuk selesai
    const posisi = await page.evaluate(() => {
      const s = document.querySelector('.sidebar')
      return { kanan: s.getBoundingClientRect().right, punyaAppEnter: s.closest('.app-enter') !== null }
    })
    await page.close()
    assert.equal(posisi.punyaAppEnter, true)
    assert.ok(posisi.kanan <= 1, `${nama}: drawer terbuka sendiri setelah animasi (right=${posisi.kanan})`)
  }
})
