@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0CAMPUS.ps1" -Action Stop
if errorlevel 1 (
  pause
  exit /b 1
)
