Set WshShell = CreateObject("WScript.Shell")

' 干掉占着 3377 的旧 node（如有）
WshShell.Run "powershell -WindowStyle Hidden -Command ""try { Get-NetTCPConnection -LocalPort 3377 -State Listen -EA Stop | % { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue } } catch {}""", 0, True

' 用 PowerShell 以正确的 working directory 启动 node
WshShell.Run "powershell -WindowStyle Hidden -Command ""Start-Process 'D:\nodes\node.exe' -ArgumentList 'C:\Users\Aris\market-hub\server.js' -WorkingDirectory 'C:\Users\Aris\market-hub' -WindowStyle Hidden""", 0, False

' 等服务起来
WScript.Sleep 5000

' 每天一个全新 Chrome profile，不复用任何缓存
Dim d : d = Year(Now) & Right("0"&Month(Now),2) & Right("0"&Day(Now),2)
Dim profileDir : profileDir = "C:\Windows\Temp\mhub-chrome-" & d
WshShell.Run """C:\Program Files\Google\Chrome\Application\chrome.exe"" --user-data-dir=""" & profileDir & """ --new-window http://localhost:3377", 1, False
