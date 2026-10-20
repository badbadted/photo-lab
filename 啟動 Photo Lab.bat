@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo 第一次執行，安裝套件中...
  call npm install
)
start "" "%~dp0node_modules\electron\dist\electron.exe" .
