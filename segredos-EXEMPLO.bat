@echo off
rem ---------------------------------------------------------------------
rem  MODELO. Copie este arquivo como  segredos.bat  e ponha a sua chave.
rem
rem  O segredos.bat NAO vai para o repositorio nem para o zip: e ele que
rem  guarda a chave de servico do Supabase, que da acesso total ao banco.
rem  Este modelo aqui vai, porque nao tem segredo nenhum dentro.
rem
rem  Onde achar a chave:
rem    Painel do Supabase > Project Settings > API Keys > service_role
rem    (a que comeca com  sb_secret_  ou o JWT longo marcado "service_role")
rem
rem  Enquanto este arquivo nao existir, o sistema roda exatamente como antes,
rem  gravando so nos arquivos JSON. O espelho fica desligado.
rem ---------------------------------------------------------------------

set CORREIA_SUPABASE_URL=https://vmmvvmmlnemdhahbyghy.supabase.co
set CORREIA_SUPABASE_CHAVE=COLE_AQUI_A_CHAVE_SERVICE_ROLE
