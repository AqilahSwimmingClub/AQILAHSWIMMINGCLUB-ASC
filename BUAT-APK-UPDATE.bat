@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title AQILAH Swimming Club - Buat APK Update

echo ================================================
echo  MEMBUAT APK UPDATE (BUKAN INSTAL ULANG)
echo ================================================
echo.

rem %ProgramFiles(x86)% memuat tanda kurung yang mengacaukan parser batch
rem di dalam blok, jadi nilainya disalin lebih dulu di sini.
set "PF86=%ProgramFiles(x86)%"

rem ================= 1. Cari Android SDK =================
if exist "android\local.properties" goto :adasdk

echo [1/7] Mencari lokasi Android SDK...
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
echo [1/7] android\local.properties sudah ada, dipakai.
echo.

rem ================= 2. Keystore tetap =================
:lanjutkeystore
if exist "android\keystore.properties" goto :adakeystore

echo [2/7] Keystore rilis belum ada. Membuat SATU KALI saja...
echo.
echo PENTING: file android\asc-release.jks yang dibuat sekarang adalah
echo identitas aplikasi Anda selamanya. Simpan cadangannya di tempat aman.
echo Kalau file ini hilang, semua update berikutnya akan minta uninstall.
echo.

rem keytool hampir tidak pernah ada di PATH. Dicari bertahap: lokasi baku,
rem lalu penelusuran menyeluruh, lalu terakhir ditanyakan ke pengguna.
echo       Mencari keytool...
set "KEYTOOL="
where keytool >nul 2>nul && set "KEYTOOL=keytool"
if not defined KEYTOOL if exist "%JAVA_HOME%\bin\keytool.exe" set "KEYTOOL=%JAVA_HOME%\bin\keytool.exe"

rem Lokasi baku Android Studio pada berbagai cara pemasangan.
for %%R in ("%ProgramFiles%" "!PF86!" "%LOCALAPPDATA%\Programs" "%LOCALAPPDATA%") do (
  for %%S in ("Android\Android Studio" "Android Studio") do (
    for %%V in (jbr jre) do (
      if not defined KEYTOOL if exist "%%~R\%%~S\%%V\bin\keytool.exe" set "KEYTOOL=%%~R\%%~S\%%V\bin\keytool.exe"
    )
  )
)

rem JDK mandiri yang lazim dipakai di Windows.
for %%R in ("%ProgramFiles%\Java" "%ProgramFiles%\Eclipse Adoptium" "%ProgramFiles%\Microsoft" "%ProgramFiles%\Amazon Corretto" "%ProgramFiles%\Zulu") do (
  if exist "%%~R" for /d %%J in ("%%~R\*") do (
    if not defined KEYTOOL if exist "%%~fJ\bin\keytool.exe" set "KEYTOOL=%%~fJ\bin\keytool.exe"
  )
)

if defined KEYTOOL goto :keytoolsiap

rem Jaring terakhir: telusuri menyeluruh. Hasilnya lewat berkas sementara supaya
rem tidak perlu escaping pengalihan di dalam blok kurung.
echo       Belum ketemu di lokasi baku, menelusuri lebih luas...
set "KTLIST=%TEMP%\asc-cari-keytool.txt"
if exist "!KTLIST!" del /q "!KTLIST!"
where /r "%ProgramFiles%" keytool.exe > "!KTLIST!" 2>nul
for /f "usebackq delims=" %%J in ("!KTLIST!") do if not defined KEYTOOL set "KEYTOOL=%%J"
if defined KEYTOOL goto :keytoolbersih

where /r "%LOCALAPPDATA%" keytool.exe > "!KTLIST!" 2>nul
for /f "usebackq delims=" %%J in ("!KTLIST!") do if not defined KEYTOOL set "KEYTOOL=%%J"
if defined KEYTOOL goto :keytoolbersih

rem Terakhir: minta pengguna menunjukkan sendiri, jangan mati di sini.
echo.
echo keytool tidak ditemukan otomatis.
echo.
echo keytool ikut terpasang bersama Android Studio. Cara menemukannya:
echo   1. Buka File Explorer
echo   2. Masuk ke folder Android Studio, biasanya
echo      C:\Program Files\Android\Android Studio
echo   3. Buka folder jbr, lalu folder bin
echo   4. Cari berkas keytool.exe
echo   5. Klik kanan keytool.exe, pilih Copy as path
echo   6. Tempel di bawah ini dengan Ctrl+V lalu tekan Enter
echo.
echo Kalau Android Studio memang belum terpasang, tutup jendela ini,
echo pasang Android Studio lebih dulu, lalu jalankan berkas ini lagi.
echo.
set "KEYTOOL="
set /p KEYTOOL=Lokasi keytool.exe: 

:keytoolbersih
if exist "%TEMP%\asc-cari-keytool.txt" del /q "%TEMP%\asc-cari-keytool.txt"
rem Buang tanda kutip bila pengguna menempel hasil Copy as path.
if defined KEYTOOL set KEYTOOL=!KEYTOOL:"=!

:keytoolsiap
if not defined KEYTOOL (
  echo [GAGAL] Lokasi keytool tidak diisi.
  goto :gagal
)
if /i "!KEYTOOL!"=="keytool" goto :keytoolok
if not exist "!KEYTOOL!" (
  echo [GAGAL] Berkas tidak ditemukan: !KEYTOOL!
  echo Pastikan lokasinya benar dan berakhiran keytool.exe
  goto :gagal
)

:keytoolok
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
echo [2/7] Keystore rilis sudah ada, dipakai ulang. Bagus.
echo.

rem ================= 3. Naikkan versi =================
:lanjutversi
echo [3/7] Menaikkan versionCode...
call node scripts\bump-android-version.cjs
if errorlevel 1 goto :gagal
echo.

rem ================= 4. Build web =================
rem Pada salinan repositori yang baru, folder node_modules belum ada sehingga
rem npm run build langsung gagal. Dependensi dipasang lebih dulu bila perlu.
if exist "node_modules" goto :adamodul
echo [4/7] Memasang dependensi proyek (sekali saja, agak lama)...
call npm install --no-audit --no-fund
if errorlevel 1 goto :gagal
echo.
:adamodul

echo [5/7] Membuat build web terbaru...
call npm run build
if errorlevel 1 goto :gagal
echo.

rem ================= 5. Sinkron ke Android =================
echo [6/7] Menyinkronkan ke proyek Android...
call npx cap sync android
if errorlevel 1 goto :gagal
echo.

rem ================= 6. Rakit APK =================
rem Gradle 8.9 hanya mendukung Java 17 sampai 22. Bila java di PATH lebih baru
rem (Java 25 memberi pesan "Unsupported class file major version 69"), Gradle
rem gagal sebelum membaca satu pun berkas build. JDK yang cocok dipilih di sini
rem lalu diteruskan ke gradlew lewat JAVA_HOME.
echo [7/7] Menyiapkan Java untuk Gradle...
set "GRADLEJDK="
for %%V in (jdk-17 jdk17 jdk-21 jdk21) do (
  for %%R in ("%ProgramFiles%\Java" "!PF86!\Java" "%LOCALAPPDATA%\Programs\Java" "%ProgramFiles%\Eclipse Adoptium" "%ProgramFiles%\Microsoft" "%ProgramFiles%\Amazon Corretto" "%ProgramFiles%\Zulu") do (
    if exist "%%~R" for /d %%J in ("%%~R\%%V*") do (
      if not defined GRADLEJDK if exist "%%~fJ\bin\java.exe" set "GRADLEJDK=%%~fJ"
    )
  )
)
rem JBR bawaan Android Studio juga cocok dan hampir selalu tersedia.
for %%R in ("%ProgramFiles%" "!PF86!" "%LOCALAPPDATA%\Programs" "%LOCALAPPDATA%") do (
  for %%S in ("Android\Android Studio" "Android Studio") do (
    if not defined GRADLEJDK if exist "%%~R\%%~S\jbr\bin\java.exe" set "GRADLEJDK=%%~R\%%~S\jbr"
  )
)

if defined GRADLEJDK (
  set "JAVA_HOME=!GRADLEJDK!"
  echo       Java untuk Gradle: !GRADLEJDK!
) else (
  echo       [PERINGATAN] JDK 17 atau 21 tidak ditemukan.
  echo       Gradle akan memakai java bawaan PATH dan mungkin gagal.
  echo       Bila gagal dengan pesan Unsupported class file major version,
  echo       pasang JDK 17 lalu jalankan berkas ini lagi.
)
echo.

echo       Merakit APK rilis bertanda tangan...
pushd android
call gradlew.bat assembleRelease
set "HASIL=!errorlevel!"
popd
if not "!HASIL!"=="0" goto :gagal

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
