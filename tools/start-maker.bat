@echo off
rem Desktop maker, one click (INTERNAL prototype). Starts the maker on THIS computer only (127.0.0.1) and opens it in your browser.
rem Keep this file in the tools folder next to desktop_maker.py, inside the Ryagram folder. Leave the window open while you use the maker; close it to stop.
setlocal
title Desktop maker
cd /d "%~dp0.."
set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python was not found on this computer.
  echo Install Python 3.12 from python.org and tick "Add python.exe to PATH" during setup, then double-click this file again.
  pause
  exit /b 1
)
set "OPEN=--open"
if defined MAKER_NO_OPEN set "OPEN="
%PY% tools\desktop_maker.py %OPEN% %*
if errorlevel 1 (
  echo.
  echo The maker did not start. The message above says why.
  pause
)
