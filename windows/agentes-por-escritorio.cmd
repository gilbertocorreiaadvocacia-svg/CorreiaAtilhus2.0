@echo off
rem  Leva os agentes de cada area para o seu escritorio, direto na base desta
rem  maquina (ver servidor/ferramentas/agentes-por-escritorio.js).
rem  Rode com o servidor PARADO. Repassa os argumentos, ex.: --apagar-outros
cd /d "%~dp0.."
if exist "%~dp0..\segredos.bat" call "%~dp0..\segredos.bat"
node servidor/ferramentas/agentes-por-escritorio.js %*
