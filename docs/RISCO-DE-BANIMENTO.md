# Risco de banimento do número

Um lojista implementou num WhatsApp comum, celular Android, e o número foi banido
logo depois de conectar. Não foi azar.

## Por que acontece

O WhatsApp não autoriza esse tipo de automação. A Evolution API roda em cima do
**Baileys**, que se conecta como se fosse um WhatsApp Web — e a Meta endureceu a
fiscalização contra APIs não oficiais a partir de **janeiro de 2026**.

Não é bug, é postura da plataforma. **Não existe configuração que deixe um número
imune.** O que existe é um perfil de número que quase nunca é banido e outro que
é banido em dias.

O que a Meta consegue enxergar:

- número recém-registrado que começa a mandar mensagem automatizada;
- o mesmo número conectado por QR em mais de um servidor;
- mensagens para pessoas que não têm o número salvo;
- velocidade de denúncia — quantos bloquearam ou denunciaram;
- a assinatura do próprio Baileys, que é reconhecível.

O caso do lojista juntou três desses de uma vez.

## O que fizemos

### No painel — checklist antes do QR

A etapa do WhatsApp agora exige quatro confirmações antes de liberar o botão.
São exatamente os quatro fatores que separam um número seguro de um número que
some em dias:

1. **Não é um chip novo.** Já é usado há semanas, com conversa de verdade.
2. **Não é o WhatsApp pessoal de ninguém.** Se o pior acontecer, a loja perde um
   número de trabalho, não o contato da família de alguém.
3. **Não está ligado em nenhum outro sistema.** Nenhum outro painel, robô ou
   disparador no mesmo número.
4. **A loja não vai disparar em massa.** A Júlia só responde quem escreve
   primeiro.

O aviso é honesto, não é letra miúda: número banido não volta.

A confirmação fica gravada em `stores.whatsapp_checklist_em`.

### Na Evolution — dois ajustes

- **`groupsIgnore: true`** — grupo e lista de transmissão não entram mais. Além
  de risco, era o que derrubava execução com propaganda de tênis.
- **`readMessages: true`** — marcar como lida é o comportamento de quem está
  realmente lendo.

Deixamos `alwaysOnline` desligado de propósito: um número online 24 horas por dia
é sinal de robô, não de gente.

### No painel — parar de confundir ban com celular sem bateria

Antes, um número banido aparecia como "fora do ar" — igualzinho a um celular
descarregado. O lojista ficava tentando reconectar sem saber que não ia voltar.

A escala agora é:

| quedas seguidas | tempo | o que acontece |
|---|---|---|
| 3 | ~15 min | alerta — "fora do ar" |
| 8 | ~40 min | para de tentar reconectar sozinho |
| 12 | ~1 hora | **"provável banimento"** |

É "provável" de propósito: pode ser celular desligado a noite toda. Por isso a
mensagem manda o lojista abrir o WhatsApp no celular da loja, que é onde dá para
distinguir — se pedir o número de novo, foi ban, e ler o QR outra vez não
resolve.

## O que isso não resolve

Reduz bastante. **Não elimina.** Enquanto a conexão for por QR Code, o risco
existe e pode voltar a acontecer.

A única forma de eliminar seria a **Cloud API oficial da Meta** — que a Evolution
já suporta (`integration: WHATSAPP-BUSINESS`), mantendo Chatwoot, n8n e a Júlia
exatamente como estão. Responder cliente dentro de 24h é gratuito nela, que é
justamente o que a Júlia faz.

Decisão do dono do produto: **não usar a API oficial da Meta.** Registrado aqui
para que a escolha e o motivo do risco fiquem no mesmo lugar — se um dia
reabrirem essa porta, a troca é de conexão, não de arquitetura.
