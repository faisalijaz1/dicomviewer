@echo off
TITLE SKM DICOM VIEWER — Nginx (Production)
color 0B

set NGINX_DIR=D:\SKMPACS\nginx
set NGINX_EXE=%NGINX_DIR%\nginx.exe
set NGINX_CONF=D:\SKMPACS\nginx-ohif\nginx.conf
set DIST_DIR=D:\SKMPACS\ohif-viewer\platform\app\dist

echo.
echo  ============================================================
echo   SKM DICOM VIEWER — Starting Nginx Static Server
echo  ============================================================
echo.

REM ── Check Nginx is installed ─────────────────────────────────────────────
if not exist "%NGINX_EXE%" (
    echo  ERROR: Nginx not found at %NGINX_DIR%
    echo.
    echo  INSTALLATION STEPS:
    echo    1. Download Nginx for Windows (stable):
    echo       https://nginx.org/en/download.html
    echo       (download the .zip file, e.g. nginx-1.26.x.zip)
    echo.
    echo    2. Extract the zip to:  D:\SKMPACS\nginx\
    echo       After extraction you should have:
    echo         D:\SKMPACS\nginx\nginx.exe
    echo         D:\SKMPACS\nginx\conf\mime.types
    echo.
    echo    3. Run this bat file again.
    echo.
    pause
    exit /b 1
)

REM ── Check OHIF dist is built ─────────────────────────────────────────────
if not exist "%DIST_DIR%\index.html" (
    echo  ERROR: OHIF build not found at %DIST_DIR%\index.html
    echo.
    echo  Run  BUILD-OHIF-PROD.bat  first to create the production build.
    echo.
    pause
    exit /b 1
)

REM ── Stop any running Nginx instance ──────────────────────────────────────
tasklist /FI "IMAGENAME eq nginx.exe" 2>nul | find /I "nginx.exe" >nul
if not errorlevel 1 (
    echo  Stopping existing Nginx instance...
    "%NGINX_EXE%" -c "%NGINX_CONF%" -s quit >nul 2>&1
    timeout /t 2 /nobreak >nul
)

REM ── Test the nginx config before starting ────────────────────────────────
echo  Validating Nginx configuration...
"%NGINX_EXE%" -c "%NGINX_CONF%" -t
if errorlevel 1 (
    echo.
    echo  ERROR: Nginx configuration is invalid. Fix nginx.conf and retry.
    pause
    exit /b 1
)

REM ── Start Nginx ───────────────────────────────────────────────────────────
echo  Starting Nginx...
start "" "%NGINX_EXE%" -c "%NGINX_CONF%"
timeout /t 2 /nobreak >nul

REM ── Verify it started ────────────────────────────────────────────────────
tasklist /FI "IMAGENAME eq nginx.exe" 2>nul | find /I "nginx.exe" >nul
if errorlevel 1 (
    echo.
    echo  ERROR: Nginx failed to start. Check logs at:
    echo    D:\SKMPACS\nginx-ohif\logs\error.log
    pause
    exit /b 1
)

echo.
echo  ============================================================
echo   SKM DICOM VIEWER IS RUNNING
echo  ============================================================
echo.
echo   URL:       http://192.192.27.81:3000
echo   Localhost: http://localhost:3000
echo.
echo   Mode:      PRODUCTION (Nginx static server)
echo   Assets:    Cached in browser for 1 year (fast repeated opens)
echo   Config:    Fetched fresh every open (no caching)
echo.
echo   Logs:      D:\SKMPACS\nginx-ohif\logs\access.log
echo              D:\SKMPACS\nginx-ohif\logs\error.log
echo.
echo   To STOP:   Run  STOP-OHIF-NGINX.bat
echo              OR close this window and run:
echo              D:\SKMPACS\nginx\nginx.exe -c %NGINX_CONF% -s quit
echo.
echo  ============================================================
echo.
echo  Press any key to open the access log (Ctrl+C to exit)...
pause >nul

REM ── Tail the access log so the window stays useful ───────────────────────
echo.
echo  [Access Log — new requests appear below]
echo  ─────────────────────────────────────────
powershell -Command "Get-Content 'D:\SKMPACS\nginx-ohif\logs\access.log' -Wait -Tail 20" 2>nul
