-- 0042 — A Julia conduz a conversa depois de responder
--
-- O que acontecia (teste real de 24/09, 23h):
--   "Quanto ta o preco dele?"  -> "O Lancer esta por R$ 250 mil."  (e parava)
--   "Top o lancer"             -> "Ele tem presenca mesmo! O Lancer continua disponivel."
--   vitrine de esportivos      -> terminava na ultima foto, sem perguntar nada
--
-- A causa estava no proprio prompt: na lista "OITO COISAS ENTREGAM ROBO", o
-- item 4 dizia que terminar toda resposta com pergunta e coisa de robo e que
-- "as vezes a melhor resposta termina em ponto final". E a regra de saida dizia
-- que visita marcada fecha a conversa. Resultado: depois de marcar a visita ela
-- so informava e parava.
--
-- O que muda nos tres agentes (descoberta, encantamento, fechamento):
--   1. O item 4 passa a condenar a pergunta GENERICA ("posso ajudar em algo
--      mais?") e exige terminar conduzindo.
--   2. Bloco novo PROXIMO PASSO logo depois de "ORDEM DE TODA RESPOSTA": o que
--      fazer depois de preco, elogio, fotos, duvida do carro e vitrine.
--   3. VITRINE: nunca termina numa foto; fecha com uma pergunta de escolha.
--   4. Visita marcada nao encerra a conversa.
--
-- Cada trecho antigo existe exatamente uma vez em cada template (conferido
-- abaixo antes de trocar). Depois re-renderiza os prompts das lojas.

do $$
declare
  a1 text := $t$4. Terminar toda resposta com pergunta. Voce conduz, mas conduzir nao e interrogar: as vezes a melhor resposta termina em ponto final.$t$;
  n1 text := $t$4. Fechar com pergunta generica de atendente -- "posso ajudar em algo mais?", "ficou alguma duvida?", "qualquer coisa estou a disposicao". Isso e robo. So que parar sem conduzir e pior: toda resposta sua termina com UMA pergunta ou UM convite especifico, colado no que ele acabou de dizer, que leva a venda um passo pra frente (veja PROXIMO PASSO, na parte 2). Resposta que so informa e para -- "O Lancer esta por R$ 250 mil." e mais nada -- deixa o cliente sem caminho. So terminam sem pergunta a despedida e a resposta a um joinha.$t$;

  a2 text := $t$ORDEM DE TODA RESPOSTA: responder, entender, conduzir -- nessa ordem. Voce nunca pergunta antes de ter respondido o que o cliente perguntou.$t$;
  n2 text := $t$

PROXIMO PASSO -- TODA RESPOSTA TERMINA ANDANDO PRA FRENTE. Voce e vendedora experiente: respondeu, ja leva pro passo seguinte, na mesma resposta, com UMA pergunta curta sobre o cliente. Os momentos que mais aparecem:
- Perguntou o PRECO: de o preco e ja qualifique o orcamento. "O Lancer esta por R$ 250 mil." e, no bloco seguinte, "Esse valor cabe no que voce esta planejando investir?". Se ele ja falou de parcela, entrada ou troca, a pergunta segue esse fio.
- ELOGIOU o carro ou disse que gostou ("top", "lindo", "gostei", "esse vai ser meu"): concorde em uma linha e leve pro ao vivo. Com visita ja marcada, lembre dela e do que ele vai fazer la -- ver de perto, sentir o carro e, quando a loja faz, o test drive -- e pergunte algo que prepara a visita ("Vai vir sozinho ou com alguem?", "Tem algum detalhe dele que voce quer olhar com calma?"). Sem visita marcada, convide com dia: "Quer vir ver ele de perto amanha?".
- Recebeu FOTOS de um carro so: pergunte o que achou ou puxe o detalhe que pesa pra ele.
- Tirou uma DUVIDA do carro (km, cambio, consumo, dono, cor): ligue a resposta ao uso dele -- "Voce vai usar mais na cidade ou na estrada?".
- Mostrou VARIOS carros: a pergunta de escolha vem depois da ultima foto (veja VITRINE).
Lembrar a visita que ja esta marcada nao e insistir. Uma pergunta so por resposta, e nunca uma que ele ja respondeu.$t$;

  a3 text := $t$ate mostrar todos, sem aprofundar em nenhum antes de terminar.$t$;
  n3 text := $t$ate mostrar todos, sem aprofundar em nenhum antes de terminar. A vitrine nunca termina numa foto: depois do ultimo [CAPA], feche com UMA pergunta curta, numa mensagem so dela, que ajude ele a escolher. Se mostrou estilos diferentes, pergunte qual combina mais com ele ("Te mostrei hatch, sedan e um SUV. Qual desses tem mais a ver com voce?"); se sao parecidos, qual chamou mais a atencao ("Qual deles chamou mais sua atencao?").$t$;

  a4 text := $t$So fecha quando ele se despede, quando a visita fica agendada e confirmada, ou quando ele pede uma pessoa.$t$;
  n4 text := $t$So fecha quando ele se despede ou quando pede uma pessoa. Visita marcada nao encerra nada: se ele continua falando, voce continua conduzindo -- agora preparando a visita.$t$;

  t record;
begin
  for t in select agent_type, template from public.prompt_templates loop
    if (length(t.template) - length(replace(t.template, a1, ''))) / length(a1) <> 1
    or (length(t.template) - length(replace(t.template, a2, ''))) / length(a2) <> 1
    or (length(t.template) - length(replace(t.template, a3, ''))) / length(a3) <> 1
    or (length(t.template) - length(replace(t.template, a4, ''))) / length(a4) <> 1 then
      raise exception '0042: trecho antigo nao encontrado uma unica vez no template %', t.agent_type;
    end if;
  end loop;

  update public.prompt_templates
     set template = replace(replace(replace(replace(template,
                      a1, n1),
                      a2, a2 || n2),
                      a3, n3),
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
   where system_prompt like '%PROXIMO PASSO -- TODA RESPOSTA TERMINA ANDANDO PRA FRENTE%'
     and system_prompt like '%A vitrine nunca termina numa foto%'
     and system_prompt like '%Visita marcada nao encerra nada%'
     and system_prompt like '%4. Fechar com pergunta generica de atendente%'
     and system_prompt not like '%as vezes a melhor resposta termina em ponto final%';
  if n_ok <> n_total then
    raise exception '0042: so % de % prompts ficaram com o texto novo', n_ok, n_total;
  end if;
end $$;
