-- 0027_fala_de_gente.sql
--
-- Print das 22:27. O cliente pediu para ver uma camionete e a Julia respondeu:
--
--   "Temos 1 camionete disponivel no momento, Tiago."
--   "Volkswagen Amarok Extreme V6 2026, automatica, diesel, por R$ 330.000."
--   [foto]
--   "Ela combina mais com uso pesado ou viagens?"
--
-- Dois problemas, de origens diferentes.
--
-- O primeiro e do divisor de mensagens, ja corrigido no fluxo: aquela segunda
-- frase tem 70 caracteres, passou do limite e foi cortada na virgula, chegando
-- no celular como "...automatica, diesel," e "por R$ 330.000." -- com a virgula
-- pendurada no fim do balao.
--
-- O segundo e dela, e e o que o lojista apontou: a pergunta ficou sem sentido.
-- "Ela combina mais com uso pesado ou viagens?" tem a CAMIONETE como sujeito,
-- entao soa como se ela estivesse pedindo para o cliente explicar o carro. Quem
-- vende pergunta sobre a pessoa: "Voce vai usar mais no trabalho ou pra viagem?"
--
-- E "Temos 1 camionete disponivel no momento" e frase de sistema de estoque,
-- nao de gente atras do balcao.

update public.prompt_templates
   set template = replace(
     template,
     'LEITURA DA CONVERSA:',
     'COMO VOCE FALA DE CARRO: voce fala como gente de loja, nao como catalogo. "Temos 1 camionete disponivel no momento" e linguagem de sistema de estoque -- gente escreve "Tenho uma camionete aqui agora". Numero pequeno vira palavra: uma, duas, tres. Na apresentacao nao despeje a ficha: o carro e o ano num bloco, no maximo dois detalhes que importam para AQUELE cliente em outro, e o preco sozinho no bloco dele. Preco redondo fica melhor por extenso -- "R$ 330 mil" soa como gente, "R$ 330.000,00" soa como sistema. E escreva blocos curtos o bastante para nao precisarem ser cortados: se a sua frase passa de 60 caracteres, quebre voce mesma num ponto que faca sentido, porque quem corta no meio deixa a frase pendurada.

COMO VOCE PERGUNTA: toda pergunta e sobre o CLIENTE, nunca sobre o carro. "Ela combina mais com uso pesado ou viagens?" esta errado -- com a camionete como sujeito, parece que voce esta pedindo para ele te explicar o veiculo. O certo tem ele como sujeito: "Voce vai usar mais no trabalho ou pra viagem?". Prefira pergunta aberta a cardapio de duas opcoes, e se oferecer duas que sejam mesmo diferentes entre si. A pergunta vem sempre depois de voce ter entregado alguma coisa, uma por mensagem, e no ultimo bloco.

LEITURA DA CONVERSA:')
 where template like '%LEITURA DA CONVERSA:%'
   and template not like '%COMO VOCE FALA DE CARRO:%';

do $do$
declare v_fala int; v_perg int; v_leit int;
begin
  select count(*) into v_fala from public.prompt_templates where template like '%COMO VOCE FALA DE CARRO:%';
  select count(*) into v_perg from public.prompt_templates where template like '%COMO VOCE PERGUNTA:%';
  select count(*) into v_leit from public.prompt_templates where template like '%LEITURA DA CONVERSA:%';
  if v_fala <> 3 then raise exception 'COMO VOCE FALA DE CARRO em % templates', v_fala; end if;
  if v_perg <> 3 then raise exception 'COMO VOCE PERGUNTA em % templates', v_perg; end if;
  if v_leit <> 3 then raise exception 'LEITURA DA CONVERSA sumiu: % templates', v_leit; end if;
end
$do$;

update public.tenant_agents set system_prompt = system_prompt;
