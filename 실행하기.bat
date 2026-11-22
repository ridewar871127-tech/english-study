@echo off
chcp 65001 > nul
title US Drama Dictation Studio
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port 8765
pause
