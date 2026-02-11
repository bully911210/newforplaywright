@echo off
cd /d "%~dp0"
node build\standalone.js 2>> poller.log
