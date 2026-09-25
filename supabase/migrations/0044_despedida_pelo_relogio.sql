-- 0044 — A despedida tambem sai do relogio
--
-- O que aconteceu (25/09, 10:59): a Julia remarcou a visita e se despediu com
-- "Boa noite!" as 11h da manha. Ela sabia a hora (AGORA: sexta 10:59), mas a
-- conversa tinha comecado na noite anterior: o historico tinha 12 "boa noite",
-- e os exemplos do prompt para despedida tambem eram "boa noite". Ela copiou.
--
-- O que muda nos tres agentes (descoberta, encantamento, fechamento):
--   1. A regra SAUDACAO passa a valer tambem para a despedida e manda usar a
--      SAUDACAO CERTA AGORA (linha que o fluxo do n8n passa a mandar junto do
--      AGORA), nunca a saudacao que aparece no historico.
--   2. Os dois exemplos de despedida deixam de ter "boa noite" fixo.
--
-- Cada trecho antigo existe exatamente uma vez em cada template (conferido
-- abaixo antes de trocar). Depois re-renderiza os prompts das lojas.

do $$
declare
  s1 text := $t$Se ele mandar "bom dia" as 23h, voce responde boa noite -- ou sem saudacao nenhuma.$t$;
  n1 text := $t$Se ele mandar "bom dia" as 23h, voce responde boa noite -- ou sem saudacao nenhuma. Vale tambem para a DESPEDIDA: use sempre a SAUDACAO CERTA AGORA, que vem junto do AGORA no fim deste prompt (bom dia de manha, boa tarde a tarde, boa noite a noite). A conversa pode ter comecado ontem a noite: nunca copie a saudacao que aparece no historico.$t$;

  s2 text := $t$"Boa noite, Tiago! Fica com Deus, te espero terca as 10h."$t$;
  n2 text := $t$"Abraco, Tiago! Fica com Deus, te espero terca as 10h." (e, se for cumprimentar, com a SAUDACAO CERTA AGORA)$t$;

  s3 text := $t$"Entao boa noite -- e te espero hoje as 14h aqui na loja."$t$;
  n3 text := $t$"Entao ate mais -- e te espero hoje as 14h aqui na loja."$t$;

  t record;
begin
  for t in select agent_type, template from public.prompt_templates loop
    if (length(t.template) - length(replace(t.template, s1, ''))) / length(s1) <> 1
    or (length(t.template) - length(replace(t.template, s2, ''))) / length(s2) <> 1
    or (length(t.template) - length(replace(t.template, s3, ''))) / length(s3) <> 1 then
      raise exception '0044: trecho antigo nao encontrado uma unica vez no template %', t.agent_type;
    end if;
  end loop;

  update public.prompt_templates
     set template = replace(replace(replace(template, s1, n1), s2, n2), s3, n3),
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
   where system_prompt like '%Vale tambem para a DESPEDIDA: use sempre a SAUDACAO CERTA AGORA%'
     and system_prompt like '%"Abraco, Tiago! Fica com Deus, te espero terca as 10h."%'
     and system_prompt like '%"Entao ate mais -- e te espero hoje as 14h aqui na loja."%'
     and system_prompt like '%DEPOIS DA DESPEDIDA -- AQUI VOCE NAO CONDUZ%';
  if n_ok <> n_total then
    raise exception '0044: so % de % prompts ficaram com o texto novo', n_ok, n_total;
  end if;
end $$;
