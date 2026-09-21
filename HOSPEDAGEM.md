# Hospedar o CorreiaAtilhus2.0 numa VPS

Este guia leva o sistema do notebook para um servidor na internet, com HTTPS, o WhatsApp por QR Code e cópia de segurança diária. Tudo roda em Docker: o sistema, a Evolution API, o banco dela e o Caddy, que cuida do certificado.

Os arquivos estão na pasta `hospedagem/` e no `Dockerfile` da raiz.

---

## 1. O que contratar

| Item | Recomendação |
| --- | --- |
| VPS | Ubuntu 24.04, **2 vCPU, 4 GB de RAM, 40 GB de disco** ou mais (ex.: Hostinger KVM 2, DigitalOcean, Contabo) |
| Domínio | Um endereço seu, ex.: `atendimento.correiaadvogados.com.br` |

Hospedagem de site comum (cPanel) **não serve**: não roda Node o tempo todo nem Docker.

## 2. Apontar o domínio

No painel do domínio, crie um registro **A** com o nome escolhido (ex.: `atendimento`) apontando para o **IP da VPS**. Espere propagar (de minutos a algumas horas). Sem isso o HTTPS não sai.

## 3. Preparar a VPS

Entre por SSH (`ssh root@IP_DA_VPS`) e rode:

```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 4. Baixar o sistema

```bash
cd /root
git clone https://github.com/gilbertocorreiaadvocacia-svg/CorreiaAtilhus2.0.git
cd CorreiaAtilhus2.0/hospedagem
cp .env.exemplo .env
openssl rand -hex 20   # rode duas vezes: um valor para cada chave abaixo
nano .env
```

Preencha no `.env`:

- `DOMINIO` e `EMAIL_HTTPS`;
- `CORREIA_ADMIN_SENHA`: a senha do administrador, com **12 caracteres ou mais**;
- `AUTHENTICATION_API_KEY` e `POSTGRES_SENHA`: os dois valores gerados pelo `openssl`.

Se o repositório virar privado, o `git clone` passa a pedir acesso: use uma chave de implantação (Deploy key) do GitHub.

## 5. Subir

```bash
docker compose up -d --build
docker compose logs -f sistema
```

Quando aparecer `CORREIAATILHUS2.0`, abra `https://SEU_DOMINIO` e entre com o e-mail do administrador e a senha do `.env`.

> O sistema **não sobe** se alguém ainda tiver a senha padrão. O log diz quem é. Isso é de propósito: a senha padrão está no README público.

## 6. Trazer os dados do notebook

Faça isso **uma vez**, quando for trocar de vez para o servidor.

1. No notebook, **pare o sistema** (feche o servidor; se ele sobe sozinho com o Windows, rode `windows\desinstalar-inicio.cmd` antes).
2. Rode `windows\empacotar-para-hospedagem.cmd`. Ele gera `dados-para-hospedagem.tar.gz` na pasta do projeto.
   **Esse arquivo tem dados de clientes:** não mande por e-mail nem suba no GitHub.
3. Mande para a VPS, do PowerShell do notebook:
   ```powershell
   scp .\dados-para-hospedagem.tar.gz root@IP_DA_VPS:/root/
   ```
4. Na VPS:
   ```bash
   cd /root/CorreiaAtilhus2.0
   sh hospedagem/importar-dados.sh /root/dados-para-hospedagem.tar.gz
   rm /root/dados-para-hospedagem.tar.gz
   ```

A importação guarda antes uma cópia do que estava no servidor em `/root/copias-correia/antes-da-importacao`.

Os números de WhatsApp trazidos do notebook passam a apontar sozinhos para a Evolution do servidor, na primeira vez que forem abertos em **Conexões**.

## 7. Conectar o WhatsApp

A sessão do WhatsApp ficava na Evolution do notebook e **não vem junto**.

1. No celular, em **Aparelhos conectados**, desconecte a sessão antiga do notebook.
2. No sistema hospedado, abra **Conexões**, escolha o número e clique em **Conectar**. Leia o novo QR Code.

Nunca deixe o notebook e o servidor ligados no mesmo número ao mesmo tempo.

## 8. Endereços para as integrações

| Integração | Endereço |
| --- | --- |
| Webhook da ZapSign | `https://SEU_DOMINIO/v1/zapsign/webhook` |
| Webhook da Meta (API oficial) | `https://SEU_DOMINIO/webhook/ID_DA_CONEXAO` (o ID aparece em Conexões) |
| Webhook do Instagram (Direct) | `https://SEU_DOMINIO/webhook/instagram` |
| Webhook do TikTok (DM) | `https://SEU_DOMINIO/webhook/tiktok` (o sistema cadastra sozinho) |
| Retorno do login do TikTok | `https://SEU_DOMINIO/tiktok/retorno` |

Passo a passo do Instagram e do TikTok: `INSTAGRAM-TIKTOK.md`.

## 9. Cópia de segurança diária

```bash
crontab -e
```

Acrescente a linha (todo dia às 3h):

```
0 3 * * * sh /root/CorreiaAtilhus2.0/hospedagem/backup.sh >> /root/copias-correia/backup.log 2>&1
```

As 14 cópias mais recentes ficam em `/root/copias-correia`. **Baixe uma de vez em quando para fora da VPS**, por exemplo:

```powershell
scp root@IP_DA_VPS:/root/copias-correia/dados-AAAA-MM-DD_HHMMSS.tar.gz .
```

Para voltar uma cópia: `sh hospedagem/importar-dados.sh /root/copias-correia/ARQUIVO.tar.gz`.

## 10. Atualizar o sistema

```bash
cd /root/CorreiaAtilhus2.0
git pull
cd hospedagem && docker compose up -d --build
```

Os dados ficam nos volumes do Docker e não se perdem na atualização. Só `docker compose down -v` apaga volumes: **não use `-v`**.

---

## Se a VPS já tem o EasyPanel

Quando a VPS já roda outro sistema pelo EasyPanel, **não reinstale nada**. O CorreiaAtilhus2.0 entra como um projeto novo, ao lado dos outros, e o EasyPanel cuida do HTTPS. As partes 3 a 7 acima não valem nesse caso: o `docker-compose.yml` disputaria as portas 80 e 443 com o EasyPanel.

São três serviços num projeto chamado `correia`. Dentro do projeto, cada um acha o outro pelo nome `correia_<serviço>`.

1. **Crie o projeto.** No EasyPanel, clique em **Create Project** e dê o nome `correia`.
2. **Crie o banco da Evolution.** Clique em **+ Service > Postgres**, dê o nome `banco` e crie. Em **Credentials**, copie a **Internal Connection URL**.
3. **Crie a Evolution (o WhatsApp por QR Code).** Clique em **+ Service > App** e dê o nome `evolution`.
   - **Source > Docker Image:** `evoapicloud/evolution-api:v2.3.7`
   - **Environment:** troque `CHAVE` por uma chave inventada (`openssl rand -hex 20`) e `URL_DO_BANCO` pela URL do passo 2.
     ```
     AUTHENTICATION_API_KEY=CHAVE
     DATABASE_PROVIDER=postgresql
     DATABASE_CONNECTION_URI=URL_DO_BANCO?schema=evolution_api
     DATABASE_URL=URL_DO_BANCO?schema=evolution_api
     DATABASE_CONNECTION_CLIENT_NAME=evolution_exchange
     CACHE_REDIS_ENABLED=false
     CACHE_LOCAL_ENABLED=true
     CONFIG_SESSION_PHONE_CLIENT=Correia Advogados
     CONFIG_SESSION_PHONE_NAME=Chrome
     SERVER_URL=http://correia_evolution:8080
     TZ=America/Sao_Paulo
     ```
   - **Mounts:** um **Volume** com o nome `instancias` no caminho `/evolution/instances`. É o que mantém o WhatsApp conectado quando a Evolution reinicia.
   - **Domains:** apague o domínio que vier pronto. A Evolution não precisa aparecer na internet.
   - Clique em **Deploy**.
4. **Crie o sistema.** Clique em **+ Service > App** e dê o nome `sistema`.
   - **Source > Git:** `https://github.com/gilbertocorreiaadvocacia-svg/CorreiaAtilhus2.0.git`, ramo `main`.
   - **Build:** **Dockerfile**, arquivo `Dockerfile`.
   - **Environment:** use a MESMA chave do passo 3 e uma senha de administrador com 12 caracteres ou mais.
     ```
     CORREIA_HOSPEDADO=1
     CORREIA_ADMIN_EMAIL=seu-email-de-login
     CORREIA_ADMIN_SENHA=senha-com-12-ou-mais
     CORREIA_EVOLUTION_URL=http://correia_evolution:8080
     CORREIA_EVOLUTION_CHAVE=CHAVE
     CORREIA_EVOLUTION_WEBHOOK=http://correia_sistema:4477
     CORREIA_ENDERECO_PUBLICO=https://ENDERECO-DO-PASSO-SEGUINTE
     ```
   - **Mounts:** um **Volume** com o nome `dados` no caminho `/dados`. Ali ficam conversas, contatos e mídias.
   - **Domains:** fique com o domínio que o EasyPanel cria (`...easypanel.host`) ou ponha um seu. A **porta** é **4477**. Copie o endereço com `https://` para o `CORREIA_ENDERECO_PUBLICO`.
   - Clique em **Deploy** e acompanhe em **Logs**. Quando aparecer `CORREIAATILHUS2.0`, abra o endereço.

### Trazer os dados do notebook, no EasyPanel

1. Gere o pacote no notebook e mande para a VPS, como na parte 6 acima (`scp ... root@IP_DA_VPS:/root/`).
2. No EasyPanel, pare o serviço `sistema` (**Stop**).
3. No terminal da VPS (no hPanel, **Console da Web**), rode:
   ```bash
   DADOS=/etc/easypanel/projects/correia/sistema/volumes/dados
   ls "$DADOS"    # confira que a pasta existe antes de seguir
   tar czf /root/antes-da-importacao.tar.gz -C "$DADOS" .
   find "$DADOS" -mindepth 1 -delete && tar xzf /root/dados-para-hospedagem.tar.gz -C "$DADOS" && chown -R 1000:1000 "$DADOS"
   rm /root/dados-para-hospedagem.tar.gz
   ```
4. Ligue o serviço de novo (**Start**) e conecte o WhatsApp, como na parte 7.

### Cópia de segurança diária, no EasyPanel

No `crontab -e` da VPS:

```
0 3 * * * mkdir -p /root/copias-correia && tar czf /root/copias-correia/dados-$(date +\%F).tar.gz -C /etc/easypanel/projects/correia/sistema/volumes/dados . && ls -1t /root/copias-correia/dados-*.tar.gz | tail -n +15 | xargs -r rm --
```

Para atualizar o sistema, clique em **Deploy** no serviço `sistema`. Os dados ficam no volume e não se perdem.

---

## Segurança, em uma lista

- O `.env` da VPS tem as chaves: nunca vai para o GitHub.
- Só as portas 22, 80 e 443 ficam abertas. O banco e a Evolution não aparecem na internet.
- Hospedado, o login é a porta de entrada: troque as senhas da equipe por senhas fortes e não compartilhe contas.
- O repositório é público. Avalie deixá-lo privado antes de ir para produção.
- Guarde cópias fora da VPS.
