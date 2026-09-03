@echo off
rem ---------------------------------------------------------------------
rem  Publica o CorreiaAtilhus2.0 no GitHub com dois cliques.
rem
rem  Use quando VOCE mexeu em algo a mao e quer subir. (Quando o Claude
rem  faz uma alteracao, ele mesmo ja publica.) Os dados do escritorio
rem  (pasta dados/ e segredos.bat) NUNCA sobem: ficam no .gitignore.
rem
rem  Pode passar uma mensagem:  publicar.cmd  ajustei o texto do login
rem ---------------------------------------------------------------------
title CorreiaAtilhus2.0 - publicar no GitHub
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [X] O git nao foi encontrado nesta maquina.
  echo.
  pause
  exit /b 1
)

echo.
echo   Publicando o CorreiaAtilhus2.0 no GitHub...
echo.

git add -A

rem  Se nada mudou, nao faz commit vazio.
git diff --cached --quiet
if not errorlevel 1 (
  echo   Nada mudou desde a ultima publicacao. Nada a enviar.
  echo.
  pause
  exit /b 0
)

set "MSG=%*"
if "%MSG%"=="" set "MSG=Atualizacao %date% %time%"

git commit -m "%MSG%"
git push origin main

echo.
if errorlevel 1 (
  echo   [!] O envio falhou. Se abrir uma janela de login do GitHub, faca o login e rode de novo.
) else (
  echo   Pronto. Enviado para o GitHub.
)
echo.
pause
