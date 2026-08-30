# Fotos não apareciam no Android

## O sintoma

A Júlia mandava as fotos do carro e elas apareciam normalmente no **iPhone** e no
**WhatsApp Web**. No **Android**, nada — a bolha da foto simplesmente não chegava.
Parecia que ela tinha parado de responder no meio da conversa.

Nenhuma execução do n8n dava erro. Todas terminavam em `success`.

## A causa

O nó **`Nomear foto`** carimbava `image/webp` em **toda** foto, fosse ela o que
fosse. Os arquivos são JPEG: o painel sobe a foto para o Supabase Storage com o
`content-type` real do arquivo escolhido pelo lojista
(`src/screens/inventory/useCars.ts`), e o Supabase devolve `image/jpeg`.

Dava para ver os dois na mesma execução do n8n: `image/jpeg` vindo do download e
`image/webp` saindo para o Chatwoot.

Por que só o Android quebrava:

- **iPhone e WhatsApp Web** farejam os bytes. Viam a assinatura JPEG (`FF D8 FF`)
  e mostravam a imagem, ignorando o rótulo errado.
- **Android** confia no `mimeType` declarado. E `image/webp` no WhatsApp é o
  caminho de **figurinha**, não o de imagem. Como os bytes não eram um webp
  válido, o Android descartava em silêncio.

Um rótulo errado, e nada no log.

## A correção

`Nomear foto` agora lê a **assinatura do próprio arquivo** e declara o que ele
realmente é:

| assinatura | tipo declarado | nome |
|---|---|---|
| `FF D8 FF` | `image/jpeg` | `foto-N.jpg` |
| `89 50 4E 47` | `image/png` | `foto-N.png` |
| `47 49 46` | `image/gif` | `foto-N.gif` |
| `RIFF....WEBP` | `image/webp` | `foto-N.webp` |

Se por algum motivo não der para ler o buffer, cai no tipo que o próprio download
já tinha detectado — e nunca em webp.

### O caso que continua em aberto

Se o lojista subir uma foto que é **mesmo** um `.webp`, ela vai continuar sem
aparecer no Android — e aí o rótulo estará certo, o problema é o formato. Mentir
dizendo `image/jpeg` só trocaria um erro por outro.

A solução certa é converter no momento do upload, no painel, e não no n8n. Vale
fazer quando aparecer o primeiro caso; hoje o acervo é todo JPEG.

## Como conferir se voltou a quebrar

Numa execução que mandou foto, procure o `mimeType` que sai do `Nomear foto`.
Se aparecer `image/webp` em foto que é JPEG, o nó foi sobrescrito.

Teste sempre nos **três**: Android, iPhone e WhatsApp Web. Esse bug passou
despercebido justamente porque dois dos três funcionavam.
