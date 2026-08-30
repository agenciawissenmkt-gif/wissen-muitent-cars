-- 0018_julia_conduz.sql
--
-- Print do lojista: depois de mostrar o CHEVROLET CELTA 2010, a Julia perguntou
--
--   "Quer ver mais detalhes ou pedir a ficha tecnica?"
--
-- Dois problemas em uma frase so:
--
--   1. "pedir". O cliente nao precisa pedir nada. Quem conduz e ela.
--   2. Cardapio de duas opcoes que sao quase a mesma coisa -- "mais detalhes" e
--      "ficha tecnica". Isso empurra a decisao para o cliente em vez de propor o
--      proximo passo.
--
-- A regra nova diz o que fazer no lugar: oferecer o passo seguinte, em uma
-- pergunta so, no tom de quem ja vai fazer. E deixa explicito o outro lado --
-- conduzir nao e ignorar: se o cliente pede algo direto, ela entrega na hora,
-- sem desviar para o roteiro dela.

update public.prompt_templates
   set template = replace(
     template,
     'REGRAS DE OURO:',
     'CONDUCAO: quem conduz a conversa e voce, nao o cliente. Nunca peca que ele peca alguma coisa -- "quer ver mais detalhes ou pedir a ficha tecnica?" esta errado por dois motivos: joga a decisao no colo dele e ainda oferece duas opcoes que sao quase a mesma coisa. Proponha UM proximo passo, no tom de quem ja vai fazer: "quer dar uma olhada nos detalhes dele?". Escolha o passo pelo que voce ja entendeu do perfil dele ate ali, nao por cardapio. Conduzir nao e ignorar: se o cliente pedir algo direto, entregue o que ele pediu na hora, sem desviar para o seu roteiro.

REGRAS DE OURO:')
 where template like '%REGRAS DE OURO:%'
   and template not like '%CONDUCAO: quem conduz%';

do $do$
declare
  v_novo int;
  v_ouro int;
begin
  select count(*) into v_novo from public.prompt_templates where template like '%CONDUCAO: quem conduz%';
  select count(*) into v_ouro from public.prompt_templates where template like '%REGRAS DE OURO:%';
  if v_novo <> 3 then
    raise exception 'Esperava 3 templates com o bloco CONDUCAO, achei %', v_novo;
  end if;
  if v_ouro <> 3 then
    raise exception 'REGRAS DE OURO sumiu de algum template: achei %', v_ouro;
  end if;
end
$do$;

update public.tenant_agents set system_prompt = system_prompt;
