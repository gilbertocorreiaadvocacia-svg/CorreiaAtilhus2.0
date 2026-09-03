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

rem  Segredos ficam em segredos.bat, um arquivo a parte que NAO vai para o
rem  repositorio. E ele que liga o espelho no Supabase. Sem ele, o sistema roda
rem  igual a sempre, so gravando nos arquivos JSON.
if exist "%~dp0segredos.bat" call "%~dp0segredos.bat"

echo.
echo   CORREIATENDIMENTOS
echo   Correia Advogados Associados
echo.
if defined CORREIA_SUPABASE_CHAVE (
  echo   Espelho do Supabase: LIGADO
) else (
  echo   Espelho do Supabase: desligado ^(sem segredos.bat^)
)
echo.
echo   Subindo o servidor... deixe esta janela aberta.
echo.

start "" http://localhost:4477
node servidor/index.js

echo.
echo   O servidor foi encerrado.
pause
