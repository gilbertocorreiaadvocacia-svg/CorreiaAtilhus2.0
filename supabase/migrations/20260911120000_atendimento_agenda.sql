-- Os nomes salvos na agenda do celular de cada numero conectado por QR Code.
-- Mesmo desenho das outras colecoes: o registro inteiro em jsonb, e as colunas
-- de consulta geradas a partir dele.
create table if not exists atendimento.agenda (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored
);
create index if not exists agenda_workspace_idx on atendimento.agenda (workspace_id);
alter table atendimento.agenda enable row level security;
