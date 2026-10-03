@echo off
rem Starts Vault Book on this computer only and opens it in your browser.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install || goto :error
)
echo Building the app...
call npm run build || goto :error
start "" http://localhost:4310
echo.
echo Vault Book is running at http://localhost:4310  (close this window to stop it)
call npm start
goto :eof

:error
echo Something went wrong. See the messages above.
pause
