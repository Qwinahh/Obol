@echo off
cd /d "%~dp0widget"
start "" "node_modules\electron\dist\electron.exe" .
