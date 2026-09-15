@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul
title Buat APK Pembaruan AQILAH Swimming Club

rem ===========================================================================
rem  Membuat APK PEMBARUAN yang dapat dipasang menimpa aplikasi ASC di HP,
rem  tanpa uninstall dan tanpa menghapus data pengguna.
rem
rem  Skrip ini TIDAK PERNAH membuat keystore baru. Kunci penandatanganan adalah
rem  identitas aplikasi: begitu kuncinya berganti, Android menolak memasang APK
rem  di atas aplikasi lama. Kalau keystore lama tidak ditemukan, skrip berhenti
rem  dan menjelaskan di mana mencarinya.
rem ===========================================================================

cd /d "%~dp0"
set "GAGAL="
set "HASIL=HASIL-APK-UPDATE"
set "APKLAMA_DIR=APK-LAMA"

echo.
echo ============================================================
echo  BUAT APK PEMBARUAN - AQILAH SWIMMING CLUB
echo ============================================================
echo.

rem --- 1. Alat dasar --------------------------------------------------------
echo [1/10] Memeriksa alat yang diperlukan...
where node >nul 2>nul || (call :salah "Node.js tidak ditemukan. Pasang Node.js LTS dari https://nodejs.org lalu jalankan ulang." & goto :selesai)
where git  >nul 2>nul || (call :salah "Git tidak ditemukan. Pasang Git for Windows dari https://git-scm.com lalu jalankan ulang." & goto :selesai)
if not exist "android\gradlew.bat" (call :salah "Folder android belum lengkap. Jalankan: npx cap add android" & goto :selesai)

if not defined ANDROID_SDK_ROOT if not defined ANDROID_HOME (
  if exist "%LOCALAPPDATA%\Android\Sdk" (
    set "ANDROID_SDK_ROOT=%LOCALAPPDATA%\Android\Sdk"
    set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
  )
)
if not defined ANDROID_SDK_ROOT if not defined ANDROID_HOME (
  call :salah "Android SDK tidak ditemukan. Pasang Android Studio, atau set ANDROID_SDK_ROOT ke folder Android SDK."
  goto :selesai
)
echo        Node, Git, dan Android SDK tersedia.

rem --- 2. Keystore lama WAJIB ada -------------------------------------------
echo.
echo [2/10] Memeriksa keystore penandatanganan...
if not exist "android\keystore.properties" (
  call :salah "android\keystore.properties TIDAK ADA."
  echo.
  echo   Berkas itu berisi lokasi dan kata sandi keystore ASC. Tanpa keystore
  echo   yang SAMA dengan APK yang sekarang terpasang di HP, APK baru akan
  echo   ditolak Android dan pengguna terpaksa uninstall - data hilang.
  echo.
  echo   Cari berkas keystore lama Anda ^(biasanya berakhiran .jks atau .keystore^):
  echo     - folder android\ di dalam proyek ini, mis. android\asc-release.jks
  echo     - cadangan proyek lama, flashdisk, Google Drive, atau email
  echo     - %%USERPROFILE%%\.android\debug.keystore  ^(bila APK lama dipasang
  echo       langsung dari Android Studio memakai build debug^)
  echo.
  echo   Setelah ketemu, salin android\keystore.properties.contoh menjadi
  echo   android\keystore.properties lalu isi storeFile, storePassword,
  echo   keyAlias, dan keyPassword sesuai keystore tersebut.
  echo.
  echo   Skrip ini sengaja TIDAK membuat keystore baru.
  goto :selesai
)

set "STOREFILE="
for /f "usebackq tokens=1,* delims==" %%A in ("android\keystore.properties") do (
  if /i "%%A"=="storeFile" set "STOREFILE=%%B"
)
if not defined STOREFILE (call :salah "storeFile tidak terbaca di android\keystore.properties." & goto :selesai)
set "STOREPATH=android\!STOREFILE!"
if not exist "!STOREPATH!" set "STOREPATH=!STOREFILE!"
if not exist "!STOREPATH!" (
  call :salah "Berkas keystore tidak ditemukan: !STOREFILE!"
  echo   Perbaiki baris storeFile di android\keystore.properties.
  echo   Jalur ditulis relatif terhadap folder android\.
  goto :selesai
)
echo        Keystore ditemukan: !STOREPATH!

rem --- 3. APK lama sebagai pembanding ---------------------------------------
echo.
echo [3/10] Mencari APK lama sebagai pembanding tanda tangan...
set "APKLAMA="
if exist "%APKLAMA_DIR%" (
  for /f "delims=" %%F in ('dir /b /o-d "%APKLAMA_DIR%\*.apk" 2^>nul') do (
    if not defined APKLAMA set "APKLAMA=%APKLAMA_DIR%\%%F"
  )
)
if defined APKLAMA (
  echo        APK lama: !APKLAMA!
) else (
  echo        [PERHATIAN] Tidak ada APK lama di folder %APKLAMA_DIR%\
  echo        Kesamaan tanda tangan tidak dapat dibuktikan tanpa berkas itu.
  echo        Salin APK yang dipakai memasang aplikasi di HP ke folder %APKLAMA_DIR%\
  echo        lalu jalankan ulang skrip ini.
)

rem --- 4. Kode terbaru ------------------------------------------------------
echo.
echo [4/10] Mengambil kode terbaru dari main...
git rev-parse --is-inside-work-tree >nul 2>nul || (call :salah "Folder ini bukan repositori git." & goto :selesai)
for /f "delims=" %%S in ('git status --porcelain') do set "KOTOR=1"
if defined KOTOR (
  call :salah "Masih ada perubahan yang belum disimpan di folder proyek."
  echo   Simpan atau batalkan perubahan itu dulu, supaya APK dibuat dari kode
  echo   yang benar-benar sama dengan yang ada di GitHub. Untuk membatalkan:
  echo       git checkout -- .
  goto :selesai
)
call git fetch origin main || (call :salah "Gagal menghubungi GitHub. Periksa koneksi internet." & goto :selesai)
call git checkout main    || (call :salah "Gagal berpindah ke branch main." & goto :selesai)
call git pull --ff-only origin main || (call :salah "Gagal memperbarui main." & goto :selesai)
for /f "delims=" %%C in ('git rev-parse --short HEAD') do set "COMMIT=%%C"
echo        Kode terbaru: !COMMIT!

rem --- 5. Dependensi --------------------------------------------------------
echo.
echo [5/10] Memasang dependensi...
if exist "package-lock.json" (call npm ci) else (call npm install)
if errorlevel 1 (call :salah "Pemasangan dependensi gagal." & goto :selesai)

rem --- 6. Pengujian ---------------------------------------------------------
echo.
echo [6/10] Menjalankan seluruh pengujian...
call npm test
if errorlevel 1 (
  call :salah "Ada pengujian yang gagal. APK tidak dibuat."
  echo   Perbaiki dulu penyebabnya, jangan membuat APK dari kode yang belum lulus uji.
  goto :selesai
)
echo        Seluruh pengujian lulus.

rem --- 7. Naikkan versi dan bangun web --------------------------------------
echo.
echo [7/10] Menaikkan versionCode dan membangun aplikasi web...
call node scripts\bump-android-version.cjs || (call :salah "Gagal menaikkan versionCode." & goto :selesai)
call npm run build || (call :salah "Build web gagal." & goto :selesai)
call npx cap sync android || (call :salah "npx cap sync android gagal." & goto :selesai)
echo        Aset web tersinkron ke proyek Android.

rem --- 8. Build APK release -------------------------------------------------
echo.
echo [8/10] Membangun APK release bertanda tangan ^(bisa beberapa menit^)...
pushd android
call gradlew.bat --no-daemon assembleRelease
set "KODEGRADLE=%errorlevel%"
popd
if not "!KODEGRADLE!"=="0" (call :salah "Build Android gagal. Baca pesan Gradle di atas." & goto :selesai)

set "APKBARU=android\app\build\outputs\apk\release\app-release.apk"
if not exist "!APKBARU!" (call :salah "APK release tidak ditemukan setelah build." & goto :selesai)
echo        APK selesai dibangun.

rem --- 9. Verifikasi --------------------------------------------------------
echo.
echo [9/10] Memverifikasi APK...
if defined APKLAMA (
  call node scripts\verifikasi-apk.cjs --apk "!APKBARU!" --apk-lama "!APKLAMA!"
) else (
  call node scripts\verifikasi-apk.cjs --apk "!APKBARU!"
)
set "KODEVERIF=%errorlevel%"
if "!KODEVERIF!"=="1" (
  call :salah "APK TIDAK memenuhi syarat sebagai pembaruan. Jangan dibagikan."
  goto :selesai
)

rem --- 10. Simpan hasil -----------------------------------------------------
echo.
echo [10/10] Menyimpan hasil...
if not exist "%HASIL%" mkdir "%HASIL%"
set "VC="
set "VN="
for /f "usebackq tokens=1,* delims==" %%A in ("android\gradle.properties") do (
  if /i "%%A"=="ascVersionCode" set "VC=%%B"
  if /i "%%A"=="ascVersionName" set "VN=%%B"
)
set "NAMAAPK=ASC-!VN!-!VC!-release-!COMMIT!.apk"
copy /y "!APKBARU!" "%HASIL%\!NAMAAPK!" >nul
call node -e "const{createHash}=require('crypto'),{readFileSync,writeFileSync}=require('fs');const f=process.argv[1];const h=createHash('sha256').update(readFileSync(f)).digest('hex');writeFileSync(f+'.sha256',h+'  '+require('path').basename(f)+'\n');console.log(h)" "%HASIL%\!NAMAAPK!" > "%TEMP%\asc-sha.txt"
set /p SHA=<"%TEMP%\asc-sha.txt"
del /q "%TEMP%\asc-sha.txt" >nul 2>nul

echo.
echo ============================================================
if "!KODEVERIF!"=="0" (
  echo  BERHASIL - APK PEMBARUAN SIAP DIPASANG
  echo ============================================================
  echo.
  echo  Berkas : %HASIL%\!NAMAAPK!
  echo  Versi  : !VN! ^(versionCode !VC!^)
  echo  SHA-256: !SHA!
  echo.
  echo  Cara memasang:
  echo    1. Salin berkas APK di atas ke HP.
  echo    2. Buka berkas itu di HP lalu pilih Pasang/Install.
  echo    3. JANGAN uninstall aplikasi lama. APK ini menimpa langsung.
  echo.
  echo  Data aplikasi, sesi login, dan cache tetap dipertahankan.
) else (
  echo  APK SELESAI, TETAPI BELUM TERBUKTI SEBAGAI PEMBARUAN
  echo ============================================================
  echo.
  echo  Berkas : %HASIL%\!NAMAAPK!
  echo  Versi  : !VN! ^(versionCode !VC!^)
  echo  SHA-256: !SHA!
  echo.
  echo  Kesamaan tanda tangan dengan APK lama BELUM dibuktikan karena
  echo  APK lama tidak tersedia. Salin APK lama ke folder %APKLAMA_DIR%\
  echo  lalu jalankan ulang skrip ini sebelum membagikan APK ini.
)
echo ============================================================
goto :selesai

:salah
echo.
echo ------------------------------------------------------------
echo  [GAGAL] %~1
echo ------------------------------------------------------------
set "GAGAL=1"
exit /b 0

:selesai
echo.
if defined GAGAL (
  echo APK TIDAK dibuat. Perbaiki penyebab di atas lalu jalankan ulang.
)
echo Tekan tombol apa saja untuk menutup jendela ini.
pause >nul
endlocal
