@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title AQILAH Swimming Club - Buat APK Update

echo ================================================
echo  MEMBUAT APK UPDATE (BUKAN INSTAL ULANG)
echo ================================================
echo.

rem ================= 1. Cari Android SDK =================
if exist "android\local.properties" goto :adasdk

echo [1/6] Mencari lokasi Android SDK...
set "SDKDIR="
if defined ANDROID_HOME if exist "%ANDROID_HOME%" set "SDKDIR=%ANDROID_HOME%"
if not defined SDKDIR if defined ANDROID_SDK_ROOT if exist "%ANDROID_SDK_ROOT%" set "SDKDIR=%ANDROID_SDK_ROOT%"
if not defined SDKDIR if exist "%LOCALAPPDATA%\Android\Sdk" set "SDKDIR=%LOCALAPPDATA%\Android\Sdk"
if not defined SDKDIR if exist "%USERPROFILE%\AppData\Local\Android\Sdk" set "SDKDIR=%USERPROFILE%\AppData\Local\Android\Sdk"
if not defined SDKDIR if exist "C:\Android\Sdk" set "SDKDIR=C:\Android\Sdk"

if not defined SDKDIR (
  echo [GAGAL] Android SDK tidak ditemukan.
  echo Buka Android Studio, menu Settings, bagian Android SDK,
  echo lihat "Android SDK Location", lalu buat file android\local.properties berisi:
  echo    sdk.dir=C:/Users/NAMA/AppData/Local/Android/Sdk
  goto :gagal
)

set "SDKESC=!SDKDIR:\=/!"
> "android\local.properties" echo sdk.dir=!SDKESC!
echo       SDK ditemukan: !SDKDIR!
echo.
goto :lanjutkeystore

:adasdk
echo [1/6] android\local.properties sudah ada, dipakai.
echo.

rem ================= 2. Keystore tetap =================
:lanjutkeystore
if exist "android\keystore.properties" goto :adakeystore

echo [2/6] Keystore rilis belum ada. Membuat SATU KALI saja...
echo.
echo PENTING: file android\asc-release.jks yang dibuat sekarang adalah
echo identitas aplikasi Anda selamanya. Simpan cadangannya di tempat aman.
echo Kalau file ini hilang, semua update berikutnya akan minta uninstall.
echo.

rem keytool jarang ada di PATH. Cari di lokasi umum JDK dan Android Studio.
set "KEYTOOL="
where keytool >nul 2>nul && set "KEYTOOL=keytool"
if not defined KEYTOOL if exist "%JAVA_HOME%\bin\keytool.exe" set "KEYTOOL=%JAVA_HOME%\bin\keytool.exe"
if not defined KEYTOOL if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\keytool.exe" set "KEYTOOL=%ProgramFiles%\Android\Android Studio\jbr\bin\keytool.exe"
if not defined KEYTOOL if exist "%ProgramFiles%\Android\Android Studio\jre\bin\keytool.exe" set "KEYTOOL=%ProgramFiles%\Android\Android Studio\jre\bin\keytool.exe"
if not defined KEYTOOL if exist "%LOCALAPPDATA%\Programs\Android Studio\jbr\bin\keytool.exe" set "KEYTOOL=%LOCALAPPDATA%\Programs\Android Studio\jbr\bin\keytool.exe"
if not defined KEYTOOL if exist "%LOCALAPPDATA%\Programs\Android Studio\jre\bin\keytool.exe" set "KEYTOOL=%LOCALAPPDATA%\Programs\Android Studio\jre\bin\keytool.exe"

if not defined KEYTOOL (
  echo [GAGAL] keytool tidak ditemukan.
  echo keytool ikut terpasang bersama Android Studio, biasanya di:
  echo    C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe
  echo Pastikan Android Studio terpasang, lalu jalankan file ini lagi.
  goto :gagal
)
echo       keytool: !KEYTOOL!
echo.

set "KSPASS="
set /p KSPASS=Buat kata sandi keystore (minimal 6 karakter): 
if "!KSPASS!"=="" (
  echo [GAGAL] Kata sandi tidak boleh kosong.
  goto :gagal
)

"!KEYTOOL!" -genkeypair -v -keystore "android\asc-release.jks" -alias asc ^
  -keyalg RSA -keysize 2048 -validity 10000 ^
  -storepass "!KSPASS!" -keypass "!KSPASS!" ^
  -dname "CN=AQILAH Swimming Club, OU=ASC, O=AQILAH Swimming Club, L=Indonesia, ST=Indonesia, C=ID"
if errorlevel 1 goto :gagal

>  "android\keystore.properties" echo storeFile=asc-release.jks
>> "android\keystore.properties" echo storePassword=!KSPASS!
>> "android\keystore.properties" echo keyAlias=asc
>> "android\keystore.properties" echo keyPassword=!KSPASS!
set "KSPASS="

echo.
echo       Keystore dibuat: android\asc-release.jks
echo       SEGERA salin file itu ke flashdisk atau Google Drive.
echo.
goto :lanjutversi

:adakeystore
echo [2/6] Keystore rilis sudah ada, dipakai ulang. Bagus.
echo.

rem ================= 3. Naikkan versi =================
:lanjutversi
echo [3/6] Menaikkan versionCode...
call node scripts\bump-android-version.cjs
if errorlevel 1 goto :gagal
echo.

rem ================= 4. Build web =================
echo [4/6] Membuat build web terbaru...
call npm run build
if errorlevel 1 goto :gagal
echo.

rem ================= 5. Sinkron ke Android =================
echo [5/6] Menyinkronkan ke proyek Android...
call npx cap sync android
if errorlevel 1 goto :gagal
echo.

rem ================= 6. Rakit APK =================
echo [6/6] Merakit APK rilis bertanda tangan...
pushd android
call gradlew.bat assembleRelease
set "HASIL=%errorlevel%"
popd
if not "%HASIL%"=="0" goto :gagal

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
