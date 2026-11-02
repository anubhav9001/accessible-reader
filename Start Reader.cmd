@echo off
rem Starts the desktop reader. The first run also installs dependencies; later runs
rem rebuild only when the source code has changed.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, this happens only once...
  call npm install || goto :error
)
if not exist apps\desktop\samples (
  call npm run samples -w @accessible-reader/desktop
)
node apps\desktop\scripts\launch.mjs --detach || goto :error
exit /b 0

:error
echo.
echo The reader could not start. See the messages above.
pause
exit /b 1
