@echo off
TITLE SKM DICOM VIEWER - Reload Nginx
color 0B

REM Zero-downtime reload — use this after BUILD-OHIF-PROD.bat or after
REM editing nginx-ohif\nginx.conf. Does NOT drop in-flight connections.

set NGINX_EXE=D:\SKMPACS\nginx\nginx.exe
if not exist "%NGINX_EXE%" set NGINX_EXE=D:\nginx\nginx.exe
if not exist "%NGINX_EXE%" (
    echo ERROR: nginx.exe not found at D:\SKMPACS\nginx\ or D:\nginx\
    pause
    exit /b 1
)

tasklist /FI "IMAGENAME eq nginx.exe" 2>NUL | find /I "nginx.exe" >NUL
if errorlevel 1 (
    echo Nginx is not currently running - use START-OHIF-NGINX.bat instead.
    pause
    exit /b 1
)

REM Must launch from nginx's own directory - it resolves relative paths
REM (and locates the running master's pid file) against cwd at launch.
for %%I in ("%NGINX_EXE%") do set NGINX_DIR=%%~dpI
cd /d "%NGINX_DIR%"

echo Reloading nginx configuration...
"%NGINX_EXE%" -s reload -c D:\SKMPACS\nginx-ohif\nginx.conf
if errorlevel 1 (
    echo ERROR: reload failed. Check D:\SKMPACS\nginx-ohif\logs\error.log
    pause
    exit /b 1
)

echo Reload complete.
pause
