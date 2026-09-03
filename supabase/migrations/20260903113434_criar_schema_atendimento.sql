-- Schema do Correiatendimentos, separado do resto do projeto.
--
-- O sistema de atendimento e outra base: conversa de WhatsApp, mensagem,
-- agente de IA, funil comercial. Nada disso se cruza com as tabelas de
-- estrutura do escritorio que ja moram no schema public, e misturar os dois
-- deixaria "contatos" com dois significados diferentes no mesmo banco.
--
-- IF NOT EXISTS para a migracao poder rodar de novo sem quebrar.
CREATE SCHEMA IF NOT EXISTS atendimento;

COMMENT ON SCHEMA atendimento IS
  'Correiatendimentos: atendimento por WhatsApp, agentes de IA e funil comercial. Separado do public, que guarda a estrutura do escritorio.';
