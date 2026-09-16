@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul
title Buat Keystore Baru - AQILAH Swimming Club

rem ===========================================================================
rem  Membuat keystore penandatanganan ASC: android\asc-release.p12
rem
rem  PERINGATAN KERAS
rem  Keystore adalah identitas aplikasi SELAMANYA. Keystore ASC sudah dibuat
rem  sekali dan seharusnya Anda simpan cadangannya. Membuat keystore LAIN
rem  berarti identitas aplikasi berganti lagi, dan SELURUH pengguna terpaksa
rem  uninstall serta kehilangan data lokalnya.
rem
rem  Jalankan berkas ini HANYA bila keystore ASC benar-benar belum ada di
rem  komputer ini. Skrip menolak menimpa keystore yang sudah ada.
rem ===========================================================================

cd /d "%~dp0"
set "TUJUAN=android\asc-release.p12"
set "PROPS=android\keystore.properties"

echo.
echo ============================================================
echo  BUAT KEYSTORE BARU - AQILAH SWIMMING CLUB
echo ============================================================
echo.

rem --- 1. Menolak menimpa keystore yang sudah ada ----------------------------
if exist "%TUJUAN%" (
  echo DIBATALKAN: "%TUJUAN%" SUDAH ADA.
  echo.
  echo  Skrip ini tidak akan pernah menimpa keystore yang sudah ada, karena
  echo  menimpanya berarti kehilangan identitas aplikasi secara permanen.
  echo.
  echo  Kalau Anda memang ingin memakai keystore yang sudah ada itu, tidak ada
  echo  yang perlu dikerjakan - langsung jalankan BUAT-APK-UPDATE.bat.
  goto :selesai
)

rem --- 2. keytool harus tersedia ---------------------------------------------
where keytool >nul 2>nul
if errorlevel 1 (
  if defined JAVA_HOME (
    if exist "%JAVA_HOME%\bin\keytool.exe" set "PATH=%JAVA_HOME%\bin;%PATH%"
  )
)
where keytool >nul 2>nul || (
  echo GAGAL: keytool tidak ditemukan.
  echo.
  echo  keytool ikut terpasang bersama Java. Pasang JDK 21, atau pakai yang
  echo  disertakan Android Studio, mis.:
  echo    C:\Program Files\Android\Android Studio\jbr\bin
  echo  lalu set JAVA_HOME ke folder induknya dan jalankan ulang.
  goto :selesai
)

rem --- 3. Kata sandi diminta, tidak ditulis di dalam skrip -------------------
echo  Kata sandi keystore TIDAK disimpan di dalam berkas ini, supaya tidak
echo  ikut masuk ke repository. Ketik kata sandi yang sudah Anda tentukan.
echo.
set "SANDI="
set /p "SANDI=Kata sandi keystore: "
if "!SANDI!"=="" (
  echo GAGAL: kata sandi tidak boleh kosong.
  goto :selesai
)
set "SANDI2="
set /p "SANDI2=Ulangi kata sandi    : "
if not "!SANDI!"=="!SANDI2!" (
  echo GAGAL: kedua kata sandi tidak sama.
  goto :selesai
)

rem --- 4. Buat keystore sesuai spesifikasi ASC -------------------------------
echo.
echo  Membuat kunci RSA 4096 bit... ^(butuh beberapa detik^)
keytool -genkeypair ^
  -alias asc-release ^
  -keyalg RSA ^
  -keysize 4096 ^
  -sigalg SHA256withRSA ^
  -validity 10950 ^
  -storetype PKCS12 ^
  -keystore "%TUJUAN%" ^
  -storepass "!SANDI!" ^
  -keypass "!SANDI!" ^
  -dname "CN=AQILAH Swimming Club, O=AQILAH Swimming Club, C=ID"

if errorlevel 1 (
  echo.
  echo GAGAL: keytool tidak berhasil membuat keystore.
  if exist "%TUJUAN%" del /q "%TUJUAN%"
  goto :selesai
)
if not exist "%TUJUAN%" (
  echo GAGAL: keystore tidak terbentuk.
  goto :selesai
)

rem --- 5. Tulis keystore.properties ------------------------------------------
if exist "%PROPS%" (
  echo.
  echo  CATATAN: %PROPS% sudah ada dan TIDAK diubah.
) else (
  > "%PROPS%" echo storeFile=asc-release.p12
  >> "%PROPS%" echo storeType=PKCS12
  >> "%PROPS%" echo storePassword=!SANDI!
  >> "%PROPS%" echo keyAlias=asc-release
  >> "%PROPS%" echo keyPassword=!SANDI!
  echo.
  echo  %PROPS% dibuat. Berkas itu berisi kata sandi dan sudah
  echo  terdaftar di .gitignore, jadi tidak akan ikut ter-commit.
)

rem --- 6. Sidik jari sertifikat ----------------------------------------------
echo.
echo ------------------------------------------------------------
echo  SIDIK JARI SERTIFIKAT ^(bukan rahasia^)
echo ------------------------------------------------------------
keytool -list -v -keystore "%TUJUAN%" -storetype PKCS12 -storepass "!SANDI!" 2>nul | findstr /C:"SHA256:"

echo.
echo ------------------------------------------------------------
echo  SELESAI
echo ------------------------------------------------------------
echo.
echo  Keystore  : %CD%\%TUJUAN%
echo.
echo  CADANGKAN berkas itu SEKARANG ke minimal dua tempat terpisah
echo  ^(flashdisk dan Google Drive, misalnya^). Kalau hilang, tidak ada
echo  cara membuat APK pembaruan lagi dan semua pengguna harus uninstall.
echo.
echo  JANGAN pernah memasukkannya ke git atau GitHub Release.
echo.
echo  Berikutnya: jalankan BUAT-APK-UPDATE.bat

:selesai
echo.
pause
