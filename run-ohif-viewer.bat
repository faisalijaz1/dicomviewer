@echo off
TITLE SKM DICOM VIEWER - Node Static Server (no nginx, no serve package)
color 0E

echo.
echo ============================================================
echo   SKM DICOM VIEWER - Node Static Server
echo   URL: http://localhost:3000
echo.
echo   Zero-dependency static server (no nginx, no serve package).
echo   For production with gzip + long-lived caching instead, use
echo   RUN-OHIF-NGINX.bat.
echo ============================================================
echo.

:: Resolve the repo root relative to this script's own location, so
:: this works no matter where the repo is checked out.
cd /d "%~dp0" || (
  echo ERROR: Cannot open "%~dp0"
  pause
  exit /b 1
)

if not exist platform\app\dist\index.html (
    echo ERROR: No production build found at platform\app\dist\index.html
    echo Run start-ohif-nodeserve.bat first to build it.
    pause
    exit /b 1
)

set PORT=3000
node ohif-static-server.js

pause
