@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.17 or later from nodejs.org, then open this file again.
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22 || (major===22 && minor>=17) ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 22.17 or later is required.
  pause
  exit /b 1
)
if not exist node_modules\qrcode (
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0CAMPUS.ps1" -Action Start -OpenBrowser
if errorlevel 1 (
  pause
  exit /b 1
)
