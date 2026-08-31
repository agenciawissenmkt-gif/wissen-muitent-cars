# Blindagem: o cliente nunca fica sem resposta

Antes, qualquer nó que falhasse derrubava a execução inteira. O cliente mandava
mensagem e não recebia nada — sem aviso para ninguém. As execuções ficavam com
status `error` no n8n e só.

Três camadas. A primeira resolve quase tudo, a segunda pega o resto, a terceira
garante que ninguém fique no vácuo.

## Camada 1 — tentar de novo antes de desistir

Todos os nós de rede (Chatwoot, Supabase, Redis, Postgres, OpenAI, Evolution,
Google Calendar) repetem a chamada em vez de morrer na primeira falha:

| tipo de nó | tentativas | espera |
|---|---|---|
| leitura e consulta | 3 | 2s |
| envio ao cliente (`SendMessage1`, `Enviar foto`) | 2 | 1,5s |

O envio repete menos porque um timeout depois da entrega duplicaria a mensagem.

Isso sozinho resolve a maior parte: quase toda falha real era instabilidade de
rede ou `429` da OpenAI, e ambas passam na segunda tentativa.

## Camada 2 — falhar sem derrubar a conversa

**Ferramentas da Júlia** (estoque, base de conhecimento, agenda, atribuir
conversa, atualizar lead) devolvem o erro **para ela** em vez de matar a
execução. Ela responde "não consegui consultar" em vez de sumir.

**Registros paralelos** (`Redis - Push Message ID`, `Redis - Marca msg da
Julia`, `Execution Data`, `Supabase - Registra follow-up`, `Chatwoot - Assign to
bot`) deixaram de ser obrigatórios.

## Camada 3 — a rede de segurança

Workflow **`Wissen Cars - Rede de seguranca`**, ligado no campo *Error Workflow*
do fluxo principal.

> **Ela precisa estar ATIVA.** O n8n não aciona um workflow de erro desativado.
> Ficou armada no papel e desligada na prática até isso ser descoberto num teste
> real. Se você duplicar ou recriar esse workflow, ative.

### Como ela sabe com quem falar

O Error Trigger só entrega o id da execução. Dois nós no fluxo principal
resolvem isso:

- **`Guardar contexto (rede de seguranca)`** — logo depois do `Settings v3`,
  grava em `wissen:ctx:<id da execução>` quem é o cliente, a conversa, a loja,
  **a inbox**, **a lista de vendedores** e a última mensagem. TTL 2h.
- **`Marca que o cliente ja foi respondido`** — depois do `SendMessage1`, grava
  `wissen:ok:<id da execução>`.

> **O nó Redis do n8n NÃO repassa o item que entrou.** Cada leitura devolve só a
> propriedade que buscou. Na primeira versão, `Ler contexto` trazia o contexto
> certo e `Ja respondeu` o descartava no passo seguinte — a rede terminava com
> status "sucesso" tendo rodado 5 dos 10 nós, sem fazer nada e sem erro nenhum.
> Por isso o código lê cada valor do **seu próprio nó, por nome**.

### O que ela faz

1. Lê o contexto. Sem contexto, não faz nada — melhor silêncio que mensagem
   errada.
2. Se o cliente ainda não tinha sido respondido, manda **"Só um instante!"**,
   espera 3 segundos e manda **"Já estou chamando um consultor aqui pra te
   atender."**

   > A pausa não é enfeite. Sem ela as duas saem no mesmo instante e o WhatsApp
   > entrega **fora de ordem** — aconteceu no teste.

3. **Marca as duas mensagens** como sendo da Júlia (`julia:<conta>:<id da
   mensagem>`, TTL 30min).

   > Sem isso a devolução automática confunde as mensagens da rede com resposta
   > do vendedor, fecha o handoff como "atendido" — e a conversa fica **presa com
   > um vendedor que nunca respondeu**. Exatamente o cenário que a blindagem
   > existe para evitar.

4. Pergunta se **a loja está aberta agora**. Fechada, não transfere ninguém: a
   conversa fica com a Júlia e ela avisa que um consultor procura o cliente na
   abertura.

   > Atribuir às 22h é pior que não atribuir. O `stopAI` liga junto com o
   > responsável, então o cliente passaria a noite sem a Júlia e sem o vendedor.

5. Com a loja aberta, pergunta ao Chatwoot **quem está online** e escolhe o
   vendedor: prefere quem está online; se ninguém estiver, roda o rodízio entre
   todos. Dentro do grupo, pega quem está **há mais tempo sem receber** (quem
   nunca recebeu vai primeiro).
6. Atribui no Chatwoot e **grava em `wissen_handoffs`** com status `aguardando`.
7. Se não houver vendedor, cai para o time — e a nota avisa isso.
8. Deixa uma **nota privada**: onde parou, qual o erro, o link da execução, quem
   pegou e a última mensagem do cliente. O cliente não vê nada disso.

### O encaixe com a devolução de 10 minutos

O passo 5 é o que amarra tudo. O workflow **"Devolução automática do vendedor
(10 min)"** roda a cada 2 minutos procurando em `wissen_handoffs`:

```
WHERE status = 'aguardando' AND assigned_at < now() - interval '10 minutes'
```

É exatamente o que a rede grava. Se o vendedor não responder, a Júlia retoma a
conversa sozinha — inclusive quando o socorro foi acionado.

Sem o passo 5 a rede seria um beco sem saída: conversa parada com um vendedor,
sem ninguém para trazer de volta.

## São dois bancos, não um

Isso custou uma consulta quebrada em produção antes de ficar claro:

| onde | o que vive lá |
|---|---|
| **Postgres do n8n** | `wissen_handoffs`, `n8n_chat_histories` |
| **Supabase** | `stores`, `tenants`, `salespeople`, estoque, prompts |

Um `JOIN` entre os dois não existe. Perguntar o horário da loja dentro de uma
query do Postgres dá `relation "public.stores" does not exist`. O horário vem
por HTTP do Supabase, e é por isso que existe um nó `Horario da loja` em vez de
uma coluna a mais no SELECT.

## O resumo da conversa lia a chave errada

O nó `Historico da conversa (memoria)` monta o relatório privado para o vendedor
a partir de `n8n_chat_histories`. Ele buscava `session_id = <telefone>`.

A memória dos três agentes grava com `session_id = <tenant_id>::<telefone>`.
Nunca batia: **zero linhas, sempre**, e o resumo saía do vazio. Como o nó tem
`continueRegularOutput`, isso nunca virou erro — a nota era postada assim mesmo.

Convivem duas chaves diferentes na mesma tabela:

```
<uuid>::554195088316      os três agentes (Descoberta, Encantamento, Fechamento)
<uuid>::1::4::2::10       o Chat Memory Manager (tenant::conta::inbox::contato::conversa)
```

Ao mexer em qualquer coisa que leia a memória, confira **qual** das duas.

## Uma armadilha relacionada

`stopAI` é simplesmente `Boolean(assignee.id)`: **se a conversa tem responsável
humano, a Júlia não fala.** Está certo — ela não deve falar por cima do vendedor.

A consequência é que qualquer bug que deixe um handoff pendurado deixa também o
cliente sem atendimento nenhum. Ao investigar "a Júlia não respondeu", confira
primeiro se a conversa tem responsável no Chatwoot.

Para liberar na mão: `POST /api/v1/accounts/<conta>/conversations/<id>/assignments`
com `{"assignee_id": 0}`.

## O que continua descoberto

- **n8n fora do ar.** Sem execução não há falha para disparar nada. Território do
  `Monitor de conexao`.
- **Chatwoot ou Evolution fora do ar.** A rede tenta usar o mesmo Chatwoot que
  quebrou.
- **Resposta errada, mas entregue.** A blindagem garante que chega resposta, não
  que a resposta está certa.

## Como testar

1. No nó `Chatwoot - SendMessage1`, troque a URL por
   `https://teste-rede-de-seguranca.invalid/falha-proposital`. Salve e publique.
2. Confira antes que a conversa **não tenha responsável** no Chatwoot — senão o
   `stopAI` engole a mensagem e o teste não chega a falhar.
3. Mande qualquer mensagem do WhatsApp de teste.
4. Devem chegar as duas mensagens, na ordem, e a conversa deve ser atribuída a um
   vendedor específico.
5. **10 minutos depois**, sem ninguém fazer nada, a Júlia deve retomar.
6. **Restaure a URL** e publique de novo.

Enquanto a URL estiver quebrada, cliente de verdade também cai na rede de
segurança. Não deixe assim.

## Estado dos testes

Comprovado no WhatsApp real: as duas mensagens chegando, a escolha do vendedor
online, a atribuição no Chatwoot e a gravação do handoff.

Comprovado também: a retomada automática 10 minutos depois de um handoff criado
pela rede (execução `13769`, exatos 10 minutos depois do handoff das 22:14).

Ainda **não observado de ponta a ponta**: o comportamento fora do horário, e a
mensagem de retomada com a loja fechada — para essa faz falta um handoff criado
com a loja aberta que só vença depois de fechar.
