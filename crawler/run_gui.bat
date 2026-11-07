@echo off
rem ============================================================
rem  Web Crawler - GUI launcher
rem  NOTE: keep this file PURE ASCII. cmd.exe parses .bat with
rem  the OEM codepage, so non-ASCII bytes here break the script.
rem  All Chinese messages are shown by gui.py via dialogs.
rem ============================================================
setlocal
cd /d "%~dp0"

rem --- pick a Python that has tkinter (the GUI needs it) ---
set "PYW=E:\pythonpath\pythonw.exe"
set "PYEXE=E:\pythonpath\python.exe"
if not exist "%PYEXE%" set "PYEXE=C:\Users\19513\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
if not exist "%PYEXE%" set "PYEXE=python"
if not exist "%PYW%" set "PYW=C:\Users\19513\.workbuddy\binaries\python\envs\default\Scripts\pythonw.exe"
if not exist "%PYW%" set "PYW=%PYEXE%"

rem --- sanity check: tkinter ---
"%PYEXE%" -c "import tkinter" >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERROR] This Python has no tkinter module: %PYEXE%
  echo Please edit run_gui.bat and set PYEXE to a Python with tkinter.
  echo.
  pause
  exit /b 1
)

rem --- sanity check: dependencies ---
"%PYEXE%" -c "import requests, bs4" >nul 2>&1
if errorlevel 1 (
  echo [INFO] Installing dependencies, please wait ...
  "%PYEXE%" -m pip install requests beautifulsoup4 lxml -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com
)

rem --- launch the GUI without a console window ---
start "" "%PYW%" gui.py

rem --- if pythonw died instantly, rerun in console mode to show the error ---
rem  use absolute System32 paths: bare "timeout" / "find" can be shadowed
rem  by Git-for-Windows unix tools sitting earlier in PATH.
"%SystemRoot%\System32\timeout.exe" /t 3 /nobreak >nul 2>&1
tasklist /fi "IMAGENAME eq pythonw.exe" 2>nul | "%SystemRoot%\System32\findstr.exe" /i /c:"pythonw.exe" >nul
if errorlevel 1 (
  echo.
  echo [WARN] The panel did not start. Showing the error below:
  echo.
  "%PYEXE%" gui.py
  echo.
  pause
)

exit /b 0
