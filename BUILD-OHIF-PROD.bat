@echo off
TITLE SKM DICOM VIEWER - Build Production
color 0B

echo.
echo ============================================================
echo   SKM DICOM VIEWER - Building Production Bundle
echo   Output: E:\skmch-dicom-viewer\platform\app\dist
echo ============================================================
echo.

cd /d E:\skmch-dicom-viewer || (
  echo ERROR: Cannot open E:\skmch-dicom-viewer
  pause
  exit /b 1
)

echo [1/3] Cleaning previous build output...
if exist platform\app\dist (
    rmdir /s /q platform\app\dist
    echo       Cleaned platform\app\dist
) else (
    echo       Nothing to clean
)
echo.

echo [2/3] Running production build with rsbuild...
echo       (This takes 3-8 minutes the first time - please wait)
echo.
call yarn build:fast
if errorlevel 1 (
    echo.
    echo ERROR: Build failed - see output above.
    pause
    exit /b 1
)

echo.
echo [3/3] Verifying output...
if exist platform\app\dist\index.html (
    echo       index.html         OK
) else (
    echo       index.html         MISSING - build did not complete correctly
)
if exist platform\app\dist\app-config.js (
    echo       app-config.js      OK
) else (
    echo       app-config.js      MISSING - check rsbuild.config.ts copy step
)

echo.
echo ============================================================
echo   Build COMPLETE!
echo   Dist folder: E:\skmch-dicom-viewer\platform\app\dist
echo   Next: run START-OHIF-NGINX.bat to serve it on port 3000
echo ============================================================
echo.
pause
