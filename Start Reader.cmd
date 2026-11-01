@echo off
rem Builds and starts the desktop reader. The first run also installs dependencies.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, this happens only once...
  call npm install || goto :error
)
if not exist apps\desktop\samples (
  call npm run samples -w @accessible-reader/desktop
)
call npm start -w @accessible-reader/desktop || goto :error
exit /b 0

:error
echo.
echo The reader could not start. See the messages above.
pause
exit /b 1
