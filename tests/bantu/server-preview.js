// Menjalankan build production lalu menyajikannya lewat `vite preview`,
// sehingga E2E menguji aplikasi yang benar-benar dikirim ke pengguna,
// bukan HTML tiruan. Portabel: memakai npm/npx, tanpa path sistem tertentu.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx'

export function bangunProduction({ paksa = false } = {}) {
  const sudahAda = existsSync(join(ROOT, 'dist', 'index.html'))
  if (sudahAda && !paksa && process.env.ASC_SKIP_BUILD === '1') {
    return { dibangun: false, alasan: 'ASC_SKIP_BUILD=1 dan dist/ sudah ada' }
  }
  const hasil = spawnSync(NPM, ['run', 'build'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' })
  if (hasil.status !== 0) {
    throw new Error(`Build production gagal:\n${hasil.stdout || ''}\n${hasil.stderr || ''}`)
  }
  return { dibangun: true }
}

// Menunggu server siap. "localhost" bisa mengarah ke ::1 sementara Vite hanya
// mendengarkan di IPv4 (atau sebaliknya), jadi kedua host dicoba dan yang
// berhasil itulah yang dipakai sebagai alamat pengujian.
async function tungguSiap(hosts, port, batasMs = 60000) {
  const mulai = Date.now()
  let terakhir = ''
  while (Date.now() - mulai < batasMs) {
    for (const host of hosts) {
      const url = `http://${host}:${port}/`
      try {
        const res = await fetch(url, { redirect: 'follow' })
        if (res.ok) return url
        terakhir = `${url} -> HTTP ${res.status}`
      } catch (error) { terakhir = `${url} -> ${String(error?.message || error)}` }
    }
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error(`Server preview tidak siap dalam ${batasMs}ms. Terakhir: ${terakhir}`)
}

// Jalankan vite preview pada porta bebas dan kembalikan {url, hentikan()}.
export async function jalankanPreview({ port = Number(process.env.ASC_PREVIEW_PORT || 4178) } = {}) {
  // detached:true membuat proses punya grup sendiri, sehingga seluruh anak
  // (npx -> vite -> esbuild) dapat dihentikan sekaligus. Tanpa ini proses vite
  // tetap hidup dan Node tidak pernah keluar setelah tes selesai.
  const proses = spawn(NPX, ['vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32'
  })
  let log = ''
  proses.stdout?.on('data', d => { log += d.toString() })
  proses.stderr?.on('data', d => { log += d.toString() })

  let url = ''
  try {
    url = await tungguSiap(['127.0.0.1', 'localhost', '[::1]'], port)
  } catch (error) {
    try { proses.kill() } catch { /* sudah berhenti */ }
    throw new Error(`${error.message}\nKeluaran vite preview:\n${log}`)
  }
  // Pipa keluaran di-unref supaya tidak menahan event loop Node tetap hidup.
  proses.stdout?.unref?.()
  proses.stderr?.unref?.()

  function bunuhSeluruhGrup(sinyal) {
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(proses.pid), '/T', '/F'], { shell: true })
      } else {
        // Angka negatif = seluruh grup proses, bukan hanya pembungkus npx.
        process.kill(-proses.pid, sinyal)
      }
    } catch { /* proses sudah berhenti */ }
  }

  return {
    url,
    hentikan: () => new Promise(resolve => {
      if (proses.exitCode !== null) return resolve()
      let selesai = false
      const tuntas = () => { if (!selesai) { selesai = true; resolve() } }
      proses.once('exit', tuntas)
      bunuhSeluruhGrup('SIGTERM')
      // Timer ini TIDAK di-unref supaya promise selalu selesai dengan rapi,
      // bukan menggantung saat proses keluar tanpa memancarkan 'exit'.
      setTimeout(() => { bunuhSeluruhGrup('SIGKILL'); tuntas() }, 1500)
    })
  }
}
