@echo off
REM ===================================================================
REM Factum launcher.
REM
REM Double-click this. That is the whole interface.
REM
REM It builds its own environment on first run, launches with no
REM console window, and writes anything that goes wrong to
REM logs\launch.log rather than flashing a black window and vanishing.
REM The person launching this may be in a rehab room with a band
REM already strapped to someone's arm, and "it just closed" is not a
REM diagnosis.
REM
REM Usage:
REM   run.bat              normal launch, no console
REM   run.bat --console    launch in this window, to watch it run
REM   run.bat --run        everyday mode: detection only, no setup UI
REM
REM (The code folder is still called `armband` for backward compat.)
REM
REM THIS FILE MUST STAY ASCII-ONLY WITH CRLF LINE ENDINGS. cmd.exe
REM mis-parses LF-only batch files, and non-ASCII arrives as mojibake
REM in the OEM codepage. See scratchpad/write_runbat.py.
REM ===================================================================

setlocal
set "HERE=%~dp0"
set "VENV=%HERE%.venv"
set "PY=%VENV%\Scripts\python.exe"
set "PYW=%VENV%\Scripts\pythonw.exe"
set "LOGDIR=%HERE%logs"
set "LOG=%LOGDIR%\launch.log"

if not exist "%LOGDIR%" mkdir "%LOGDIR%"
echo [%DATE% %TIME%] launch requested >> "%LOG%"

REM Never let system site-packages or a stray PYTHONPATH leak in. The
REM system Python on this machine is 3.14 and shares a user-site dir.
set PYTHONNOUSERSITE=1
set PYTHONPATH=
set PYTHONIOENCODING=utf-8

REM ---- first run: build the environment ------------------------------
if exist "%PY%" goto have_venv

echo Setting up Factum for the first time. This takes a minute.
echo [%DATE% %TIME%] no venv at %PY% - creating >> "%LOG%"
where python >nul 2>&1
if errorlevel 1 goto no_python
python -m venv "%VENV%" --prompt factum >> "%LOG%" 2>&1
if errorlevel 1 goto venv_failed
"%PY%" -m pip install --upgrade pip >> "%LOG%" 2>&1
"%PY%" -m pip install numpy websocket-client >> "%LOG%" 2>&1
if errorlevel 1 goto deps_failed
echo [%DATE% %TIME%] venv ready >> "%LOG%"

:have_venv
REM ---- are the imports actually there? --------------------------------
"%PY%" -c "import numpy, websocket" >nul 2>&1
if not errorlevel 1 goto launch
echo Repairing dependencies...
echo [%DATE% %TIME%] imports missing - reinstalling >> "%LOG%"
"%PY%" -m pip install --upgrade numpy websocket-client >> "%LOG%" 2>&1

:launch
if /I "%~1"=="--console" goto console
if not exist "%PYW%" goto no_pythonw
echo [%DATE% %TIME%] starting pythonw >> "%LOG%"
start "" "%PYW%" "%HERE%armband\app.py" %*
exit /b 0

:no_pythonw
echo [%DATE% %TIME%] no pythonw - starting python minimised >> "%LOG%"
start "" /MIN "%PY%" "%HERE%armband\app.py" %*
exit /b 0

:console
shift
echo [%DATE% %TIME%] starting in console >> "%LOG%"
"%PY%" "%HERE%armband\app.py" %1 %2 %3 %4
exit /b %errorlevel%

:no_python
echo.
echo Python is not installed, or not on PATH.
echo Install Python 3.11 or newer from python.org, tick
echo "Add python.exe to PATH", then run this file again.
echo [%DATE% %TIME%] FAILED - no python on PATH >> "%LOG%"
pause
exit /b 1

:venv_failed
echo Could not create the environment. See logs\launch.log
echo [%DATE% %TIME%] FAILED - venv creation >> "%LOG%"
pause
exit /b 1

:deps_failed
echo Could not install the dependencies. See logs\launch.log
echo [%DATE% %TIME%] FAILED - dependency install >> "%LOG%"
pause
exit /b 1
