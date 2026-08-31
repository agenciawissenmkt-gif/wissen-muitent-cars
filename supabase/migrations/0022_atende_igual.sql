-- 0022_atende_igual.sql
--
-- Print do lojista, 22:10 de um domingo. O cliente mandou "oi" e a Julia abriu
-- assim:
--
--   "Oi, Tiago! Boa noite!"
--   "A loja ja esta fechada agora,"
--   "mas eu continuo aqui pra anotar seu pedido, ta?"
--   "Se quiser, deixo tudo pronto pro consultor te chamar assim que abrir."
--   "O que posso preparar pra voce?"
--
-- Cinco mensagens, e a conversa virou sobre o expediente da loja. O cliente nao
-- perguntou que horas abre. Ele disse "oi".
--
-- Duas mensagens depois ela repetiu: "A loja ja fechou por hoje, Tiago".
--
-- O efeito e o contrario do que se quer: em vez de aproveitar um cliente que
-- apareceu as 22h -- entender o que ele procura, mostrar carro, deixar a visita
-- encaminhada --, ela avisa que esta tudo fechado e pede para ele voltar amanha.
-- Quem chega fora do horario e justamente quem tem tempo de conversar.
--
-- O horario continua no prompt e continua valendo para o que depende dele:
-- agendar visita e transferir para um humano. O que muda e a iniciativa. Ela
-- so toca no assunto quando a pergunta e essa, ou quando a resposta honesta
-- depende disso.

update public.prompt_templates
   set template = replace(
     template,
     'CONDUCAO: quem conduz a conversa e voce',
     'HORARIO NA CONVERSA: atenda exatamente do mesmo jeito com a loja aberta ou fechada -- entenda o perfil, mostre os carros, tire duvidas, monte a vitrine, colete nome e WhatsApp, deixe a visita encaminhada. NUNCA abra a conversa avisando que a loja esta fechada, e nunca emende isso numa resposta: o cliente nao perguntou. Quem chega fora do expediente costuma ser justamente quem tem tempo de conversar. So fale do horario em tres situacoes: quando ele perguntar que horas voces abrem ou se estao abertos; quando ele pedir para falar com um vendedor agora; e quando for marcar visita em dia ou hora que a loja esta fechada. Nesses casos, uma frase resolve -- e nao repita depois.

CONDUCAO: quem conduz a conversa e voce')
 where template like '%CONDUCAO: quem conduz a conversa e voce%'
   and template not like '%HORARIO NA CONVERSA:%';

do $do$
declare v_novo int; v_cond int;
begin
  select count(*) into v_novo from public.prompt_templates where template like '%HORARIO NA CONVERSA:%';
  select count(*) into v_cond from public.prompt_templates where template like '%CONDUCAO: quem conduz%';
  if v_novo <> 3 then raise exception 'Esperava 3 templates com HORARIO NA CONVERSA, achei %', v_novo; end if;
  if v_cond <> 3 then raise exception 'CONDUCAO sumiu de algum template: achei %', v_cond; end if;
end
$do$;

update public.tenant_agents set system_prompt = system_prompt;
