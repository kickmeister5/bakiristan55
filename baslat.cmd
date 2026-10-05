@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 veya uzeri gerekli. Node.js LTS kurup yeniden deneyin.
  pause
  exit /b 1
)
echo Garaj Arena aciliyor: http://localhost:4173
echo Bu pencereyi oyun boyunca acik tutun.
node server.mjs
pause
