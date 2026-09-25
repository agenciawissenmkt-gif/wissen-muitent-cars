-- 0045 — Cliente que volta depois da despedida esta reabrindo a conversa
--
-- O que aconteceu (25/09): o cliente se despediu as 11h ("tabom abraço"). As
-- 15:02 voltou com "oi" e a Julia respondeu "Oi, Tiago! Boa tarde, abraço!" --
-- cumprimentou e ja se despediu de novo. A regra DEPOIS DA DESPEDIDA (0043)
-- mandava responder conversa fiada e se despedir de novo, e ela tratou o "oi"
-- de horas depois como conversa fiada.
--
-- O que muda nos tres agentes (descoberta, encantamento, fechamento): o bloco
-- DEPOIS DA DESPEDIDA ganha a excecao do cumprimento novo -- quem manda oi,
-- ola, bom dia, boa tarde ou chama a Julia pelo nome esta voltando, e recebe
-- cumprimento com a porta aberta, nunca uma despedida.
--
-- O trecho antigo existe exatamente uma vez em cada template (conferido abaixo
-- antes de trocar). Depois re-renderiza os prompts das lojas.

do $$
declare
  a1 text := $t$Puxar assunto depois da despedida parece robo e incomoda o cliente.$t$;
  n1 text := $t$Puxar assunto depois da despedida parece robo e incomoda o cliente. MAS CUMPRIMENTO NOVO NAO E CONVERSA FIADA: se ele manda "oi", "ola", "bom dia", "boa tarde" ou chama voce pelo nome -- ainda mais horas depois --, ele esta VOLTANDO e reabrindo a conversa. Cumprimente com a SAUDACAO CERTA AGORA e deixe a porta aberta, sem despedida nenhuma: "Oi, Tiago! Boa tarde, tudo bem? Pode falar." Nunca responda um oi com "abraco", "ate mais", "tchau" ou "te espero na visita" -- isso e mandar embora quem acabou de chegar.$t$;
  t record;
begin
  for t in select agent_type, template from public.prompt_templates loop
    if (length(t.template) - length(replace(t.template, a1, ''))) / length(a1) <> 1 then
      raise exception '0045: trecho antigo nao encontrado uma unica vez no template %', t.agent_type;
    end if;
  end loop;

  update public.prompt_templates
     set template = replace(template, a1, n1),
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
   where system_prompt like '%MAS CUMPRIMENTO NOVO NAO E CONVERSA FIADA%'
     and system_prompt like '%DEPOIS DA DESPEDIDA -- AQUI VOCE NAO CONDUZ%'
     and system_prompt like '%SAUDACAO CERTA AGORA%';
  if n_ok <> n_total then
    raise exception '0045: so % de % prompts ficaram com o texto novo', n_ok, n_total;
  end if;
end $$;
