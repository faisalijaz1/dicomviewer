@echo off
TITLE SKM DICOM VIEWER - Dev Server (webpack)
color 0B

echo.
echo  ============================================================
echo   SKM DICOM VIEWER - Starting Dev Server (webpack)
echo   URL: http://localhost:3000
echo  ============================================================
echo.
echo   NOTE: This uses the webpack dev server (yarn dev), not
echo   rsbuild (yarn dev:fast). Rsbuild fails to load the
echo   JPEG-Lossless decoder inside its image-decoding Web Worker,
echo   which silently breaks every CT/MR image using that
echo   transfer syntax. Do not switch this back to dev:fast.
echo.
echo   This is the LIVE-EDIT dev server, for making code changes.
echo   For normal day-to-day use, use start-ohif-nodeserve.bat
echo   (build) + run-ohif-viewer.bat (serve) instead - it's faster
echo   to start and matches what actually runs in production.
echo  ============================================================
echo.

:: Resolve platform/app relative to this script's own location, so
:: this works no matter where the repo is checked out.
cd /d "%~dp0platform\app" || (
  echo ERROR: Cannot open "%~dp0platform\app"
  echo Check that the folder name is "platform", not "plateform".
  pause
  exit /b 1
)

call npx yarn run dev

pause
