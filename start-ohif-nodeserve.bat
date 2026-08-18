@echo off
TITLE SKM DICOM VIEWER - Build

:: Builds the production bundle (delegates to BUILD-OHIF-PROD.bat, the
:: real implementation, so there's one source of truth for the build steps).
:: Next step after this finishes: run-ohif-viewer.bat (serves it on port 3000).
call "%~dp0BUILD-OHIF-PROD.bat"
