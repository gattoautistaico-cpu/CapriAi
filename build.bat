@echo off
title Cyber AI - build
cd /d "%~dp0"
echo Compilazione in corso (5-15 minuti). Output in build.log ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows.ps1" > "%~dp0build.log" 2>&1
echo EXITCODE=%ERRORLEVEL%>> "%~dp0build.log"
echo Build terminata (codice %ERRORLEVEL%). Vedi build.log
