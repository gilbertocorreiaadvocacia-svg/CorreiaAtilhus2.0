# CorreiaAtilhus2.0

Plataforma de atendimento, agentes de IA e funil comercial no WhatsApp, feita
para o **Correia Advogados Associados** (direito previdenciário).

Preto e dourado, do escudo da marca. Roda no computador do escritório, sem
depender de serviço de fora.

> 📘 **O manual completo está em [LEIA-ME.md](LEIA-ME.md)** — como operar no dia
> a dia, o que cada tela faz, onde ficam os dados e o que ainda não existe.

---

## Como rodar

```bash
node servidor/index.js
```

No Windows, dois cliques em `INICIAR.bat` fazem o mesmo e já abrem o navegador.

Abre em `http://localhost:4477`. Primeiro acesso: `admin@correia.adv.br` /
`correia2026` — **troque a senha em Configurações › Membros assim que entrar.**

---

## Como conferir

```bash
npm test
```

Sobe o sistema numa pasta de dados **descartável** (nunca a `dados/` de
verdade), em porta sorteada, e conversa com ele por HTTP. Cobre a costura que
quebra de verdade neste projeto: conversa criada pelo evento da Meta, rastro do
anúncio guardado, eco do próprio envio descartado, grupo ignorado, chave do
webhook conferida e segredo preservado ao salvar. Junto vai um `node --check`
em todo arquivo `.js` — sem passo de build, erro de sintaxe num módulo do
navegador só apareceria na tela de quem abriu o sistema.

O caminho por QR Code é testado contra uma **Evolution API de mentira**
(`servidor/testes/evolution-falsa.js`), que responde as mesmas rotas no mesmo
formato. Isso prova que o driver monta o pedido certo e entende a resposta; não
prova que a Evolution de verdade responde assim — isso só a primeira conexão
real diz.

**Precisa só do Node.js 18+.** Nada de `npm install`: o projeto tem **zero
dependências**, roda com o `node:http` que já vem no Node, e o navegador carrega
módulos ES nativos sem passo de build.

---

## O que tem dentro

| Pasta | O que é |
| --- | --- |
| `servidor/` | HTTP, rotas, banco em arquivo, motor de IA, WhatsApp, integrações |
| `servidor/mcp/` | Servidor MCP: usar o sistema conversando pelo Claude |
| `web/` | Interface. Módulos ES nativos, sem framework e sem build |
| `dados/` | **Não versionado.** Criado sozinho na primeira execução |

Principais telas: Conversas (com Kanban e Contatos), Dashboard comercial,
Pós-venda, Agentes de IA, Base de conhecimento, Templates, Central de
agendamentos, Tarefas, Simulador de WhatsApp e Configurações.

---

## Os dados não estão aqui, e é de propósito

A pasta `dados/` guarda conversa de cliente, telefone, CPF e as chaves da API do
WhatsApp do escritório. Ela está no `.gitignore` e **não deve entrar no
repositório em hipótese nenhuma**: commitada uma vez, fica no histórico para
sempre — apagar o arquivo depois não tira do git.

Não faz falta. Na primeira vez que sobe, o sistema semeia a base sozinho, com o
escritório, os status do funil, os departamentos, os agentes e os templates
prontos para usar.

---

## Um aviso antes de hospedar

Hoje o sistema é feito para rodar em `localhost`, na máquina do escritório. Se
um dia for para a internet, três coisas precisam mudar antes:

1. **A senha padrão** deste README passa a ser conhecida por qualquer um.
2. **HTTPS obrigatório** — hoje a sessão anda em cookie sem TLS.
3. **A pasta `dados/`** precisa de backup e de cifragem em repouso: é dado
   sensível de cliente, protegido pela LGPD e pelo sigilo profissional.

---

Feito por **GS STACK**.
