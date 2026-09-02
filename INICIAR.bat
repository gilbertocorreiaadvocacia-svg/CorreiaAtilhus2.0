@echo off
title Correiatendimentos - Correia Advogados Associados
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [X] O Node.js nao foi encontrado neste computador.
  echo      Baixe a versao LTS em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

echo.
echo   CORREIATENDIMENTOS
echo   Correia Advogados Associados
echo.
echo   Subindo o servidor... deixe esta janela aberta.
echo.

start "" http://localhost:4477
node servidor/index.js

echo.
echo   O servidor foi encerrado.
pause
