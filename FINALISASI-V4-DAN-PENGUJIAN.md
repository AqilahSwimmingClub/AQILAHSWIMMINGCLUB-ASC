# Finalisasi AQILAH Swimming Club v4

Versi ini tidak menambah ruang lingkup fitur baru. Perubahan difokuskan pada stabilitas data dan kesiapan rilis.

## Perubahan yang diterapkan

- Penyimpanan lokal dilakukan sebelum sinkronisasi Supabase.
- Data dari perangkat dan server digabungkan berdasarkan identitas record sebelum ditulis.
- Koleksi penting diverifikasi kembali sesudah penyimpanan Supabase.
- Snapshot pengaman lokal dibuat sebelum proses sinkronisasi.
- Jurnal pemulihan mencatat keberhasilan dan kegagalan sinkronisasi.
- Penghapusan data penting memakai tombstone agar data yang sudah dihapus tidak muncul kembali dari perangkat lain.
- Audit trail lokal mencatat tindakan penghapusan dan pemulihan.
- Riwayat versi ringkas menyimpan waktu, revisi, alasan, dan jumlah data setiap penghapusan penting.
- Pengaturan Admin memiliki monitoring, sinkronisasi manual, download backup JSON, download audit, dan pemulihan snapshot terakhir.
- Jalur upload memakai nama unik dan verifikasi URL hasil upload.

## Pengujian yang berhasil dijalankan di lingkungan ini

- Pemeriksaan sintaks JavaScript dengan `node --check src/main.js`.
- Pemeriksaan statis dengan `node scripts/verify-final.cjs`.

## Pengujian yang belum dapat dijalankan di lingkungan ini

`npm install` gagal karena paket `yauzl@2.10.0` tidak tersedia pada registry internal lingkungan pengujian. Karena Vite tidak terpasang, `npm run build` belum dapat dijalankan di sini. Ini bukan bukti bahwa build di komputer pengguna gagal; build tetap wajib diuji setelah menjalankan `npm install` pada komputer dengan akses registry npm normal.

## Urutan rilis

1. Ekstrak ZIP final.
2. Buka CMD pada folder yang berisi `package.json`.
3. Jalankan `npm install`.
4. Jalankan `npm run build`.
5. Jalankan aplikasi dan uji login Admin, Pelatih, dan Orang Tua.
6. Uji tambah data, refresh, logout/login, dan buka dari perangkat lain.
7. Setelah semua uji lulus, baru unggah ke GitHub, deploy ke Vercel, dan sinkronkan Android.
