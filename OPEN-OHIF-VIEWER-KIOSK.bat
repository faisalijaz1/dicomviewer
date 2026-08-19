@echo off
TITLE SKM DICOM VIEWER - Launch (no address bar)
color 0B

echo.
echo ============================================================
echo   SKM DICOM VIEWER - Launching in app mode
echo   (chromeless window: no address bar, no tabs)
echo ============================================================
echo.

set "VIEWER_URL=http://localhost:3000"

:: Try common Chrome install locations, in order.
set "CHROME_EXE="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not defined CHROME_EXE (
  echo ERROR: Could not find chrome.exe in the usual install locations.
  echo   Checked:
  echo     %ProgramFiles%\Google\Chrome\Application\chrome.exe
  echo     %ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
  echo     %LocalAppData%\Google\Chrome\Application\chrome.exe
  echo   If Chrome is installed somewhere else, edit this file and set CHROME_EXE manually.
  pause
  exit /b 1
)

echo   Using: %CHROME_EXE%
echo   URL:   %VIEWER_URL%
echo.
echo   NOTE: Make sure the server is already running
echo   (RUN-OHIF-NGINX.bat or run-ohif-viewer.bat) before using this.
echo ============================================================
echo.

start "" "%CHROME_EXE%" --app="%VIEWER_URL%"
