@echo off
rem Start WebSocket Gateway (3018) and Delivery Server (3019) on this PC.
rem Keep both windows open while using the system (closing a window stops that server).
rem Data Monitor (port 320) runs separately: start-data-monitor.bat
cd /d "%~dp0"

for %%d in (ws-gateway delivery-server) do (
  if not exist "%%d\node_modules" (
    echo Installing %%d packages...
    pushd %%d
    call npm install
    popd
  )
)

start "ws-gateway (3018)" cmd /k "cd /d "%~dp0ws-gateway" && npm start"
start "delivery-server (3019)" cmd /k "cd /d "%~dp0delivery-server" && npm start"

echo.
echo Servers started in 2 new windows:
echo   Gateway  : http://localhost:3018/health
echo   Delivery : http://localhost:3019/health   (admin: http://localhost:3019/admin)
echo.
echo ESP32 box uses: ws://192.168.1.100:3018/ws/device and http://192.168.1.100:3019
echo If Windows Firewall asks, click Allow (Private network).
echo.
pause
