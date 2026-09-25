-- 0043 — Depois que o cliente se despede, a Julia so se despede
--
-- O que aconteceu (teste real de 24/09, 23:51):
--   Cliente: "boa noite" / "dorme com deus"
--   Julia:   "Boa noite, Tiago!" / "Amem, voce tambem." / "Fica com Deus!"   (certo)
--   Cliente: "julia" / "so uma duvida" / "vc e solteira ?"
--   Julia:   "Prefiro manter nosso papo profissional, Tiago."
--            "Ficou alguma duvida sobre o Lancer antes da visita?"          (errado)
--   ... e seguiu perguntando da Hilux, do quitado, do resumo da negociacao.
--
-- A 0042 mandou toda resposta terminar conduzindo e so abriu excecao para a
-- despedida e o joinha. Faltou dizer que, depois que o CLIENTE se despediu,
-- conversa fiada (brincadeira, pergunta pessoal, figurinha, obrigado) nao
-- reabre a venda.
--
-- O que muda nos tres agentes (descoberta, encantamento, fechamento):
--   1. A excecao do item 4 passa a incluir tudo o que vem depois da despedida.
--   2. Bloco novo DEPOIS DA DESPEDIDA, logo depois do PROXIMO PASSO.
--   3. A regra do emoji aceita um emoji sozinho, como figurinha, fechando a
--      conversa na despedida (continua valendo o limite de um por conversa).
--
-- Cada trecho antigo existe exatamente uma vez em cada template (conferido
-- abaixo antes de trocar). Depois re-renderiza os prompts das lojas.

do $$
declare
  b1 text := $t$So terminam sem pergunta a despedida e a resposta a um joinha.$t$;
  n1 text := $t$Nao terminam com pergunta: a despedida, a resposta a um joinha e tudo o que vem depois que o cliente ja se despediu (veja DEPOIS DA DESPEDIDA).$t$;

  b2 text := $t$Lembrar a visita que ja esta marcada nao e insistir. Uma pergunta so por resposta, e nunca uma que ele ja respondeu.$t$;
  n2 text := $t$

DEPOIS DA DESPEDIDA -- AQUI VOCE NAO CONDUZ. Quando o cliente se despede (boa noite, tchau, ate amanha, fica com Deus, valeu, obrigado por tudo), a conversa fechou. Responda a despedida no mesmo tom, curta e calorosa, e pode lembrar a visita que ja esta marcada: "Boa noite, Tiago! Fica com Deus, te espero terca as 10h." E pare ai: nenhuma pergunta, nenhum assunto novo, nada sobre carro, troca ou pagamento. Se depois disso ele mandar so conversa -- brincadeira, pergunta pessoal, figurinha, um obrigado --, responda aquilo em uma linha leve e se despeca de novo, sem puxar assunto de venda. Voce so volta a conduzir se ELE trouxer um assunto de verdade: um carro, a visita, pagamento, troca, uma duvida. Puxar assunto depois da despedida parece robo e incomoda o cliente.$t$;

  b3 text := $t$e so quando o cliente comemora alguma coisa de verdade. Na duvida, nao manda.$t$;
  n3 text := $t$e so quando o cliente comemora alguma coisa de verdade ou na despedida, fechando a conversa (veja DEPOIS DA DESPEDIDA). Na duvida, nao manda.$t$;

  t record;
begin
  for t in select agent_type, template from public.prompt_templates loop
    if (length(t.template) - length(replace(t.template, b1, ''))) / length(b1) <> 1
    or (length(t.template) - length(replace(t.template, b2, ''))) / length(b2) <> 1
    or (length(t.template) - length(replace(t.template, b3, ''))) / length(b3) <> 1 then
      raise exception '0043: trecho antigo nao encontrado uma unica vez no template %', t.agent_type;
    end if;
  end loop;

  update public.prompt_templates
     set template = replace(replace(replace(template,
                      b1, n1),
                      b2, b2 || n2),
                      b3, n3),
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
   where system_prompt like '%DEPOIS DA DESPEDIDA -- AQUI VOCE NAO CONDUZ%'
     and system_prompt like '%tudo o que vem depois que o cliente ja se despediu%'
     and system_prompt like '%ou na despedida, fechando a conversa%'
     and system_prompt like '%PROXIMO PASSO -- TODA RESPOSTA TERMINA ANDANDO PRA FRENTE%';
  if n_ok <> n_total then
    raise exception '0043: so % de % prompts ficaram com o texto novo', n_ok, n_total;
  end if;
end $$;
