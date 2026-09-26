@echo off
TITLE SKM DICOM VIEWER - Node Static Server (no nginx, no serve package)
color 0E

echo.
echo ============================================================
echo   SKM DICOM VIEWER - Node Static Server
echo   URL: http://192.192.8.173:3000
echo.
echo   Zero-dependency fallback - does not use the broken `serve`
echo   package. Use START-OHIF-NGINX.bat for real production use
echo   (gzip + long-lived caching).
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
    echo Run BUILD-OHIF-PROD.bat first.
    pause
    exit /b 1
)

set PORT=3000
node ohif-static-server.js

pause
