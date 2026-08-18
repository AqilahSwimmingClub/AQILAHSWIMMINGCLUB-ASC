@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title AQILAH Swimming Club - Buat APK Update

echo ================================================
echo  MEMBUAT APK UPDATE (BUKAN INSTAL ULANG)
echo ================================================
echo.

rem ---------- 1. Pastikan keystore tetap tersedia ----------
if exist "android\keystore.properties" goto :adakeystore

echo [1/5] Keystore rilis belum ada. Membuat SATU KALI saja...
echo.
echo PENTING: file android\asc-release.jks yang dibuat sekarang adalah
echo identitas aplikasi Anda selamanya. Simpan cadangannya di tempat aman.
echo Kalau file ini hilang, semua update berikutnya akan minta uninstall.
echo.

where keytool >nul 2>nul
if errorlevel 1 (
  echo [GAGAL] keytool tidak ditemukan di PATH.
  echo keytool ikut terpasang bersama JDK / Android Studio.
  echo Tambahkan folder bin JDK ke PATH, lalu jalankan file ini lagi.
  goto :gagal
)

set /p KSPASS=Buat kata sandi keystore (minimal 6 karakter): 
if "!KSPASS!"=="" (
  echo [GAGAL] Kata sandi tidak boleh kosong.
  goto :gagal
)

keytool -genkeypair -v -keystore "android\asc-release.jks" -alias asc ^
  -keyalg RSA -keysize 2048 -validity 10000 ^
  -storepass "!KSPASS!" -keypass "!KSPASS!" ^
  -dname "CN=AQILAH Swimming Club, OU=ASC, O=AQILAH Swimming Club, L=-, ST=-, C=ID"
if errorlevel 1 goto :gagal

>  "android\keystore.properties" echo storeFile=asc-release.jks
>> "android\keystore.properties" echo storePassword=!KSPASS!
>> "android\keystore.properties" echo keyAlias=asc
>> "android\keystore.properties" echo keyPassword=!KSPASS!

echo.
echo Keystore dibuat: android\asc-release.jks
echo.
goto :lanjut

:adakeystore
echo [1/5] Keystore rilis sudah ada, dipakai ulang. Bagus.
echo.

:lanjut
rem ---------- 2. Naikkan versionCode otomatis ----------
echo [2/5] Menaikkan versionCode...
call node scripts\bump-android-version.cjs
if errorlevel 1 goto :gagal
echo.

rem ---------- 3. Build web ----------
echo [3/5] Membuat build web terbaru...
call npm run build
if errorlevel 1 goto :gagal
echo.

rem ---------- 4. Sinkron ke Android ----------
echo [4/5] Menyinkronkan ke proyek Android...
call npx cap sync android
if errorlevel 1 goto :gagal
echo.

rem ---------- 5. Rakit APK rilis ----------
echo [5/5] Merakit APK rilis bertanda tangan...
cd android
call gradlew.bat assembleRelease
if errorlevel 1 (
  cd ..
  goto :gagal
)
cd ..

echo.
echo ================================================
echo  SELESAI
echo ================================================
echo APK ada di:
echo   android\app\build\outputs\apk\release\app-release.apk
echo.
echo Pasang langsung di HP menimpa aplikasi lama.
echo TIDAK perlu uninstall.
echo ================================================
pause
exit /b 0

:gagal
echo.
echo ================================================
echo  PROSES BERHENTI KARENA ERROR
echo  Periksa pesan di atas.
echo ================================================
pause
exit /b 1
