#!/usr/bin/env node
'use strict'

// Menyusun catatan GitHub Release. Isinya berbeda tajam antara dua mode, dan
// perbedaan itu penting bagi pengguna:
//
//   instalasi_baru  identitas penandatanganan berganti, sehingga aplikasi lama
//                   HARUS di-uninstall manual lebih dulu dan data lokalnya
//                   dapat ikut terhapus;
//   pembaruan       tanda tangan sama, APK dipasang menimpa, data dipertahankan.
//
// Dipisahkan dari workflow supaya teksnya dapat diuji tanpa menjalankan CI.

const MODE_SAH = ['instalasi_baru', 'pembaruan']

function catatanRilis({ mode, versionName, versionCode, commit, applicationId = 'com.aqilahswimmingclub.app', minSdk = '29', targetSdk = '35' }) {
  if (!MODE_SAH.includes(mode)) {
    throw new Error(`jenis_rilis tidak dikenal: ${mode}`)
  }

  const pembuka = mode === 'instalasi_baru'
    ? [
      '## Pemasangan baru - aplikasi lama harus di-uninstall lebih dulu',
      '',
      'Rilis ini memakai **identitas penandatanganan baru**. Android memakai tanda',
      'tangan sebagai identitas aplikasi, jadi APK ini tidak dapat menimpa aplikasi',
      'AQILAH Swimming Club yang sekarang terpasang.',
      '',
      '**Langkah pemasangan**',
      '',
      '1. Uninstall aplikasi AQILAH Swimming Club yang lama dari HP, secara manual.',
      '2. Pasang APK di bawah ini.',
      '',
      '**Yang perlu diketahui sebelum uninstall**',
      '',
      '- Data lokal aplikasi lama **dapat ikut terhapus** saat uninstall: cache,',
      '  sesi login, dan data yang belum sempat tersinkron ke server.',
      '- Data yang sudah tersinkron ke Supabase tetap aman dan muncul kembali',
      '  setelah login.',
      '- Uninstall dilakukan sendiri oleh pengguna. Rilis ini tidak pernah',
      '  menghapus data atau meng-uninstall apa pun secara otomatis.',
      '',
      '**Setelah ini, tidak perlu uninstall lagi**',
      '',
      'Seluruh pembaruan berikutnya dipasang langsung menimpa aplikasi ini, tanpa',
      'uninstall dan tanpa kehilangan data, selama keystore yang sama terus dipakai.'
    ]
    : [
      '## Pembaruan - pasang langsung, jangan uninstall',
      '',
      'Sertifikat penandatangan terbukti sama dengan aplikasi yang terpasang, dan',
      'versionCode lebih tinggi. Pasang APK ini langsung menimpa aplikasi yang',
      'sudah ada di HP.',
      '',
      '**Jangan uninstall.** Data aplikasi, sesi login, dan cache tetap',
      'dipertahankan.'
    ]

  const rincian = [
    '',
    '### Rincian',
    '',
    `- applicationId: \`${applicationId}\``,
    `- versionName: \`${versionName}\``,
    `- versionCode: \`${versionCode}\``,
    `- minSdk: \`${minSdk}\` (Android 10 ke atas)`,
    `- targetSdk: \`${targetSdk}\``,
    `- Commit: \`${commit}\``,
    '',
    'SHA-256 setiap berkas ada di `SHA256SUMS.txt`.'
  ]

  return pembuka.concat(rincian).join('\n')
}

module.exports = { catatanRilis, MODE_SAH }

if (require.main === module) {
  const a = process.argv.slice(2)
  const arg = {}
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue
    const kunci = a[i].slice(2)
    const berikut = a[i + 1]
    arg[kunci] = berikut && !berikut.startsWith('--') ? (i++, berikut) : 'true'
  }
  try {
    process.stdout.write(catatanRilis({
      mode: arg.mode,
      versionName: arg['version-name'],
      versionCode: arg['version-code'],
      commit: arg.commit
    }))
  } catch (galat) {
    console.error(`[GAGAL] ${galat.message}`)
    process.exit(1)
  }
}
