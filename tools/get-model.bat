@echo off
rem Get the listening model, once. The ONLY step of the film maker that uses the internet. Double-click this file; keep it in the tools folder next to start-maker.bat.
rem The model goes into the models folder of this Ryagram folder (unless you set RYAGRAM_MODEL_DIR yourself), the same place start-maker.bat looks.
setlocal
title Get the listening model
cd /d "%~dp0.."
set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY goto nopython
if not defined RYAGRAM_MODEL_DIR set "RYAGRAM_MODEL_DIR=%CD%\models"
echo This downloads the listening model once, about 150 MB. It is the only step that uses the internet.
echo It will be saved in: %RYAGRAM_MODEL_DIR%
echo.
%PY% -m ryagram.library models --get base %*
if errorlevel 1 goto failed
echo.
echo Done. You can close this window and double-click start-maker.bat.
pause
exit /b 0
:failed
echo.
echo The download did not finish. Check that you are online, then double-click this file again. If it still fails, send the lines above to Ryan.
pause
exit /b 1
:nopython
echo Python was not found on this computer.
echo Install Python 3.12 from python.org and tick "Add python.exe to PATH" during setup, then double-click this file again.
pause
exit /b 1
