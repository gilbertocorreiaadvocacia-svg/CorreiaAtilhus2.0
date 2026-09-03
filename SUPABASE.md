# Supabase — espelho do Correiatendimentos

Este documento explica o que existe no Supabase, como ligar o espelho, como
carregar os dados de hoje e como conferir os dois lados. Nada aqui muda o dia a
dia: enquanto durar esta fase, **o arquivo JSON continua sendo a verdade** e o
sistema roda igual mesmo com o Supabase desligado.

## O que já existe

- Projeto `correia-atilhus-dev`, região São Paulo (`sa-east-1`).
- Schema **`atendimento`** com **25 tabelas** (as 24 coleções do sistema + `mensagens`).
  Cada tabela guarda o registro inteiro numa coluna `jsonb`; as colunas de
  consulta (`workspace_id`, `contato_id`, etc.) são **geradas** a partir dela, então
  coluna e jsonb nunca discordam.
- Três funções no schema `public`, todas **só para a chave de serviço**:
  - `espelhar_atendimento(lote)` — a porta de escrita que o espelho usa.
  - `contar_atendimento()` — contagem por tabela, para a conferência.
- O schema `atendimento` fica **fora da API REST** de propósito. Confirme quando
  quiser: com a chave pública, `atendimento` responde `PGRST106 (Invalid schema)`
  e as funções respondem `permission denied`.

## Ligar o espelho (escrita dupla)

O espelho é ligado por duas variáveis de ambiente, guardadas no `segredos.bat`
(que **não** vai para o repositório). Copie o `segredos-EXEMPLO.bat` como
`segredos.bat` e cole a chave **service_role** (Painel do Supabase →
Project Settings → API Keys → `service_role`):

```bat
set CORREIA_SUPABASE_URL=https://vmmvvmmlnemdhahbyghy.supabase.co
set CORREIA_SUPABASE_CHAVE=<a sua chave service_role>
```

Com o `segredos.bat` no lugar, o `INICIAR.bat` mostra **"Espelho do Supabase:
LIGADO"** e cada alteração passa a ser copiada para o Supabase em segundo plano.
Sem o arquivo, o espelho fica inerte e o sistema roda só nos arquivos JSON.

> A chave service_role passa por cima do RLS e dá acesso total ao banco. Ela vive
> no `segredos.bat`, nunca no código e nunca no repositório.

## Carregar os dados de hoje (uma vez)

O espelho só copia o que **muda depois** que o servidor sobe. Os dados que já
existem (contatos, logs, mensagens) precisam de uma carga inicial. Com as
variáveis definidas:

```bash
node servidor/ferramentas/carregar-supabase.js
```

Lê tudo de `dados/` e empurra pela mesma porta do espelho, em lotes. É
**idempotente** (a função faz `on conflict do update`): pode rodar de novo sem
duplicar nada.

## Conferir os dois lados

```bash
node servidor/ferramentas/conferir-supabase.js
```

Conta cada coleção no disco e compara com a contagem do Supabase. Diz, tabela por
tabela, se bate ou diverge. Não muda nada — só lê e compara. Sai com código 0 se
tudo bate, 2 se algo diverge.

## Segurança (postura atual)

- **RLS ligado em todas as 25 tabelas, sem política** para `anon`/`authenticated`
  — ou seja, ninguém sem a chave de serviço enxerga nada. É o padrão seguro:
  negar tudo, menos o servidor. O aviso `rls_enabled_no_policy` do Supabase é
  esperado nesta fase e não é um problema.
- **Só a chave de serviço** (o servidor, via `segredos.bat`) escreve e conta.
- O schema `atendimento` **não está exposto** na API REST.

Portão para o futuro: se um dia o schema for exposto via PostgREST (para um app
ler direto do Supabase), aí **sim** será preciso escrever políticas de RLS
explícitas antes de expor — hoje não há nenhuma, porque não é preciso.

## O passo que ainda não foi dado: "virar a chave"

Hoje o Supabase é um **espelho**: recebe cópia, mas nada lê dele. Passar a usá-lo
como fonte de leitura (para hospedar o sistema fora desta máquina) é um passo
maior e separado, que ainda **não** foi feito. Ele exige, além do que já existe:
sessões e agendador compartilhados entre instâncias, eventos (SSE) com fan-out,
e a decisão de identidade (manter o login atual em `scrypt` ou migrar para o
Supabase Auth). Enquanto isso não acontecer, a verdade é o JSON local e o
Supabase é a cópia de segurança viva.
