@echo off
TITLE SKM DICOM VIEWER - Build Production
color 0B

echo.
echo ============================================================
echo   SKM DICOM VIEWER - Building Production Bundle
echo   Output: D:\SKMPACS\ohif-viewer\platform\app\dist
echo ============================================================
echo.
echo   NOTE: This uses the webpack build (yarn run build:viewer),
echo   not rsbuild (yarn build:fast). Rsbuild fails to load the
echo   JPEG-Lossless decoder inside its image-decoding Web Worker,
echo   which silently breaks every CT/MR image using that
echo   transfer syntax. Do not switch this back to build:fast.
echo   This build takes longer than rsbuild - please be patient.
echo ============================================================
echo.

:: Resolve platform/app relative to this script's own location, so
:: this works no matter where the repo is checked out.
cd /d "%~dp0platform\app" || (
  echo ERROR: Cannot open "%~dp0platform\app"
  echo Check that the folder name is "platform", not "plateform".
  pause
  exit /b 1
)

echo [1/3] Cleaning previous build output...
if exist dist (
    rmdir /s /q dist
    echo       Cleaned platform\app\dist
) else (
    echo       Nothing to clean
)
echo.

echo [2/3] Running production build with webpack...
echo       (This takes several minutes - please wait)
echo.
call npx yarn run build:viewer
if errorlevel 1 (
    echo.
    echo ERROR: Build failed - see output above.
    pause
    exit /b 1
)

echo.
echo [3/3] Verifying output...
if exist dist\index.html (
    echo       index.html         OK
) else (
    echo       index.html         MISSING - build did not complete correctly
)
if exist dist\app-config.js (
    echo       app-config.js      OK
) else (
    echo       app-config.js      MISSING - check that public\app-config.js is being copied
)

echo.
echo ============================================================
echo   Build COMPLETE!
echo   Dist folder: D:\SKMPACS\ohif-viewer\platform\app\dist
echo   Next: run run-ohif-viewer.bat to serve it on port 3000
echo   (or RUN-OHIF-NGINX.bat / RELOAD-OHIF-NGINX.bat for the
echo   nginx-based production option instead)
echo ============================================================
echo.
pause
