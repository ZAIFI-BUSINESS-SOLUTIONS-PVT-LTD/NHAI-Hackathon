@echo off
title ZAi-Fi — Install on Phone
color 0A

echo.
echo  ================================================
echo   ZAi-Fi — Auto Install to Android Device
echo  ================================================
echo.

:: Check ADB
where adb >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] ADB not found in PATH. Trying Android Studio location...
    set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
    if not exist "%ADB%" (
        echo  [ERROR] ADB not found. Install Android Studio or add platform-tools to PATH.
        pause
        exit /b 1
    )
) else (
    set "ADB=adb"
)

echo  [1/5] Checking connected devices...
%ADB% devices
echo.

:: Count connected devices
for /f "skip=1 tokens=2" %%i in ('%ADB% devices') do (
    if "%%i"=="device" (
        echo  [OK] Device detected!
        goto :device_found
    )
)
echo  [ERROR] No device found. Make sure:
echo    - USB debugging is ON
echo    - Cable is connected
echo    - You tapped "Allow" on the phone popup
pause
exit /b 1

:device_found
echo.
echo  [2/5] Forwarding Metro port through USB (no WiFi needed)...
%ADB% reverse tcp:8081 tcp:8081
%ADB% reverse tcp:8082 tcp:8082
echo  [OK] Port forwarding done.
echo.

echo  [3/5] Killing any old Metro instances...
taskkill /f /im node.exe >nul 2>&1
timeout /t 2 /nobreak >nul
echo  [OK] Done.
echo.

echo  [4/5] Starting Metro bundler in background...
start "Metro Bundler" cmd /k "cd /d D:\13_claude_Code\14_NHAI\ZaiFi && npm start -- --reset-cache"
echo  [OK] Metro starting... waiting 8 seconds for it to boot.
timeout /t 8 /nobreak >nul
echo.

echo  [5/5] Building and installing app on phone...
echo  (This takes 3-5 minutes on first build. Grab a coffee!)
echo.
cd /d D:\13_claude_Code\14_NHAI\ZaiFi
call npm run android

echo.
echo  ================================================
echo   Done! Check your phone for the ZAi-Fi app.
echo  ================================================
pause
