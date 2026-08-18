@echo off
setlocal
set "DIR=%~dp0"
rem Berkas ini sebelumnya memanggil java dari PATH begitu saja, sehingga JAVA_HOME
rem diabaikan dan Gradle bisa berjalan di atas Java yang belum didukungnya.
set "JAVACMD=java"
if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" set "JAVACMD=%JAVA_HOME%\bin\java.exe"
"%JAVACMD%" -cp "%DIR%gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
