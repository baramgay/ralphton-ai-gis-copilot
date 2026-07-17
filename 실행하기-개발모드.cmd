@echo off
setlocal
set "launcher=%~dpn0"
set "launcher=%launcher:~0,-5%.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%launcher%" -Dev %*
exit /b %errorlevel%
