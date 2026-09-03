-- Tabelas do Correiatendimentos.
--
-- `dados` guarda o registro INTEIRO em jsonb, do jeito que o JavaScript ja usa,
-- e as colunas de consulta sao GERADAS a partir dele. Com colunas normais, o
-- adaptador teria de desmontar e remontar cada registro, tabela por tabela, e
-- um campo esquecido em qualquer um dos 25 mapeamentos viraria perda silenciosa
-- de dado. Sendo geradas, coluna e jsonb nao tem como discordar.
--
-- Data fica como TEXTO, e nao timestamptz: `text::timestamptz` nao e imutavel e
-- o Postgres recusa em coluna gerada, e o codigo hoje ja compara data como
-- string ISO, que ordena igual.
--
-- RLS ligada e sem politica nenhuma: so a chave de servico entra, que e o nosso
-- servidor Node. Sem isso, no dia em que o schema for exposto na API do
-- Supabase, conversa de cliente ficaria aberta.

create table if not exists atendimento.workspaces (
  id    text  primary key,
  dados jsonb not null,
  criado_em text generated always as (dados->>'criadoEm') stored
);
alter table atendimento.workspaces enable row level security;

create table if not exists atendimento.usuarios (
  id    text  primary key,
  dados jsonb not null,
  criado_em text generated always as (dados->>'criadoEm') stored
);
alter table atendimento.usuarios enable row level security;

create table if not exists atendimento.membros (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored,
  usuario_id text generated always as (dados->>'usuarioId') stored
);
create index if not exists membros_workspace_idx on atendimento.membros (workspace_id);
create index if not exists membros_usuario_id_idx on atendimento.membros (usuario_id);
alter table atendimento.membros enable row level security;

create table if not exists atendimento.conexoes (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored
);
create index if not exists conexoes_workspace_idx on atendimento.conexoes (workspace_id);
alter table atendimento.conexoes enable row level security;

create table if not exists atendimento.status (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored,
  tipo text generated always as (dados->>'tipo') stored
);
create index if not exists status_workspace_idx on atendimento.status (workspace_id);
create index if not exists status_tipo_idx on atendimento.status (tipo);
alter table atendimento.status enable row level security;

create table if not exists atendimento.departamentos (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored
);
create index if not exists departamentos_workspace_idx on atendimento.departamentos (workspace_id);
alter table atendimento.departamentos enable row level security;

create table if not exists atendimento.etiquetas (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored
);
create index if not exists etiquetas_workspace_idx on atendimento.etiquetas (workspace_id);
alter table atendimento.etiquetas enable row level security;

create table if not exists atendimento.origens (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored
);
create index if not exists origens_workspace_idx on atendimento.origens (workspace_id);
alter table atendimento.origens enable row level security;

create table if not exists atendimento.variaveis (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored
);
create index if not exists variaveis_workspace_idx on atendimento.variaveis (workspace_id);
alter table atendimento.variaveis enable row level security;

create table if not exists atendimento.agentes (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored
);
create index if not exists agentes_workspace_idx on atendimento.agentes (workspace_id);
alter table atendimento.agentes enable row level security;

create table if not exists atendimento.conhecimento (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored
);
create index if not exists conhecimento_workspace_idx on atendimento.conhecimento (workspace_id);
alter table atendimento.conhecimento enable row level security;

create table if not exists atendimento.templates (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored
);
create index if not exists templates_workspace_idx on atendimento.templates (workspace_id);
alter table atendimento.templates enable row level security;

create table if not exists atendimento.contatos (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored,
  conexao_id text generated always as (dados->>'conexaoId') stored,
  status_id text generated always as (dados->>'statusId') stored,
  departamento_id text generated always as (dados->>'departamentoId') stored,
  origem_id text generated always as (dados->>'origemId') stored,
  telefone text generated always as (dados->>'telefone') stored,
  estado text generated always as (dados->>'estado') stored,
  status_alterado_em text generated always as (dados->>'statusAlteradoEm') stored,
  ultima_mensagem_em text generated always as (dados->>'ultimaMensagemEm') stored
);
create index if not exists contatos_workspace_idx on atendimento.contatos (workspace_id);
create index if not exists contatos_conexao_id_idx on atendimento.contatos (conexao_id);
create index if not exists contatos_status_id_idx on atendimento.contatos (status_id);
create index if not exists contatos_departamento_id_idx on atendimento.contatos (departamento_id);
create index if not exists contatos_origem_id_idx on atendimento.contatos (origem_id);
create index if not exists contatos_telefone_idx on atendimento.contatos (telefone);
create index if not exists contatos_estado_idx on atendimento.contatos (estado);
create index if not exists contatos_status_alterado_em_idx on atendimento.contatos (status_alterado_em);
create index if not exists contatos_ultima_mensagem_em_idx on atendimento.contatos (ultima_mensagem_em);
alter table atendimento.contatos enable row level security;

create table if not exists atendimento.tarefas (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored,
  contato_id text generated always as (dados->>'contatoId') stored,
  situacao text generated always as (dados->>'situacao') stored
);
create index if not exists tarefas_workspace_idx on atendimento.tarefas (workspace_id);
create index if not exists tarefas_contato_id_idx on atendimento.tarefas (contato_id);
create index if not exists tarefas_situacao_idx on atendimento.tarefas (situacao);
alter table atendimento.tarefas enable row level security;

create table if not exists atendimento.agendamentos (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored,
  contato_id text generated always as (dados->>'contatoId') stored,
  estado text generated always as (dados->>'estado') stored
);
create index if not exists agendamentos_workspace_idx on atendimento.agendamentos (workspace_id);
create index if not exists agendamentos_contato_id_idx on atendimento.agendamentos (contato_id);
create index if not exists agendamentos_estado_idx on atendimento.agendamentos (estado);
alter table atendimento.agendamentos enable row level security;

create table if not exists atendimento.contratos (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored,
  contato_id text generated always as (dados->>'contatoId') stored
);
create index if not exists contratos_workspace_idx on atendimento.contratos (workspace_id);
create index if not exists contratos_contato_id_idx on atendimento.contratos (contato_id);
alter table atendimento.contratos enable row level security;

create table if not exists atendimento.compromissos (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored,
  contato_id text generated always as (dados->>'contatoId') stored
);
create index if not exists compromissos_workspace_idx on atendimento.compromissos (workspace_id);
create index if not exists compromissos_contato_id_idx on atendimento.compromissos (contato_id);
alter table atendimento.compromissos enable row level security;

create table if not exists atendimento.logs (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored,
  contato_id text generated always as (dados->>'contatoId') stored,
  tipo text generated always as (dados->>'tipo') stored
);
create index if not exists logs_workspace_idx on atendimento.logs (workspace_id);
create index if not exists logs_contato_id_idx on atendimento.logs (contato_id);
create index if not exists logs_tipo_idx on atendimento.logs (tipo);
alter table atendimento.logs enable row level security;

create table if not exists atendimento.notificacoes (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored,
  usuario_id text generated always as (dados->>'usuarioId') stored
);
create index if not exists notificacoes_workspace_idx on atendimento.notificacoes (workspace_id);
create index if not exists notificacoes_usuario_id_idx on atendimento.notificacoes (usuario_id);
alter table atendimento.notificacoes enable row level security;

create table if not exists atendimento.creditos (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored,
  contato_id text generated always as (dados->>'contatoId') stored
);
create index if not exists creditos_workspace_idx on atendimento.creditos (workspace_id);
create index if not exists creditos_contato_id_idx on atendimento.creditos (contato_id);
alter table atendimento.creditos enable row level security;

create table if not exists atendimento.integracoes (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored
);
create index if not exists integracoes_workspace_idx on atendimento.integracoes (workspace_id);
alter table atendimento.integracoes enable row level security;

create table if not exists atendimento.vozes (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored
);
create index if not exists vozes_workspace_idx on atendimento.vozes (workspace_id);
alter table atendimento.vozes enable row level security;

create table if not exists atendimento.chaves_api (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored
);
create index if not exists chaves_api_workspace_idx on atendimento.chaves_api (workspace_id);
alter table atendimento.chaves_api enable row level security;

create table if not exists atendimento.configuracoes (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored
);
create index if not exists configuracoes_workspace_idx on atendimento.configuracoes (workspace_id);
alter table atendimento.configuracoes enable row level security;

create table if not exists atendimento.mensagens (
  id    text  primary key,
  dados jsonb not null,
  workspace_id text generated always as (dados->>'workspaceId') stored,
  criado_em text generated always as (dados->>'criadoEm') stored,
  contato_id text generated always as (dados->>'contatoId') stored
);
create index if not exists mensagens_workspace_idx on atendimento.mensagens (workspace_id);
create index if not exists mensagens_contato_id_idx on atendimento.mensagens (contato_id);
alter table atendimento.mensagens enable row level security;
