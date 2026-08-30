# Blindagem: o cliente nunca fica sem resposta

Antes, qualquer nó que falhasse derrubava a execução inteira. O cliente mandava
mensagem e não recebia nada — sem aviso para ninguém. As execuções ficavam com
status `error` no n8n e só.

A blindagem tem três camadas. A ideia é que a primeira resolva quase tudo, a
segunda pegue o resto, e a terceira garanta que ninguém fique no vácuo.

## Camada 1 — tentar de novo antes de desistir

Todos os nós de rede (Chatwoot, Supabase, Redis, Postgres, OpenAI, Evolution,
Google Calendar) passaram a repetir a chamada em vez de morrer na primeira
falha:

| tipo de nó | tentativas | espera |
|---|---|---|
| leitura e consulta | 3 | 2s |
| envio ao cliente (`SendMessage1`, `Enviar foto`) | 2 | 1,5s |

O envio repete menos porque um timeout depois da entrega duplicaria a mensagem.
Duas tentativas cobrem a instabilidade normal sem esse risco.

Isso sozinho já resolve a maior parte: quase toda falha real era instabilidade
de rede ou `429` da OpenAI (o limite de 30.000 TPM da conta), e ambas passam na
segunda tentativa.

## Camada 2 — falhar sem derrubar a conversa

Duas coisas mudaram de comportamento:

**Ferramentas da Júlia** (consultar estoque, base de conhecimento, agenda,
atribuir conversa, atualizar lead) agora devolvem o erro **para ela** em vez de
matar a execução. Ela lê "não consegui consultar" e responde ao cliente com
naturalidade, em vez de sumir.

**Registros paralelos** (`Redis - Push Message ID`, `Redis - Marca msg da
Julia`, `Execution Data`, `Supabase - Registra follow-up`, `Chatwoot - Assign to
bot`) deixaram de ser obrigatórios. Se o follow-up não gravar, paciência — o
cliente recebe a resposta do mesmo jeito.

## Camada 3 — a rede de segurança

Workflow **`Wissen Cars - Rede de seguranca`**, ligado no campo *Error Workflow*
do fluxo principal. Roda sozinho sempre que uma execução morre.

O problema: o Error Trigger do n8n só entrega o **id da execução**. Ele não sabe
com quem a Júlia estava falando — então não teria como responder ao cliente.

A solução são dois nós no fluxo principal:

- **`Guardar contexto (rede de seguranca)`** — logo depois do `Settings v3`,
  grava em `wissen:ctx:<id da execução>` quem é o cliente, qual a conversa, qual
  a loja e a última mensagem dele. TTL de 2h.
- **`Marca que o cliente ja foi respondido`** — depois do `SendMessage1`, grava
  `wissen:ok:<id da execução>`.

Com isso a rede de segurança sabe **para quem** responder e, principalmente,
**se ainda precisa** responder.

### O que ela faz

1. Lê o contexto no Redis. Sem contexto (falha antes do `Settings v3`, ou erro
   em outro workflow), não faz nada — melhor silêncio que mensagem errada.
2. Se o cliente **ainda não** tinha recebido resposta, manda duas mensagens
   curtas: *"Só um instante!"* e *"Já estou chamando um consultor aqui pra te
   atender."*
3. Se o cliente **já** tinha sido respondido antes da falha, não manda nada —
   seria estranho receber "só um instante" depois de uma resposta completa.
4. Libera o responsável e passa a conversa para o time de atendimento.
5. Deixa uma **nota privada** na conversa: onde parou, qual o erro, o link da
   execução e a última mensagem do cliente. O vendedor assume já sabendo do quê
   se trata. O cliente não vê nada disso.

Cada passo continua mesmo se o anterior falhar. Se o Chatwoot estiver fora, a
rede não conserta nada — mas também não é ela que está quebrada.

## O que continua descoberto

- **n8n fora do ar.** Se o webhook não chega, não há execução para falhar e nada
  dispara. Isso é território do `Monitor de conexao`.
- **Chatwoot ou Evolution fora do ar.** A rede tenta usar o mesmo Chatwoot que
  quebrou.
- **Resposta errada, mas entregue.** A blindagem garante que chega resposta, não
  que a resposta está certa.

## Como testar

1. No nó `Chatwoot - SendMessage1`, troque a URL por
   `https://teste-rede-de-seguranca.invalid/falha-proposital`. Salve e publique.
2. Mande qualquer mensagem do WhatsApp de teste.
3. Deve chegar *"Só um instante!"* e *"Já estou chamando um consultor..."*, e a
   conversa deve cair para o time com a nota privada.
4. **Restaure a URL** e publique de novo.

Enquanto a URL estiver quebrada, cliente de verdade também cai na rede de
segurança. Não deixe assim.
