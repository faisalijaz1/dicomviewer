@echo off
TITLE SKM DICOM VIEWER - Stop Nginx
color 0C

set NGINX_EXE=D:\SKMPACS\nginx\nginx.exe
if not exist "%NGINX_EXE%" set NGINX_EXE=D:\nginx\nginx.exe
if not exist "%NGINX_EXE%" (
    echo ERROR: nginx.exe not found at D:\SKMPACS\nginx\ or D:\nginx\
    pause
    exit /b 1
)

REM Must launch from nginx's own directory - it resolves relative paths
REM (and locates the running master's pid file) against cwd at launch.
for %%I in ("%NGINX_EXE%") do set NGINX_DIR=%%~dpI
cd /d "%NGINX_DIR%"

echo Stopping nginx (graceful)...
"%NGINX_EXE%" -s stop -c D:\SKMPACS\nginx-ohif\nginx.conf

REM Fallback: if the graceful stop signal didn't work for any reason
REM (e.g. PID file mismatch), force-kill any remaining nginx.exe processes.
tasklist /FI "IMAGENAME eq nginx.exe" 2>NUL | find /I "nginx.exe" >NUL
if not errorlevel 1 (
    echo Graceful stop did not fully exit - forcing termination...
    taskkill /IM nginx.exe /F >NUL 2>&1
)

echo Nginx stopped.
pause
