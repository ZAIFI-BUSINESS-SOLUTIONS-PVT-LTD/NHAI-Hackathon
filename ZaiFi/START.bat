@echo off
title ZAi-Fi
color 0A
cd /d D:\13_claude_Code\14_NHAI\ZaiFi

set "ADB=adb"
where adb >nul 2>&1
if %errorlevel% neq 0 set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"

echo Killing old Metro...
taskkill /f /im node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Forwarding ports...
%ADB% reverse tcp:8081 tcp:8081 >nul 2>&1
%ADB% reverse tcp:8082 tcp:8082 >nul 2>&1

echo Starting Metro...
start "" cmd /c "cd /d D:\13_claude_Code\14_NHAI\ZaiFi && npx react-native start --reset-cache"
timeout /t 10 /nobreak >nul

echo Building and installing on phone...
call npx react-native run-android

echo Launching app on phone...
%ADB% shell am start -n com.zaifi/.MainActivity

echo.
echo DONE - ZaiFi should now be open on your phone.
pause
