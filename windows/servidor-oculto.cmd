@echo off
rem  Sobe o servidor SEM janela, SEM abrir navegador, SEM pausa no fim.
rem  E o motor do inicio automatico: quem chama e o iniciar-oculto.vbs, que
rem  roda este arquivo com a janela escondida. Para uso manual/depuracao, use
rem  o INICIAR.bat, que mostra a janela e abre o navegador.
cd /d "%~dp0.."
if exist "%~dp0..\segredos.bat" call "%~dp0..\segredos.bat"
node servidor/index.js
