@echo off
setlocal
cd /d "%~dp0"
title AQILAH Swimming Club - Update Android

echo Membuat build terbaru...
call npm run build || goto :gagal

echo Menyinkronkan ke Android...
call npx cap sync android || goto :gagal

echo Membuka Android Studio...
call npx cap open android || goto :gagal

pause
exit /b 0

:gagal
echo Proses gagal. Periksa pesan error di atas.
pause
exit /b 1
