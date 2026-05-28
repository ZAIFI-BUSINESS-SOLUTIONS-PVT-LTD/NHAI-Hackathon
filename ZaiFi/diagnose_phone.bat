@echo off
title ZAi-Fi — Diagnose & Launch
color 0E

set "ADB=adb"
where adb >nul 2>&1
if %errorlevel% neq 0 set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"

echo.
echo  ================================================
echo   ZAi-Fi — Diagnose Phone Installation
echo  ================================================
echo.

echo  [1] Checking device connection...
%ADB% devices
echo.

echo  [2] Checking if ZaiFi is installed on phone...
%ADB% shell pm list packages | findstr zaifi
if %errorlevel% neq 0 (
    echo  [NOT FOUND] ZaiFi package not installed. Trying to install APK directly...
    echo.
    if exist "android\app\build\outputs\apk\debug\app-debug.apk" (
        echo  [FOUND] APK found. Installing now...
        %ADB% install -r android\app\build\outputs\apk\debug\app-debug.apk
    ) else (
        echo  [ERROR] APK not found. Run run_on_phone.bat first.
    )
) else (
    echo  [OK] ZaiFi IS installed on your phone!
    echo.
    echo  [3] Force-launching ZaiFi now...
    %ADB% shell am start -n com.zaifi/.MainActivity
    echo.
    echo  [4] Forwarding Metro port...
    %ADB% reverse tcp:8081 tcp:8081
    %ADB% reverse tcp:8082 tcp:8082
    echo.
    echo  [5] Last 30 lines of crash log (if app crashed):
    echo  ------------------------------------------------
    %ADB% logcat -d -t 50 *:E 2>&1 | findstr /i "zaifi\|ReactNative\|FATAL\|AndroidRuntime\|crash"
)

echo.
echo  ================================================
pause
