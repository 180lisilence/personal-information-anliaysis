@echo off
rem ============================================================
rem  Build WebCrawler.exe (single-file GUI) with PyInstaller.
rem  NOTE: keep this file PURE ASCII - cmd.exe parses .bat with
rem  the OEM codepage, non-ASCII bytes here break the script.
rem ============================================================
setlocal
cd /d "%~dp0"

set "PYEXE=E:\pythonpath\python.exe"
if not exist "%PYEXE%" set "PYEXE=C:\Users\19513\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
if not exist "%PYEXE%" set "PYEXE=python"

echo [1/2] using python: %PYEXE%
"%PYEXE%" -c "import PyInstaller" >nul 2>&1
if errorlevel 1 (
  echo [INFO] installing pyinstaller ...
  "%PYEXE%" -m pip install pyinstaller -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com
)

echo [2/2] building ...
"%PYEXE%" -m PyInstaller --noconfirm --clean --onefile --windowed --name WebCrawler --hidden-import bs4 --hidden-import lxml --hidden-import crawl gui.py

if errorlevel 1 (
  echo.
  echo [ERROR] build failed, see the output above.
  pause
  exit /b 1
)

if exist "WebCrawler.exe" del "WebCrawler.exe" >nul 2>&1
copy /y "dist\WebCrawler.exe" "WebCrawler.exe" >nul 2>&1

echo.
echo [OK] built: %cd%\WebCrawler.exe
pause
exit /b 0
