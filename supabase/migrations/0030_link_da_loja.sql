-- 0030_link_da_loja.sql
--
-- Print de 00:05. O cliente perguntou "E o site ?" e a Julia respondeu com um
-- balao contendo so isto:
--
--   https://wissen-cars.vercel.app/
--
-- Ela nao inventou. A execucao mostra que procurou na base de conhecimento
-- ("Qual e o site oficial da w Multimarcas?"), voltou vazio, e ai usou o que
-- estava no cadastro da loja -- porque o campo `website` de quatro lojas
-- guarda o endereco do painel da plataforma, e nao o site da concessionaria.
-- O mesmo vale para o instagram, gravado como "wissen oficial".
--
-- O dado errado se conserta no painel, e o vazamento se conserta na 0031, que
-- impede um endereco da propria plataforma de entrar no prompt. Aqui ficam as
-- duas regras de conduta que faltavam, e que valem mesmo com o cadastro certo:
--
-- 1. Um link nunca vai sozinho num balao. Ninguem responde "e o site?" jogando
--    uma URL seca; responde dizendo o que a pessoa vai achar la.
--
-- 2. Contato que ela nao tem, ela nao inventa. Site, instagram, telefone e
--    endereco so saem se estiverem no cadastro. Nao ter e uma resposta honesta,
--    e quase sempre ha o que oferecer no lugar.

update public.prompt_templates
   set template = replace(
     template,
     'O ESTOQUE E A SUA VISTA:',
     'LINKS E CONTATOS DA LOJA: site, instagram, telefone e endereco so existem se estiverem nos dados da loja. Voce nunca deduz um endereco a partir do nome da loja, nunca completa um link pela metade e nunca escreve um link que nao veio de la. Se a loja nao tem site, diga sem rodeio -- "Site a gente nao tem" -- e ofereca o que tem no lugar: o instagram, o endereco, ou as fotos que voce mesma manda aqui. Nao ter e uma resposta honesta; inventar manda o cliente para o lugar errado.
Link nunca vai sozinho num balao. "E o site?" nao se responde com uma URL seca: diz-se o que ele vai encontrar la e o link vem junto, na mesma frase. Ex: "Nosso site com o estoque todo e esse aqui: <link>".
E voce nao fala do sistema que te move -- nome, endereco, painel, plataforma, nada. Para o cliente existe a loja e existe voce.

O ESTOQUE E A SUA VISTA:')
 where template like '%O ESTOQUE E A SUA VISTA:%'
   and template not like '%LINKS E CONTATOS DA LOJA:%';

do $do$
declare v_lnk int; v_est int;
begin
  select count(*) into v_lnk from public.prompt_templates where template like '%LINKS E CONTATOS DA LOJA:%';
  select count(*) into v_est from public.prompt_templates where template like '%O ESTOQUE E A SUA VISTA:%';
  if v_lnk <> 3 then raise exception 'LINKS E CONTATOS DA LOJA em % templates', v_lnk; end if;
  if v_est <> 3 then raise exception 'O ESTOQUE E A SUA VISTA sumiu: % templates', v_est; end if;
end
$do$;

update public.tenant_agents set system_prompt = system_prompt;
