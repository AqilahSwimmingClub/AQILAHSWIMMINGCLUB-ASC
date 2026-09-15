// Regresi audit B2: pemilihan browser tidak boleh bergantung pada path Linux
// tertentu, dan ASC_CHROME_PATH hanya dipakai bila berkasnya benar-benar ada.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { opsiPeluncur } from './bantu/browser.js'

const TESTS_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = join(TESTS_DIR, '..')

function denganEnv(nilai, fn) {
  const sebelum = process.env.ASC_CHROME_PATH
  if (nilai === undefined) delete process.env.ASC_CHROME_PATH
  else process.env.ASC_CHROME_PATH = nilai
  try { return fn() }
  finally {
    if (sebelum === undefined) delete process.env.ASC_CHROME_PATH
    else process.env.ASC_CHROME_PATH = sebelum
  }
}

test('ASC_CHROME_PATH yang tidak ada diabaikan, bukan membuat tes gagal', () => {
  const opsi = denganEnv(
    process.platform === 'win32' ? 'C:\\tidak\\ada\\chrome.exe' : '/tidak/ada/chrome',
    () => opsiPeluncur()
  )
  assert.notEqual(opsi.executablePath, '/tidak/ada/chrome')
  assert.notEqual(opsi.executablePath, 'C:\\tidak\\ada\\chrome.exe')
})

test('ASC_CHROME_PATH yang benar-benar ada dipakai apa adanya', () => {
  // Berkas yang pasti ada di semua sistem operasi: berkas tes ini sendiri.
  const berkasNyata = fileURLToPath(import.meta.url)
  const opsi = denganEnv(berkasNyata, () => opsiPeluncur())
  assert.equal(opsi.executablePath, berkasNyata)
})

test('ASC_CHROME_PATH kosong tidak memaksa executablePath apa pun', () => {
  const opsi = denganEnv('   ', () => opsiPeluncur())
  // Boleh kosong (resolusi bawaan Playwright) atau hasil pencarian folder CI,
  // yang penting bukan string kosong yang dipaksakan.
  assert.notEqual(opsi.executablePath, '')
  assert.notEqual(opsi.executablePath, '   ')
})

test('tidak ada path browser absolut yang ditulis tetap di berkas tes', () => {
  // Nama berkas relatif lintas sistem operasi (mis. "chrome-linux/chrome")
  // memang diperlukan untuk pencarian; yang dilarang adalah path ABSOLUT,
  // karena itulah yang membuat tes hanya jalan di satu mesin.
  const pathAbsolut = /(['"`])(?:\/(?:opt|usr|home|snap)\/|[A-Za-z]:\\)[^'"`\n]*(?:chrom|browser)[^'"`\n]*\1/i
  for (const berkas of ['bantu/browser.js', 'tata-letak.test.js', 'e2e-responsif.test.js']) {
    let isi = ''
    try { isi = readFileSync(join(TESTS_DIR, berkas), 'utf8') } catch { continue }
    // Baris yang hanya berisi contoh di dalam komentar tidak dihitung.
    const kode = isi.split('\n').filter(baris => !baris.trim().startsWith('//')).join('\n')
    assert.doesNotMatch(kode, pathAbsolut,
      `${berkas} masih memuat path browser absolut yang ditulis tetap`)
    assert.doesNotMatch(kode, /\/opt\/pw-browsers/,
      `${berkas} masih menunjuk folder browser bawaan image tertentu`)
  }
})

test('skrip npm tidak memaksa path browser Linux', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  Object.entries(pkg.scripts || {}).forEach(([nama, perintah]) => {
    assert.doesNotMatch(String(perintah), /\/opt\/pw-browsers/,
      `skrip "${nama}" memaksa path browser Linux`)
  })
})
