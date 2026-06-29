Set WshShell = CreateObject("WScript.Shell")

' 干掉占着 3377 的旧进程（如有）。netstat 比 Get-NetTCPConnection 更快，也不会卡在 CIM 查询。
WshShell.Run "powershell -WindowStyle Hidden -Command ""$line = netstat -ano -p tcp | Select-String ':3377\s+.*LISTENING' | Select-Object -First 1; if ($line) { $pidToStop = (($line.Line.Trim() -split '\s+')[-1]); Stop-Process -Id $pidToStop -Force -EA SilentlyContinue }""", 0, True

' 用 PowerShell 以正确的 working directory 启动 node
WshShell.Run "powershell -WindowStyle Hidden -Command ""Start-Process 'D:\nodes\node.exe' -ArgumentList 'C:\Users\Aris\market-hub\server.js' -WorkingDirectory 'C:\Users\Aris\market-hub' -WindowStyle Hidden""", 0, False

' 等服务起来
WScript.Sleep 5000

' 每天一个全新 Chrome profile，不复用任何缓存
Dim d : d = Year(Now) & Right("0"&Month(Now),2) & Right("0"&Day(Now),2)
Dim profileDir : profileDir = "C:\Windows\Temp\mhub-chrome-" & d
WshShell.Run """C:\Program Files\Google\Chrome\Application\chrome.exe"" --user-data-dir=""" & profileDir & """ --new-window http://localhost:3377", 1, False
