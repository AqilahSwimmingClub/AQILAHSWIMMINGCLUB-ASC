# TAHAP 1 — PENYIMPANAN ANTI-HILANG

Perbaikan tahap pertama memusatkan perhatian pada data yang tidak boleh hilang:

- data atlet dan pendaftar baru;
- catatan waktu;
- pembayaran SPP dan pembayaran lomba;
- gaji pelatih;
- kompetisi, pendaftaran lomba, pengumuman, jadwal, program, dan absensi.

## Perubahan utama

1. Sebelum menyimpan, aplikasi selalu membaca payload Supabase terbaru.
2. Koleksi data digabung berdasarkan ID. Data unik dari perangkat lain dipertahankan.
3. Hasil gabungan baru ditulis kembali ke Supabase.
4. Tiga snapshot pengaman terakhir disimpan di perangkat.
5. File upload tetap menggunakan nama UUID unik dan `upsert:false` sehingga file dengan nama sama tidak menimpa file lama.

## Catatan tahap ini

Mode tahap 1 mengutamakan keselamatan data. Penghapusan permanen lintas perangkat akan disempurnakan pada tahap berikutnya menggunakan penanda penghapusan (tombstone), agar tombol hapus tidak menyebabkan data lain ikut hilang.

## Pengujian wajib

1. Tambah satu catatan waktu di HP.
2. Tambah satu pembayaran dari portal orang tua.
3. Refresh HP dan website.
4. Pastikan kedua data tetap ada pada keduanya.
5. Tambah atlet dari website, lalu buka ulang APK.
6. Pastikan atlet lama dan atlet baru tetap ada.
