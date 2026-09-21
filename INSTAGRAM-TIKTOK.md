# Instagram e TikTok no CorreiaAtilhus2.0

O Direct do Instagram e as DMs do TikTok chegam na tela de **Conversas**, junto com o WhatsApp, e os agentes de IA respondem por lá. Os leads que vêm de anúncio nas duas redes ficam marcados como **tráfego pago**, e o contrato fechado volta para o TikTok medir a campanha.

As duas redes só entregam mensagem num endereço público com HTTPS. **Antes de tudo, o sistema precisa estar hospedado** (veja o `HOSPEDAGEM.md`). No notebook, a tela avisa que falta isso.

Nos exemplos abaixo, `SEU_DOMINIO` é o endereço do sistema, por exemplo `atendimento.correiaadvogados.com.br`.

---

## Instagram (Direct)

### O que precisa existir

- Conta do Instagram **profissional** (Comercial ou Criador de conteúdo).
- Um app na Meta, criado por você em [developers.facebook.com](https://developers.facebook.com).

### Passo a passo

1. **Crie o app.** Em developers.facebook.com, abra **Meus apps > Criar app** e escolha o caso de uso de gerenciar mensagens do Instagram. No painel do app, adicione o produto **Instagram > API com login do Instagram**.
2. **Autorize as mensagens no celular.** No app do Instagram, abra **Configurações > Mensagens e respostas a stories > Ferramentas conectadas** e deixe o acesso às mensagens **ligado**.
3. **Gere o token.** No painel do app, em **Gerar tokens de acesso**, adicione a conta do escritório e clique em **Gerar token**.
4. **Crie a conexão no sistema.** Abra **Conexões > Nova conexão > Instagram**. Preencha:
   - **Token de acesso:** o token do passo 3.
   - **Chave secreta do app do Instagram:** fica na mesma tela do painel.
   - **Chave secreta do app:** fica em **Configurações do app > Básico**. Preencha as duas: a Meta assina as mensagens com uma delas, e o sistema aceita qualquer uma. Se a mensagem for recusada, a trilha da conexão avisa.
5. **Configure o webhook.** No painel do app, em **Webhooks**, preencha:
   - **URL de retorno:** `https://SEU_DOMINIO/webhook/instagram`
   - **Verificar token:** o **Token de verificação** que aparece na conexão, no sistema.
   - Assine os campos `messages`, `messaging_postbacks`, `messaging_seen` e `messaging_referral`.
6. **Teste a conexão.** No sistema, abra o menu da conexão e clique em **Testar conexão**. Ele confere a conta, mostra o @ e liga a entrega das mensagens dessa conta.
7. **Peça a Análise do App.** Enquanto a Meta não aprova, o sistema só recebe mensagens de quem estiver cadastrado como **testador** do app. Peça as permissões `instagram_business_basic` e `instagram_business_manage_messages` com acesso avançado. A Meta pode pedir a verificação da empresa.

### Regras do Instagram

- **Janela de 24 horas.** Só dá para responder até 24 horas depois da última mensagem do cliente. Não existe template que fure essa janela, como no WhatsApp oficial. A tela avisa quando a janela fechou.
- **Só o cliente começa a conversa.**
- **Texto com até 1.000 caracteres por mensagem.** O sistema divide as respostas longas sozinho.
- **Anexos vão por link.** A Meta busca o arquivo no endereço do sistema.
- **O token dura 60 dias.** O sistema renova toda semana, sozinho.

---

## TikTok (DM)

### O que precisa existir

- Conta **comercial** do TikTok (Business Account), com as mensagens diretas abertas para todos: **Configurações > Privacidade > Mensagens diretas > Todos**.
- Um app no **TikTok API for Business**, com a **Business Messaging API** aprovada.
- O TikTok não libera essa API para contas registradas na União Europeia, na Suíça ou no Reino Unido.

### Passo a passo

1. **Crie o app.** Em [business-api.tiktok.com](https://business-api.tiktok.com), cadastre-se como desenvolvedor, crie o app e peça acesso à **Business Messaging API**. A aprovação costuma levar alguns dias.
2. **Configure o app.** No cadastro do app:
   - **Endereço de retorno (redirect URL):** `https://SEU_DOMINIO/tiktok/retorno`
   - **Permissões:** `user.info.basic`, `user.info.username`, `user.info.profile`, `user.account.type`, `message.list.read`, `message.list.send` e `message.list.manage`.
3. **Crie a conexão no sistema.** Abra **Conexões > Nova conexão > TikTok**, preencha o **App ID** e o **Secret do app** e salve.
4. **Entre com a conta.** No menu da conexão, clique em **Entrar com a conta do TikTok**. Faça login com a conta comercial do escritório e autorize. O TikTok devolve você para o sistema, com a conexão ligada.
5. **Cadastre o webhook.** No mesmo menu, clique em **Cadastrar webhook no TikTok**. O sistema registra `https://SEU_DOMINIO/webhook/tiktok` sozinho.

### Regras do TikTok

- **Janela de 48 horas** desde a última mensagem do cliente.
- **Só o cliente começa a conversa.** Até ele responder, a empresa pode mandar no máximo 10 mensagens.
- **Só passam texto e imagem.** Vídeo, áudio e PDF vão como link para o arquivo.
- **O login dura cerca de um dia.** O sistema renova antes de vencer. Se a conexão ficar parada tempo demais, entre com a conta de novo.

---

## Conversa sem telefone

Quem chega pelo Instagram ou pelo TikTok **não tem telefone**: a conversa aparece com o @ da pessoa. Para o contrato, a ZapSign e o Atilhus Juri, o agente precisa pedir o telefone e o CPF durante a conversa, como já faz com os outros dados.

---

## De onde veio o lead (tráfego pago)

| Canal | Como o sistema sabe |
| --- | --- |
| WhatsApp, por anúncio da Meta | Pela marca que o WhatsApp põe na mensagem (Instagram ou Facebook). |
| Direct, por anúncio de mensagem do Instagram | Pela marca do anúncio, com o título guardado na conversa. |
| Direct, sem anúncio | Origem **Instagram**. |
| DM do TikTok, por anúncio de mensagem | Pela frase inicial do anúncio (veja abaixo). |
| DM do TikTok, sem anúncio | Origem **TikTok**. |

O anúncio de mensagem do TikTok não deixa uma marca que dê para ler. Por isso, **escreva a mensagem inicial do anúncio com a expressão "anúncio no TikTok"**, por exemplo "Vi o anúncio no TikTok e quero saber mais". Assim, o lead cai em **Tráfego pago · TikTok**. Se quiser usar outra expressão, troque a palavra-chave em **Configurações > Classes > Origens**.

---

## Devolver o contrato fechado para a campanha

### TikTok

Configure em **Integrações > TikTok. API de Eventos**:

1. No Gerenciador de Eventos do TikTok, abra **Conectar fonte de dados > CRM**. Crie o conjunto de eventos e copie o **ID** e o **token**.
2. Diga qual etapa do funil vira qual evento. Por exemplo, Qualificado vira `QualifiedLead` e Sucesso vira `CompletePayment`.
3. Para testar sem contar na campanha, use o **código de teste** da aba "Testar eventos" e clique em **Testar**.

Só vão os leads que vieram do TikTok. O que sai é o telefone e o e-mail com hash, mais um código da conversa. Na DM do TikTok, o evento só sai depois que o agente coletar o telefone ou o e-mail.

### Meta

A devolução para a Meta já funciona para os leads do **WhatsApp** que vêm de anúncio (**Integrações > Meta. API de Conversão**). Para os anúncios do **Direct do Instagram**, a Meta ainda está liberando a API de Conversões de mensagens. Por enquanto, a medida desses anúncios é a de "conversas iniciadas" no Gerenciador de Anúncios.
