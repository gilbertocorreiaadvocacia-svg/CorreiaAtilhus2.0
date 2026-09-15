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

## Segurança, em uma lista

- O `.env` da VPS tem as chaves: nunca vai para o GitHub.
- Só as portas 22, 80 e 443 ficam abertas. O banco e a Evolution não aparecem na internet.
- Hospedado, o login é a porta de entrada: troque as senhas da equipe por senhas fortes e não compartilhe contas.
- O repositório é público. Avalie deixá-lo privado antes de ir para produção.
- Guarde cópias fora da VPS.
