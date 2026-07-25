@echo off
setlocal
cd /d "%~dp0"
title AQILAH Swimming Club - Persiapan Android Otomatis

echo ================================================
echo AQILAH SWIMMING CLUB - SETUP ANDROID OTOMATIS
echo ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [GAGAL] Node.js belum terpasang atau tidak terbaca di PATH.
  echo Instal Node.js LTS, lalu jalankan file ini kembali.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [GAGAL] npm tidak ditemukan.
  pause
  exit /b 1
)

echo [1/6] Memasang dependency proyek...
call npm install --no-audit --no-fund
if errorlevel 1 goto :gagal

echo.
echo [2/6] Membuat build produksi...
call npm run build
if errorlevel 1 goto :gagal

echo.
if exist android\app\build.gradle (
  echo [3/6] Platform Android sudah tersedia, tahap penambahan dilewati.
) else (
  echo [3/6] Menambahkan platform Android...
  call npx cap add android
  if errorlevel 1 goto :gagal
)

echo.
echo [4/6] Mengatur kompatibilitas Android minimum...
call node scripts\set-android-min-sdk.cjs
if errorlevel 1 goto :gagal

echo.
echo [5/6] Menyinkronkan web ke proyek Android...
call npx cap sync android
if errorlevel 1 goto :gagal

echo.
echo [6/6] Membuka proyek di Android Studio...
call npx cap open android
if errorlevel 1 goto :gagal

echo.
echo ================================================
echo SELESAI. PROYEK ANDROID SUDAH DISIAPKAN.
echo ================================================
pause
exit /b 0

:gagal
echo.
echo ================================================
echo PROSES BERHENTI KARENA TERJADI ERROR.
echo Pastikan internet aktif dan Android Studio terpasang.
echo ================================================
pause
exit /b 1
