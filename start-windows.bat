@echo off
title CYB Line Balancing server
cd /d "%~dp0"
rem To require a PIN for saving, change the line below to:  set CYB_PIN=1234
set CYB_PIN=
set CYB_PORT=8080
where py >nul 2>nul && (py -3 server.py & goto end)
where python >nul 2>nul && (python server.py & goto end)
echo.
echo Python 3 is not installed on this PC.
echo Install it from the python.org installer (tick "Add python.exe to PATH"), then run this file again.
:end
pause
