@echo off
rem TRSR Video: builds the interface and starts the local server at http://127.0.0.1:4477
cd /d "%~dp0"
if not exist node_modules call npm install
call npm start
