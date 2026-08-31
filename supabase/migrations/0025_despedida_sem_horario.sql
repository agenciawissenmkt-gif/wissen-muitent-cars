-- 0025_despedida_sem_horario.sql
--
-- Tres correcoes no prompt, todas nascidas de a 0023 ter sido escrita as pressas
-- na mesma madrugada em que a 0022 foi aplicada.
--
-- 1. A 0023 desfez a 0022.
--
--    A 0022 nasceu de um print das 22:10: a Julia abriu a conversa avisando que
--    a loja estava fechada, e o cliente so tinha dito "oi". A regra ficou:
--    "NUNCA abra a conversa avisando que a loja esta fechada", com tres
--    excecoes -- ele perguntar o horario, ele pedir um vendedor agora, ou a
--    visita cair em dia/hora fechada.
--
--    Horas depois, a 0023 mandou dizer "Um consultor confirma com voce assim
--    que a loja abrir" em TODA transferencia. Transferir por agendamento nao e
--    nenhuma das tres excecoes. Consertou-se o silencio reintroduzindo
--    exatamente a fala que a gente tinha acabado de proibir.
--
--    As duas intencoes convivem bem -- nao puxar o assunto, e nao sumir. E a
--    redacao que briga. A despedida noturna nao precisa citar o expediente.
--
-- 2. Duas frases obrigatorias para o mesmo momento.
--
--    O bloco TRANSFERENCIA manda dizer "Ja estou chamando nosso consultor, um
--    instante." A 0023 manda "Um consultor assume daqui, ta?". Ambas
--    obrigatorias, ambas no bloco imediatamente anterior ao marcador. Ela emite
--    as duas seguidas ou escolhe uma ao acaso. Fica a da 0023, que e a que
--    resolve o problema real.
--
-- 3. A despedida nao entrou no checklist do agendamento.
--
--    O caso que motivou a 0023 foi o print das 00:42 -- visita marcada, cliente
--    respondeu "ok", silencio. Mas a 0023 inseriu o bloco novo no topo do prompt
--    sem tocar na lista numerada de tres passos que descreve esse mesmo momento.
--    Um modelo que segue a lista ao pe da letra nao se despede.

-- 1. A despedida noturna deixa de citar o horario da loja.
update public.prompt_templates
   set template = replace(
     template,
     'Com a loja fechada ou de madrugada: "Boa noite! Um consultor confirma com voce assim que a loja abrir."',
     'Com a loja fechada ou de madrugada: "Boa noite! Um consultor te chama, ta?" -- sem citar horario, porque ele nao perguntou.')
 where template like '%Um consultor confirma com voce assim que a loja abrir%';

-- 2. Some a frase concorrente do bloco TRANSFERENCIA.
update public.prompt_templates
   set template = replace(
     template,
     'Antes dele, uma mensagem curta avisando: "Ja estou chamando nosso consultor, um instante."',
     'Antes dele vem a despedida do bloco DESPEDIDA ANTES DE PASSAR PARA O CONSULTOR -- aquela e a unica, nao escreva outra frase de aviso alem dela.')
 where template like '%Ja estou chamando nosso consultor, um instante.%';

-- 3. A despedida vira passo do checklist do agendamento.
update public.prompt_templates
   set template = replace(
     template,
     '2) confirme ao cliente em uma frase curta com dia, hora e carro; 3) escreva [TRANSFERIR:agendamento|auto] em paragrafo separado no fim.',
     '2) confirme ao cliente em uma frase curta com dia, hora e carro; 3) despeca-se num bloco proprio, repetindo dia e hora, como manda o bloco DESPEDIDA -- confirmar a visita e sumir deixa o cliente falando sozinho; 4) escreva [TRANSFERIR:agendamento|auto] em paragrafo separado no fim.')
 where template like '%2) confirme ao cliente em uma frase curta com dia, hora e carro;%';

do $do$
declare v_noite int; v_velha int; v_passo int; v_desp int;
begin
  select count(*) into v_noite from public.prompt_templates
   where template like '%Um consultor te chama, ta?%';
  select count(*) into v_velha from public.prompt_templates
   where template like '%Ja estou chamando nosso consultor, um instante.%';
  select count(*) into v_passo from public.prompt_templates
   where template like '%4) escreva [TRANSFERIR:agendamento|auto]%';
  select count(*) into v_desp from public.prompt_templates
   where template like '%DESPEDIDA ANTES DE PASSAR PARA O CONSULTOR:%';

  if v_noite <> 3 then raise exception 'Esperava 3 templates com a despedida noturna nova, achei %', v_noite; end if;
  if v_velha <> 0 then raise exception 'A frase antiga de transferencia sobrou em % template(s)', v_velha; end if;
  if v_passo <> 3 then raise exception 'Esperava 3 checklists de agenda com 4 passos, achei %', v_passo; end if;
  if v_desp  <> 3 then raise exception 'O bloco DESPEDIDA sumiu de algum template: achei %', v_desp; end if;

  -- Nenhum template pode voltar a prometer o expediente numa despedida.
  if exists (select 1 from public.prompt_templates
              where template like '%assim que a loja abrir%') then
    raise exception 'Ainda existe despedida citando o horario da loja';
  end if;
end
$do$;

update public.tenant_agents set system_prompt = system_prompt;
