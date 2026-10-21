@echo off
rem Open Luau Studio (index.html) in a Chrome app window; fall back to the default browser.
set "HERE=%~dp0"
set "URL=file:///%HERE:\=/%index.html"
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" --app="%URL%" --window-size=1500,920
) else (
  start "" "%HERE%index.html"
)
