@echo off
rem ---------------------------------------------------------------------
rem  Desliga o inicio automatico. NAO apaga nada do sistema nem dos dados,
rem  so tira o atalho da pasta de Inicializacao. O servidor que ja estiver
rem  rodando continua ate o proximo desligamento do Windows.
rem ---------------------------------------------------------------------
setlocal
set "ATALHO=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Correiatendimentos.lnk"

echo.
if exist "%ATALHO%" (
  del "%ATALHO%"
  echo   [ok] Inicio automatico desligado.
) else (
  echo   O inicio automatico ja estava desligado.
)

echo.
echo   O servidor que ja esta rodando NAO foi encerrado. Para para-lo agora,
echo   abra o Gerenciador de Tarefas e encerre o processo "node.exe", ou
echo   reinicie o Windows.
echo.
pause
