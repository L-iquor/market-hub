Set WshShell = CreateObject("WScript.Shell")

' 启动 node 服务
WshShell.Run "cmd /c start /min cmd /k ""C:\Users\Aris\market-hub\start-market-hub.bat""", 0, False

' 等服务起来
WScript.Sleep 3500

' 每天一个全新 Chrome profile，不复用任何缓存
Dim d : d = Year(Now) & Right("0"&Month(Now),2) & Right("0"&Day(Now),2)
Dim profileDir : profileDir = "C:\Windows\Temp\mhub-chrome-" & d
WshShell.Run """C:\Program Files\Google\Chrome\Application\chrome.exe"" --user-data-dir=""" & profileDir & """ --new-window http://localhost:3377", 1, False
