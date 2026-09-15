// Peluncur Chromium yang portabel untuk Linux CI, Windows, dan macOS.
//
// Tidak ada satu pun path absolut yang ditulis tetap di berkas ini.
// Urutan pencariannya:
//   1. ASC_CHROME_PATH — dipakai HANYA bila diisi dan berkasnya benar-benar ada.
//      Bila diisi tetapi tidak ada, tes tidak gagal; pencarian dilanjutkan.
//   2. Browser bawaan Playwright (hasil `npx playwright install chromium`).
//      Inilah jalur normal di Linux CI maupun Windows.
//   3. Bila PLAYWRIGHT_BROWSERS_PATH diset (mis. image CI yang sudah memuat
//      browser lebih dulu) tetapi versinya tidak sama persis dengan yang
//      diharapkan Playwright, berkas chromium di dalam folder itu dipakai.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

// Nama berkas browser pada tiap sistem operasi.
const KANDIDAT_RELATIF = [
  'chrome-linux/chrome',
  'chrome-linux64/chrome',
  'chrome-win/chrome.exe',
  'chrome-win64/chrome.exe',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'
]

function berkasAda(path) {
  try { return Boolean(path) && existsSync(path) && statSync(path).isFile() }
  catch { return false }
}

// Cari berkas chromium di dalam folder browser yang sudah disiapkan lingkungan.
function cariDiFolderBrowser(root) {
  if (!root) return ''
  // Banyak image menyediakan symlink stabil bernama "chromium".
  const symlink = join(root, 'chromium')
  if (berkasAda(symlink)) return symlink
  let isi = []
  try { isi = readdirSync(root) } catch { return '' }
  const folderChromium = isi
    .filter(nama => /^chromium(-|_)/.test(nama) && !nama.includes('headless'))
    .sort()
    .reverse()
  for (const folder of folderChromium) {
    for (const relatif of KANDIDAT_RELATIF) {
      const kandidat = join(root, folder, relatif)
      if (berkasAda(kandidat)) return kandidat
    }
  }
  return ''
}

// Kembalikan opsi launch. Objek kosong berarti memakai resolusi bawaan Playwright.
export function opsiPeluncur() {
  const dariEnv = String(process.env.ASC_CHROME_PATH || '').trim()
  if (berkasAda(dariEnv)) return { executablePath: dariEnv }
  if (dariEnv) {
    console.warn(`ASC_CHROME_PATH="${dariEnv}" tidak ditemukan; memakai browser bawaan Playwright.`)
  }

  // Jalur normal: browser yang dipasang Playwright untuk versinya sendiri.
  let bawaan = ''
  try { bawaan = chromium.executablePath() } catch { bawaan = '' }
  if (berkasAda(bawaan)) return {}

  // Cadangan: image CI yang memuat browser lebih dulu di PLAYWRIGHT_BROWSERS_PATH.
  const dariFolder = cariDiFolderBrowser(String(process.env.PLAYWRIGHT_BROWSERS_PATH || '').trim())
  if (dariFolder) {
    console.warn(`Browser bawaan Playwright tidak ada; memakai ${dariFolder} dari PLAYWRIGHT_BROWSERS_PATH.`)
    return { executablePath: dariFolder }
  }
  return {}
}

export async function luncurkanChromium(extra = {}) {
  try {
    return await chromium.launch({ ...opsiPeluncur(), ...extra })
  } catch (error) {
    throw new Error(
      'Chromium untuk Playwright tidak dapat dijalankan. ' +
      'Jalankan "npx playwright install chromium" terlebih dahulu, ' +
      'atau set ASC_CHROME_PATH ke berkas browser yang tersedia.\n' +
      `Penyebab asli: ${error?.message || error}`
    )
  }
}
