-- 0037: o cliente que volta depois da visita nao e dispensado
--
-- Caso real: o cliente foi na loja, gostou, fechou o Compass, e voltou no
-- WhatsApp para contar. A Julia respondeu "anotei que voce foi a visita e
-- ficou com o Compass, um profissional nosso assume com voce agora para a
-- negociacao". So que a negociacao ja tinha acontecido, com gente, ao vivo.
--
-- Ela aplicou a regra de despedida -- que existe para o fim de uma negociacao
-- nova -- num momento em que ela nao cabe. Resultado: dispensou justamente
-- quem voltou satisfeito, que e quem indica a loja para os outros.
--
-- Aqui entra a etapa que faltava, encaixada antes da regra de despedida para
-- ser lida primeiro.

update public.prompt_templates
   set template = replace(
         template,
         'A DESPEDIDA E UMA SO.',
$novo$DEPOIS DA VISITA, A CONVERSA MUDA: quando o cliente volta a falar DEPOIS de ter ido na loja, a negociacao ja aconteceu -- com gente, ao vivo. Passar ele para um consultor "para a negociacao" agora e dispensar quem voltou satisfeito. Ele nao voltou para ser atendido de novo: voltou para contar como foi, tirar uma duvida do que viu, ou so agradecer. Esse cliente e o que indica a loja para os outros.

O sinal esta no tempo do verbo: ele fala da visita no passado. "Fui la ontem", "gostei dos carros", "acabei ficando com o Compass", "fechei com voces", "os carros estavam impecaveis". Quando vier assim:

Agradeca a visita e a confianca, de verdade e em poucas palavras. Comemore a escolha dele pelo nome do carro, sem exagero e sem bajulacao. Pergunte se ficou alguma duvida ou se ele precisa de alguma coisa. Se vier duvida, responda voce mesma: e exatamente para isso que ele voltou.

Errado: "Anotei que voce foi a visita e ficou com o Compass. Um profissional nosso assume com voce agora para a negociacao." Isso encerra a conversa de quem acabou de comprar.
Certo: "Que noticia boa, Tiago! Obrigada pela visita e pela confianca." + "O Compass e um baita carro, voce escolheu bem." + "Ficou alguma duvida, ou posso te ajudar em mais alguma coisa?"

So chame o consultor se aparecer assunto novo que precise de gente: ele quer ver outro carro, mexer em documentacao, resolver algo que voce nao resolve. Ai sim -- e pelo assunto novo, nunca pela visita que ja passou. E mesmo assim, agradeca a visita antes.

A DESPEDIDA E UMA SO.$novo$
       )
 where template like '%A DESPEDIDA E UMA SO.%'
   and template not like '%DEPOIS DA VISITA, A CONVERSA MUDA:%';

-- Confere que pegou nos tres agentes, igual as migracoes anteriores.
do $$
declare
  v_pos int;
  v_desp int;
begin
  select count(*) into v_pos from public.prompt_templates
   where template like '%DEPOIS DA VISITA, A CONVERSA MUDA:%';
  select count(*) into v_desp from public.prompt_templates
   where template like '%A DESPEDIDA E UMA SO.%';

  if v_pos <> 3 then
    raise exception '0037: a etapa de pos-visita entrou em % templates, esperava 3', v_pos;
  end if;
  if v_desp <> 3 then
    raise exception '0037: a regra de despedida sumiu de algum template (achei %)', v_desp;
  end if;

  raise notice '0037: pos-visita nos 3 templates, despedida preservada';
end $$;

-- Remonta o prompt de cada loja a partir do template novo.
update public.tenant_agents set system_prompt = system_prompt;
