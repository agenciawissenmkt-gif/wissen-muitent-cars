-- 0046 — Visita confirmada como gente, e agenda fora do ar sem falar como maquina
--
-- O que aconteceu (25/09, 16:08): o cliente escolheu "quinta as 11" para ver o
-- Celta. A autorizacao do Google Agenda no n8n tinha caido, a consulta a agenda
-- voltou com erro e a Julia respondeu:
--   "Quinta-feira, 1 de outubro, as 11h, funciona para ver o Celta."
--   "Nao consegui concluir o agendamento agora."
--   "Um consultor assume com voce para confirmar a visita."
-- Tres problemas: "funciona" antes de agendar; contar a falha com palavra de
-- sistema; e nenhuma regra dizendo o que fazer quando a agenda nao responde.
-- O Tiago pediu: "Quinta-feira, 1 de outubro as 11h, ja agendei para voce vir
-- ver o Celta" -- mais humano.
--
-- O que muda nos tres agentes (descoberta, encantamento, fechamento):
--   1. Depois de agendar, a confirmacao diz que JA ESTA AGENDADO, no tom de
--      quem resolveu, e nunca "funciona" / "pode ser?".
--   2. Bloco novo AGENDA FORA DO AR: erro da ferramenta nao e agenda vazia; nao
--      afirma nada, nao conta o problema, anota o horario como gente, deixa
--      nota para o consultor e transfere.
--   3. A REGRA DE OURO e o CONSULTAR apontam para o bloco novo.
-- (O fluxo do n8n passa a escrever AGENDA FORA DO AR no bloco VISITA NO
-- CALENDARIO quando a leitura da agenda falha, em vez de "nao tem visita".)
--
-- Cada trecho antigo existe exatamente uma vez em cada template (conferido
-- abaixo antes de trocar). Depois re-renderiza os prompts das lojas.

do $$
declare
  a1 text := $t$2) confirme ao cliente em uma frase curta com dia, hora e carro;$t$;
  n1 text := $t$2) confirme ao cliente em uma frase curta com dia, hora e carro, dizendo que JA ESTA AGENDADO, no tom de quem resolveu: "Pronto, ja agendei pra voce: quinta, 1 de outubro, as 11h, pra ver o Celta." ou "Quinta-feira, 1 de outubro, as 11h -- ja agendei pra voce vir ver o Celta." Nunca "funciona", "fica bom?" ou "pode ser?": ele ja escolheu o horario, a sua parte era agendar;$t$;

  a2 text := $t$Se nao resolver, emita [TRANSFERIR:agendamento|auto] na mesma resposta.$t$;
  n2 text := $t$Se nao resolver, emita [TRANSFERIR:agendamento|auto] na mesma resposta -- e, se foi a ferramenta que falhou, siga AGENDA FORA DO AR.$t$;

  a3 text := $t$Confirmar visita e nao emitir o marcador e erro grave. Nesta resposta nao use marcador de foto.$t$;
  n3 text := $t$

AGENDA FORA DO AR. Se uma ferramenta do Calendario devolver "error" em vez de eventos, ou se o bloco VISITA NO CALENDARIO disser AGENDA FORA DO AR, a agenda nao respondeu. Isso NAO quer dizer que ela esta vazia, nem que o horario esta livre ou ocupado: voce simplesmente nao sabe. Entao:
- Nunca diga que agendou, remarcou ou cancelou, e nunca diga que ele tem ou nao tem visita marcada.
- Nunca conte o problema ao cliente: nada de "nao consegui concluir o agendamento", "deu erro", "a agenda caiu", "o sistema". Isso e fala de maquina.
- Anote o horario que ele escolheu como gente e passe pro consultor fechar, na mesma resposta: "Anotado: quinta, 1 de outubro, as 11h, pra ver o Celta. O consultor confirma esse horario com voce aqui mesmo." Com a loja fechada, diga quando: "... confirma com voce amanha cedo, quando a loja abrir."
- Chame "Adicionar nota1" com dia, hora, carro e o aviso AGENDA FORA DO AR -- VISITA NAO FOI PARA O CALENDARIO, e escreva [TRANSFERIR:agendamento|auto] em paragrafo separado no fim.$t$;

  a4 text := $t$Nao achou nada, diga com clareza e ofereca marcar.$t$;
  n4 text := $t$Nao achou nada, diga com clareza e ofereca marcar. (Resposta com "error" nao e "nao achou nada": veja AGENDA FORA DO AR.)$t$;

  t record;
begin
  for t in select agent_type, template from public.prompt_templates loop
    if (length(t.template) - length(replace(t.template, a1, ''))) / length(a1) <> 1
    or (length(t.template) - length(replace(t.template, a2, ''))) / length(a2) <> 1
    or (length(t.template) - length(replace(t.template, a3, ''))) / length(a3) <> 1
    or (length(t.template) - length(replace(t.template, a4, ''))) / length(a4) <> 1 then
      raise exception '0046: trecho antigo nao encontrado uma unica vez no template %', t.agent_type;
    end if;
  end loop;

  update public.prompt_templates
     set template = replace(replace(replace(replace(template,
                      a1, n1),
                      a2, n2),
                      a3, a3 || n3),
                      a4, n4),
         updated_at = now();
end $$;

-- re-renderiza os prompts das lojas a partir dos templates
update public.tenant_agents set system_prompt = system_prompt;

do $$
declare
  n_total int;
  n_ok    int;
begin
  select count(*) into n_total from public.tenant_agents;
  select count(*) into n_ok
    from public.tenant_agents
   where system_prompt like '%"Pronto, ja agendei pra voce: quinta, 1 de outubro, as 11h, pra ver o Celta."%'
     and system_prompt like '%AGENDA FORA DO AR. Se uma ferramenta do Calendario devolver "error"%'
     and system_prompt like '%se foi a ferramenta que falhou, siga AGENDA FORA DO AR.%'
     and system_prompt like '%(Resposta com "error" nao e "nao achou nada": veja AGENDA FORA DO AR.)%'
     and system_prompt like '%MAS CUMPRIMENTO NOVO NAO E CONVERSA FIADA%';
  if n_ok <> n_total then
    raise exception '0046: so % de % prompts ficaram com o texto novo', n_ok, n_total;
  end if;
end $$;
