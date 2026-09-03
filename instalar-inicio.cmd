@echo off
rem ---------------------------------------------------------------------
rem  Liga o inicio automatico: o Correiatendimentos passa a subir sozinho,
rem  escondido, toda vez que o Windows faz login. Roda uma vez so.
rem
rem  - Cria um atalho na pasta de Inicializacao do usuario (sem admin, sem
rem    Agendador de Tarefas), apontando para o iniciar-oculto.vbs.
rem  - Poe um atalho "Correiatendimentos" na Area de Trabalho, que so abre o
rem    navegador em http://localhost:4477.
rem  - Sobe o servidor agora, sem precisar reiniciar.
rem ---------------------------------------------------------------------
setlocal
cd /d "%~dp0"

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "ATALHO=%STARTUP%\Correiatendimentos.lnk"

echo.
echo   Ligando o inicio automatico do Correiatendimentos...

rem  Cria o atalho de inicializacao (wscript roda o .vbs escondido)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%ATALHO%'); $s.TargetPath=Join-Path $env:SystemRoot 'System32\wscript.exe'; $s.Arguments='\"%~dp0iniciar-oculto.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.Description='Correiatendimentos (inicio automatico)'; $s.Save()"

if exist "%ATALHO%" (
  echo   [ok] Atalho de inicializacao criado.
) else (
  echo   [X] Nao consegui criar o atalho de inicializacao.
)

rem  Poe o atalho de abrir no navegador na Area de Trabalho
copy /y "%~dp0Correiatendimentos.url" "%USERPROFILE%\Desktop\Correiatendimentos.url" >nul
if exist "%USERPROFILE%\Desktop\Correiatendimentos.url" (
  echo   [ok] Atalho na Area de Trabalho criado.
)

rem  Sobe agora, escondido, sem esperar o proximo login
wscript "%~dp0iniciar-oculto.vbs"
echo   [ok] Servidor subindo em segundo plano.

echo.
echo   Pronto. A partir de agora:
echo     - o sistema sobe sozinho a cada login, sem janela preta;
echo     - o atalho "Correiatendimentos" na Area de Trabalho abre no navegador.
echo.
echo   Para desligar o inicio automatico, rode o desinstalar-inicio.cmd.
echo.
pause
