@echo off
rem Get the listening model, once. The ONLY step of the film maker that uses the internet. Double-click this file; keep it in the tools folder next to start-maker.bat.
rem The model goes into the models folder of this Ryagram folder (unless you set RYAGRAM_MODEL_DIR yourself), the same place start-maker.bat looks.
rem The long technical text of a failed download is kept in a log file next to the models folder, not shown to you.
setlocal enabledelayedexpansion
title Get the listening model
cd /d "%~dp0.."
set "PY="
rem A Python counts only if it really runs (Windows 11 ships a python.exe stub that sends you to the Microsoft Store); call, so a python.bat shim returns here.
call py -c "import sys" >nul 2>nul && set "PY=py"
if not defined PY call python -c "import sys" >nul 2>nul && set "PY=python"
if not defined PY goto nopython
if not defined RYAGRAM_MODEL_DIR set "RYAGRAM_MODEL_DIR=%CD%\models"
rem No word after the file name fetches the Fast one (as always). "balanced" fetches the Balanced one (bigger), "quickest" the Quickest test.
set "MODEL=base"
set "SIZE=about 150 MB"
set "EXTRA=%*"
if /i "%~1"=="balanced" (set "MODEL=small" & set "SIZE=about 460 MB" & set "EXTRA=")
if /i "%~1"=="quickest" (set "MODEL=tiny" & set "SIZE=about 75 MB" & set "EXTRA=")
set "LOG=%RYAGRAM_MODEL_DIR%.get-model.log"
echo This downloads the listening model once, %SIZE%. It is the only step that uses the internet.
echo It will be saved in: %RYAGRAM_MODEL_DIR%
echo Please wait. This can take a few minutes, and nothing is shown while it works.
echo.
call %PY% -m ryagram.library models --get %MODEL% %EXTRA% > "%LOG%" 2>&1
if errorlevel 1 goto failed
echo Done. You can close this window and double-click start-maker.bat.
pause
exit /b 0
:failed
set "LAST="
for /f "usebackq delims=" %%L in ("%LOG%") do set "LAST=%%L"
echo The download did not finish. Check that you are online, then double-click this file again.
echo The last line of the error was: !LAST!
echo If it still fails, send this file to Ryan: %LOG%
pause
exit /b 1
:nopython
echo Python was not found on this computer.
echo Install Python 3.12 from python.org and tick "Add python.exe to PATH" during setup, then double-click this file again.
pause
exit /b 1
