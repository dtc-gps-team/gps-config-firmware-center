@echo off
rem Start Data Monitor (port 320): receives GPS data from boxes at /api/gps and shows it live.
rem Keep the window open while monitoring (closing it stops the monitor).
cd /d "%~dp0"

if not exist "data-monitor\node_modules" (
  echo Installing data-monitor packages...
  pushd data-monitor
  call npm install
  popd
)

start "data-monitor (320)" cmd /k "cd /d "%~dp0data-monitor" && npm start"

echo.
echo Data Monitor started:
echo   Web page : http://localhost:320
echo   Box sends: http://192.168.1.100:320/api/gps
echo.
echo If Windows Firewall asks, click Allow (Private network).
echo.
pause
