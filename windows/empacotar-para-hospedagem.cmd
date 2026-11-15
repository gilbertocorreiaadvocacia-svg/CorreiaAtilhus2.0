@echo off
rem  Empacota a pasta dados/ para levar para a hospedagem (ver HOSPEDAGEM.md).
rem  PARE o sistema antes: com ele no ar, o pacote pode sair com um arquivo pela metade.
rem  A batida e /api/vivo. /api/saude exige administrador: o 401 caia no catch
rem  e o script empacotava dados/ com o servidor ligado.
cd /d "%~dp0.."
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4477/api/vivo -TimeoutSec 2 | Out-Null; exit 1 } catch { exit 0 }"
if errorlevel 1 (
  echo O sistema esta no ar. Pare o sistema antes de empacotar.
  exit /b 1
)
tar -czf dados-para-hospedagem.tar.gz -C dados .
echo.
echo Pronto: dados-para-hospedagem.tar.gz
echo Tem dados de clientes dentro: nao mande por e-mail nem suba no GitHub.
