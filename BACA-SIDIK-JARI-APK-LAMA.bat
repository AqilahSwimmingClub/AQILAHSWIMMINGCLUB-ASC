@echo off
setlocal
chcp 65001 >nul 2>nul
title Baca Sidik Jari APK Lama - AQILAH Swimming Club

rem ===========================================================================
rem  Membaca identitas dan sidik jari sertifikat APK LAMA, yaitu APK yang
rem  dipakai memasang aplikasi ASC yang sekarang ada di HP.
rem
rem  Nilai-nilai itu menentukan apakah APK baru bisa dipasang menimpa aplikasi
rem  lama tanpa uninstall. Skrip ini hanya MEMBACA, tidak mengubah apa pun.
rem ===========================================================================

cd /d "%~dp0"

echo.
echo ============================================================
echo  BACA SIDIK JARI APK LAMA
echo ============================================================
echo.

where node >nul 2>nul || (
  echo GAGAL: Node.js tidak ditemukan.
  echo Pasang Node.js LTS dari https://nodejs.org lalu jalankan ulang.
  goto :selesai
)

if not defined ANDROID_SDK_ROOT if not defined ANDROID_HOME (
  if exist "%LOCALAPPDATA%\Android\Sdk" (
    set "ANDROID_SDK_ROOT=%LOCALAPPDATA%\Android\Sdk"
    set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
  )
)

if not exist "APK-LAMA" mkdir "APK-LAMA" >nul 2>nul

node scripts\baca-apk-lama.cjs %*
if errorlevel 1 (
  echo.
  echo ------------------------------------------------------------
  echo  BELUM BERHASIL
  echo ------------------------------------------------------------
  echo.
  echo  Salin APK yang dipakai memasang aplikasi di HP ke folder:
  echo     %CD%\APK-LAMA
  echo  lalu jalankan ulang berkas ini.
  goto :selesai
)

echo ------------------------------------------------------------
echo  SELESAI
echo ------------------------------------------------------------

:selesai
echo.
pause
