# Correiatendimentos

Plataforma de atendimento, agentes de IA e funil comercial no WhatsApp, feita
para o **Correia Advogados Associados**, com base na auditoria da LiderHub.

Preto e dourado, do escudo da marca. Roda no computador do escritório, sem
depender de serviço de fora.

---

## Como abrir

Dê dois cliques em **`INICIAR.bat`**.

Ele sobe o servidor e abre `http://localhost:4477` no navegador. Deixe a janela
preta aberta, se fechar, o sistema para.

**Primeiro acesso:**

- E-mail: `admin@correia.adv.br`
- Senha: `correia2026`

Troque a senha em **Configurações › Membros** assim que entrar.

> Precisa do Node.js instalado (versão LTS, em https://nodejs.org). Fora isso,
> nada: **zero dependências**, nenhum `npm install`, nenhum executável novo para
> o Windows barrar.

---

## O que já está pronto

### Conexão de WhatsApp

Dois modos, na mesma tela:

| Modo | Para que serve |
| --- | --- |
| **Simulador** | Funciona hoje, sem chip. Roda o funil inteiro, agente, menção, follow-up, contrato, para você testar antes de ligar em produção. |
| **API Oficial (Meta)** | Cloud API de verdade: webhook com conferência de assinatura, janela de 24 horas, template aprovado, status de entrega e alerta de qualidade do número. |

Cada conexão define o que acontece em **toda conversa nova**: status padrão,
departamento padrão e responsável padrão (normalmente o agente de triagem).

Para a API Oficial, a URL do webhook aparece no próprio cartão da conexão -
é só colar no painel da Meta junto com o token de verificação.

### Atendimento

- Cinco abas: **IA**, **Ativos**, **Pendentes**, **Grupos**, **Arquivados**.
- Três visualizações da mesma base: **Conversas**, **Contatos** (tabela) e
  **Kanban** (arrasta o cartão, muda o status).
- Agendar mensagem, nota interna com menção à equipe, assinatura do atendente,
  assumir conversa, arquivar, unificar conversas, nuvem de arquivos por cliente
  e histórico completo de tudo o que mudou.
- Resumo da conversa, simples ou detalhado, com período e instrução -
  gravado como nota interna.
- Ações em massa: status, departamento, responsável, etiquetas (adicionar,
  remover ou substituir), conexão e arquivamento.
- Importar e exportar contatos em CSV, e **exportar o histórico das conversas em
  texto**, filtrado por status e anonimizado por padrão. É o material para
  treinar agente: dez atendimentos exemplares ensinam mais que duzentos
  medianos. (No LiderHub isso só sai conversa por conversa, pelo app do
  WhatsApp.)
- **Anexar arquivo** (imagem, vídeo, áudio, PDF, até 16 MB) na conversa e no
  template. O arquivo fica guardado aqui e o sistema o envia direto para a
  Meta na hora do disparo, sem depender de link de fora que expira.
- **Excluir conversa em definitivo**, para quando o titular pede a eliminação
  dos dados (LGPD). Leva junto mensagens, arquivos, agendamentos, contratos e
  registros de consumo. Só administrador pode.
- **`/restart`** reinicia a conversa como se fosse um lead novo. É o atalho
  para testar mudança de prompt sem trocar de número.

### Agentes de IA

A tela tem três colunas: a **lista** de agentes, o **prompt** ocupando a área
principal, é onde o trabalho de verdade acontece, e um roteiro bom tem de 4 a
7 mil caracteres, e o **painel de configuração** à direita, com nove campos:
menções reconhecidas, ferramentas ativas, base de conhecimento, delay, agente
primário, palavra-chave, referências, voz e modelo de IA. Tudo salva sozinho ao
alterar; o prompt salva no botão ou com Ctrl+S.

Embaixo do prompt fica o contador de caracteres com um aviso de faixa: abaixo de
1.500 o agente tende a alucinar, acima de 7.400 fica caro e ele perde o fio.

O prompt é o roteiro. As **menções `@`** são o que transforma texto em ação:

| | | |
| --- | --- | --- |
| `@status` | `@tag` | `@departamento` |
| `@responsavel` | `@template` | `@origem` |
| `@variavel` | `@resumo` | `@notificar` |
| `@biblioteca` | `@calculadora` | `@think` |
| `@dataehora` | `@salvarnome` | `@ativaraudio` |
| `@desativaraudio` | `@desativarIA` | `@gerarcontrato` |
| `@calendario` | `@advbox` | `@personalizado` |
| `@removertag` | `@agendarretorno` | |

As duas últimas não existem no LiderHub e resolvem limitações que a auditoria
aponta como sem solução por lá: **remover** etiqueta que deixou de valer (antes
só era possível adicionar) e marcar um retorno **na hora que o cliente
combinou**, "me chama depois das 18h", em vez de depender só da cadência fixa
do status.

O sistema lê o prompt, resolve cada menção contra o que existe no workspace e
monta **só as ferramentas que aquele agente realmente usa**, um agente de
triagem não recebe a ferramenta de contrato. Menção que não existe aparece em
**vermelho** na tela do agente: menção quebrada faz o agente agir de um jeito
que ninguém consegue explicar depois.

Cinco agentes já vêm prontos e editáveis: Recepção, Triagem BPC/LOAS, Triagem
Incapacidade, Proposta e Contrato, e Pós-venda.

**Sem chave de IA cadastrada, tudo continua funcionando**: os agentes rodam
pelo *roteiro por regras*, seguem o prompt numerado, uma etapa por resposta.
Não entendem contexto, mas mantêm o funil de pé e mostram o fluxo inteiro.

Com chave da Anthropic ou da OpenAI (Configurações › Integrações), passam a
conversar de verdade e a chamar as ferramentas sozinhos.

### O agente lê as fotos

No previdenciário o cliente fotografa laudo, CNIS e carteira de trabalho em vez
de digitar. O agente enxerga essas imagens e usa o que está escrito nelas, em
vez de perguntar de novo o que já está na tela. Vão as três últimas fotos da
conversa, para não estourar custo em atendimento longo, e ele é instruído a
pedir uma foto melhor do campo específico quando algo estiver ilegível, nunca
a chutar.

Depende de chave de IA. Sem ela, a foto é guardada e aparece na conversa, mas
ninguém a lê automaticamente.

### Áudio, nas duas direções

Muita gente que procura o escritório manda áudio em vez de digitar, idoso,
pessoa com pouca escolaridade, quem está no trabalho. Sem transcrição, o agente
simplesmente não entende o lead.

- **Entrada:** o áudio recebido é baixado, guardado e **transcrito**. O agente
  passa a ler o que o cliente falou, e a equipe vê o texto no histórico sem
  precisar abrir cada áudio.
- **Saída:** com o modo áudio ligado na conversa, a resposta vai **falada**, na
  voz escolhida para aquele agente, e o texto vai junto, para a equipe
  conseguir ler depois.
- **Vozes** em Configurações › Vozes: seis vozes base, com ajuste de nome e
  velocidade (a mais lenta ajuda muito no atendimento a idoso). Dá para ouvir
  antes de escolher.

Depende da chave da OpenAI, a mesma para transcrever e para falar. Use áudio em
momentos decisivos, não como padrão: um minuto gerado custa cerca de 120
créditos, contra 9 de uma resposta em texto.

### Follow-up

A sequência mora **dentro de cada status**. Quando a conversa entra no status,
a sequência começa. Se o lead responde, ela é **reagendada** a partir da
resposta. Se o status muda, ela é **cancelada**. No último passo dá para
**desistir do lead**: troca o status, tira o responsável e arquiva.

Duas travas de segurança, de propósito:

- **Ação em massa não dispara follow-up.**
- **Importação de planilha não dispara follow-up.**

Sem isso, uma planilha inteira caindo na fila de envio derruba o número.

### Central de agendamentos

Mostra tudo o que ainda vai sair, com **indicador de saúde por dia**
(🟢 saudável / 🟡 risco / 🔴 crítico), distribuição por horário e reagendamento
em massa com intervalo entre mensagens e projeção de risco em tempo real.

Fora do horário comercial, o follow-up é adiado para o próximo dia útil **com o
minuto sorteado**, assim a fila não sai toda junta às 9h.

### Dashboard

Cards por etapa do funil, conversão com referência de mercado ao lado e
comparação **Evento × Cohort**.

O gráfico de evolução tem **dois modos**: *Por período*, que mostra a contagem
de cada etapa, e *Conversões*, que mostra o percentual sobre as novas conversas
daquele período, é o que separa "o funil piorou" de "entrou menos gente".

Abaixo, o **diagrama da origem ao desfecho**: cada faixa liga um anúncio ao que
ele virou (contrato, proposta, qualificado ou perda), com espessura proporcional
ao volume. É o gráfico que responde à pergunta que interessa, qual criativo
gera contrato, e não só conversa.

Fecha com o consumo de processamento por conversa.

### Integrações

- **ZapSign**, sincroniza modelos, gera o contrato preenchido com os dados que
  o agente coletou e manda o link. Regras de pós-assinatura: novo status, novo
  responsável, mensagem de sucesso. Sem chave, gera um contrato interno para
  testar o fluxo comercial de ponta a ponta.
- **Agenda**, funciona sozinha com as regras de disponibilidade. Com as
  credenciais do Google, cria o evento lá também, com link do Meet.
- **Andamento processual**, chave e endereço configuráveis (ADVBox ou o
  sistema do escritório). Você escreve o que cada fase significa, e a IA explica
  ao cliente em português comum.
- **Meta. API de Conversão**, devolve para a Meta o evento de contrato
  assinado. Sem isso, a campanha otimiza por "conversa iniciada", que é barata e
  não paga a conta; com isso, ela passa a buscar quem fecha, e o custo por
  contrato cai sem mexer no orçamento. Sai apenas o identificador do clique no
  anúncio e o telefone com hash, nome, CPF e conteúdo de conversa não saem.
  A auditoria registra que o LiderHub não tem isso nativamente.
- **Chamadas personalizadas**, ligam os agentes a qualquer coisa que fale HTTP
  (n8n, Make, Zapier, rota própria). Cada chamada vira uma menção nova. Em toda
  execução vai junto o **CTWA Clid**, o rastro do anúncio da Meta.

### API pública

Endereço base `http://localhost:4477`, autenticação pelo cabeçalho
`x-company-key`, limite de 3 requisições por segundo.

```
GET    /v1/contacts            POST  /v1/contacts
GET    /v1/message             POST  /v1/send/message
GET    /v1/templates           POST  /v1/send/template
GET    /v1/connections         GET   /v1/agents
PATCH  /v1/settings/status     PATCH /v1/settings/tags
```

Gere a chave em **Configurações › API e chaves**. Ela aparece uma vez só.

### Permissões

Três papéis, **Administrador**, **Gerente**, **Suporte**, com acesso filtrado
por departamento e por conexão. Duas exceções valem acima de qualquer
restrição: quem é **responsável** pela conversa sempre a enxerga, e quem for
**mencionado em nota interna** ganha acesso por 24 horas.

Tem também o **modo foco**: o vendedor só enxerga o que é dele.

---

## Como operar no dia a dia

O que segue não está escrito na tela, de propósito. É instrução de uso: você lê
uma vez, na primeira semana, e depois só precisa do espaço para trabalhar. Quem
fica com o sistema aberto oito horas por dia não deve ter que rolar por cima de
um manual para chegar na primeira conversa.

Dentro do sistema, o conceito continua a um passo de distância: o ícone de ajuda
ao lado do título de cada seção abre a explicação no passar do mouse ou pelo Tab,
e fecha no Esc.

### Toda segunda-feira: conferir a fila de envios

Abra **Agendamentos**. A faixa no alto traz um cartão por dia, com o total que já
está marcado para sair e um ponto colorido de saúde: 🟢 saudável, 🟡 risco,
🔴 crítico.

**Dia crítico não se resolve sozinho, e não aparece no Atendimento.** As
mensagens simplesmente começam a falhar, ou pior, a Meta rebaixa a qualidade do
número e leva junto todas as campanhas ligadas nele. Por isso essa conferência é
semanal e não "quando sobrar tempo".

O que fazer, nesta ordem:

1. **Clique no dia** para ver a distribuição ao longo das 24 horas. Fila
   empilhada num horário só é mais arriscada que o mesmo volume espalhado.
2. **Reagende em massa.** O campo de intervalo entre mensagens tem 30 segundos
   como mínimo seguro, e a projeção de saúde muda enquanto você digita: dá para
   parar de ajustar assim que o selo sai do vermelho.
3. Se o volume vem sempre do mesmo status, o problema não é o dia, é a
   **cadência daquele status**. Alongue o intervalo entre os passos em
   **Configurações › Status e follow-up**, senão o mesmo dia crítico volta na
   semana que vem. Sequência longa rende menos, queima o número e aumenta
   denúncia.

Dia em 🟡 risco pode esperar, com uma ressalva: confira se ele não é véspera de
feriado. Fora do horário comercial o follow-up é adiado para o próximo dia útil,
então três dias parados caem todos no mesmo lugar.

### Saúde por conexão: o pior número, nunca a soma

A saúde é medida **por conexão, uma de cada vez**, porque o limite de quem
manda muita mensagem é do número, não do escritório. O indicador do dia mostra o
**pior número daquele dia**, e não a soma dos números.

Duas conexões com 40 envios cada aparecem como **40**, e não como 80: as duas
estão confortáveis, e somar daria um alarme falso. Na direção contrária, uma
conexão com 300 envios ao lado de outra com 5 aparece como **300**. A média
seria 152, um número que não existe em lugar nenhum e que esconderia justamente
a conexão prestes a cair.

As faixas, por conexão e por dia:

| Envios no dia | Indicador |
| --- | --- |
| até 40 | 🟢 saudável |
| de 41 a 80 | 🟡 risco |
| acima de 80 | 🔴 crítico |

É por isso que reagendar não é só empurrar para frente. Dividir a fila entre dois
números resolve o dia sem tirar nenhuma mensagem da semana, e é a primeira coisa
a tentar antes de adiar contato com lead quente.

### Testar um agente com `/restart`, no simulador

Toda mudança de prompt se testa no **Simulador**, que é um WhatsApp de mentira do
lado do lead. O ciclo é sempre o mesmo, e a ordem importa:

1. **Mande `/restart`.** Zera a conversa, apaga as variáveis e devolve o lead ao
   agente padrão da conexão. Sem esse passo você está testando a partir do meio
   de uma conversa que já aconteceu, e o agente responde levando em conta um
   contexto que o lead de verdade não teria.
2. **Escreva a palavra-chave na primeira mensagem.** Palavra-chave de agente só
   ativa na primeira mensagem da conversa. Da segunda em diante ela é texto
   comum, e quem atende é o agente padrão da conexão. É a causa mais frequente
   de "o agente novo não respondeu".
3. **Espere o delay.** O agente agrupa mensagens antes de responder, 15 segundos
   por padrão, e **cada nova mensagem sua reinicia a contagem**. Os pontinhos de
   "escrevendo" aparecem durante essa espera. Se você mandar mais uma linha,
   começa tudo de novo.
4. **Confira o efeito, no Atendimento.** O teste não é a resposta bonita, é o que
   ela mudou: status, departamento, etiqueta, responsável e as variáveis do
   contato, no painel da direita. **Ver logs da conversa** lista cada menção que
   o agente acionou, com hora e resultado. Menção que aparece em vermelho na tela
   do agente não fez nada, e o prompt precisa ser corrigido antes de o teste
   valer alguma coisa.

O mesmo `/restart` existe dentro do Atendimento, no botão de reiniciar do
cabeçalho da conversa. Ali ele apaga o histórico daquela conversa de verdade,
então use em conversa de teste, nunca na de um cliente.

### Duas coisas que confundem no começo

- **Mensagem agendada não é follow-up.** A agendada sai no horário marcado e
  continua saindo mesmo que o status mude; o follow-up é cancelado quando o
  status muda. Se o cliente fechou contrato e havia uma agendada para amanhã,
  cancele na mão, em Agendamentos.
- **Unificar conversas** é para o cliente que escreveu de dois números, ou para o
  chat que o WhatsApp duplicou. O histórico inteiro vai para a conversa escolhida
  e a outra deixa de existir. Não tem volta, então confira o destino antes de
  confirmar. Para só tirar da fila, o certo é **Arquivar**.

---

## O que ainda não existe

Digo aqui para não haver surpresa:

- **Clonagem de voz.** As vozes disponíveis são as do catálogo, não há
  treinamento com a voz de alguém do escritório.
- **Gerenciamento de grupos** do WhatsApp (a aba existe, o gerenciamento não).
  Vale dizer: na API Oficial da Meta, grupo não funciona de jeito nenhum.
- **OAuth do Google em um clique**, as credenciais são coladas na mão.
- **Aplicativo de celular.**

---

## Pos-venda

Tela separada do Dashboard, no menu lateral. O funil comercial responde "quantos
fecharam"; depois do contrato assinado a pergunta muda, e por isso esta tela nao
e um segundo funil: **o que esta parado e o que vence**.

Um caso parado nao aparece em contagem nenhuma. Ele simplesmente nao se mexe:
some da caixa de entrada, some do funil, e reaparece no dia em que o cliente
liga perguntando.

- **O caso entra quando assina**, pelo log de status do tipo Sucesso, e nao
  quando alguem lembra de arrastar a conversa para outro departamento.
- **O tempo conta do ultimo movimento de etapa**, nao da ultima mensagem:
  conversa que troca "bom dia" toda semana sem sair do lugar continua parada, e
  e justamente essa que engana quem olha so a caixa de entrada.
- **Nao existe limite fixo de "parado".** Documentacao pendente ha 20 dias e
  problema; Processo em andamento ha 120 dias e o ritmo normal do INSS. Quem
  escolhe o corte e o escritorio, no seletor do topo (7, 15, 30, 60 ou 90 dias),
  e a barra de idade mostra a distribuicao inteira para a escolha ser informada.

---

## Servidor MCP (usar o sistema pelo Claude)

Dá para conversar com o atendimento pelo Claude Desktop, Claude Code ou Cursor:
"quantos leads de BPC entraram esta semana", "me mostra as conversas paradas em
Proposta", "manda a mensagem de documentos pendentes para a dona Maria".

**1. Gere uma chave de API** em Integrações → Chaves de API. Copie na hora: ela
só aparece uma vez.

**2. Aponte o cliente para o servidor.** No Claude Desktop, edite
`%APPDATA%Claudeclaude_desktop_config.json`:

```json
{
  "mcpServers": {
    "correiatendimentos": {
      "command": "node",
      "args": ["C:\Users\SEU-USUARIO\Desktop\Correiatendimentos\servidor\mcp\index.js"],
      "env": {
        "CORREIA_URL": "http://localhost:4477",
        "CORREIA_CHAVE": "chk_cole_aqui_a_sua_chave"
      }
    }
  }
}
```

No Claude Code, o mesmo com `claude mcp add`. Em qualquer cliente, o
Correiatendimentos precisa estar **aberto**: o servidor MCP conversa com ele.

**As 14 ferramentas:** `list_connections`, `get_connection`,
`query_contacts`, `get_contact`, `mark_contact_read`, `list_messages`,
`get_message`, `send_message`, `list_status`, `list_sources`,
`list_tags`, `list_departments`, `list_users`, `list_agents`.

**Duas coisas que valem saber.** A chave é de um workspace só, e o servidor MCP
passa pela mesma API pública que qualquer integração usa — ele não lê os
arquivos direto, então não enxerga nada além do que a chave permite. E
`send_message` **manda mensagem de verdade** no WhatsApp do cliente: o Claude
vai pedir confirmação, mas confira o número antes de aprovar.

---

## Sobre a interface

A tela foi passada por uma auditoria de design em 20/08/2026. O que mudou e por que:

- **Ícones do Phosphor** (licença MIT), vendorizados em `web/js/icones.js`. Antes
  eram desenhos meus, feitos à mão, que saíam tortos na comparação lado a lado.
  Continua sem dependência: os arquivos originais moram no projeto.
- **Contraste corrigido.** Três tons de texto reprovavam no WCAG AA (3,3:1 onde o
  mínimo é 4,5:1). Eram justamente os usados em horário, texto de ajuda e
  descrição. Agora todos passam.
- **Rótulos em caixa normal.** Formulário com tudo em CAIXA ALTA e espaçamento de
  letra faz cada campo gritar; numa tela com dezenas de campos, cansa a leitura.
- **Uma escala de forma só:** 6px em campo e selo, 10px em botão e item, 14px em
  cartão e modal, pílula em etiqueta, círculo em avatar. Antes eram onze valores
  soltos.
- **Números de largura fixa** nos painéis, para a coluna de valores não balançar a
  cada atualização.
- **Esqueleto de carregamento** com a forma da tela que vem, no lugar de um
  "Carregando" centralizado que não diz nada e ainda faz a página saltar.
- **"O agente está escrevendo"** aparece durante o delay de agrupamento. Sem esse
  sinal, o atendente achava que travou e assumia a conversa no meio do raciocínio.
- **Movimento com motivo.** Só três: mensagem que entra, pontinhos do agente,
  resposta ao clique. Tudo desligado para quem pede menos movimento no sistema.
- **Tema segue o sistema operacional** na primeira visita. Quem trabalha em sala
  clara não recebe mais uma tela preta só porque a marca do escritório é preta.

---

## Onde ficam os dados

Tudo em **`dados/`**, dentro da própria pasta do sistema:

```
dados/
  workspaces.json, contatos.json, status.json, agentes.json, …
  mensagens/<id-da-conversa>.json     uma conversa por arquivo
  midia/<id>-<nome-do-arquivo>        imagem, vídeo, áudio e PDF
```

Backup é copiar essa pasta. Nada sai do computador do escritório, exceto o que
você mesmo ligar: WhatsApp da Meta, IA, ZapSign, Google e as chamadas
personalizadas.

Para começar do zero, feche o sistema e apague a pasta `dados/`.

---

## Estrutura do código

```
servidor/
  index.js              servidor HTTP e roteador
  config.js             porta, custos e catálogo de modelos
  nucleo/               banco em arquivo, sessão, permissões, eventos, dados iniciais
  rotas/                sessão, atendimento, tarefas, automações, conexões, painel, integrações, API pública
  ia/                   motor do agente, menções, provedores, resumo
  whatsapp/             envio, recebimento, templates da Meta
  automacao/            follow-up, agendador e horário comercial
  integracoes/          ZapSign, agenda, andamento processual, chamadas personalizadas
web/
  index.html, css/tema.css, js/  interface, sem build
```

---

*Correia Advogados Associados.*
