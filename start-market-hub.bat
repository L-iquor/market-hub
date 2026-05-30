@echo off
cd /d C:\Users\Aris\market-hub

:loop
echo [%date% %time%] 市场部服务启动
D:\nodes\node.exe server.js
echo [%date% %time%] 服务退出（code %errorlevel%），3秒后重启...
timeout /t 3 /nobreak >nul
goto loop
