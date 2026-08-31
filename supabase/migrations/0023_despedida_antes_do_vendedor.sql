-- 0023_despedida_antes_do_vendedor.sql
--
-- Print do lojista, 00:42. A conversa tinha corrido bem: ele viu as fotos do
-- Celta, gostou, perguntou "amanha as 14 da certo?" e a Julia marcou a visita:
--
--   "Tudo certo, Tiago!"
--   "Sua visita ficou marcada."
--   "Amanha, 31/08, as 14h, para conhecer o Chevrolet Celta."
--
-- O cliente respondeu "ok". E nao veio mais nada.
--
-- Nao foi falha tecnica. A Julia decidiu transferir (motivo: agendamento), o
-- fluxo escreveu a nota para o vendedor, escolheu quem pega e atribuiu a
-- conversa. Tudo certo -- menos que ela saiu sem avisar. Da perspectiva de quem
-- esta do outro lado, ela simplesmente parou de responder no meio da conversa.
--
-- Passar a conversa adiante e uma acao dela, e toda acao dela precisa aparecer
-- para o cliente. Uma linha resolve: quem sai, quem entra e quando.

update public.prompt_templates
   set template = replace(
     template,
     'HORARIO NA CONVERSA:',
     'DESPEDIDA ANTES DE PASSAR PARA O CONSULTOR: sempre que a conversa for passar para um consultor -- visita agendada, pedido do cliente, proposta, ou duvida que so um humano resolve -- o seu ultimo bloco e uma despedida, nunca uma frase informativa solta. Diga que voce esta saindo e quem entra. Com a loja aberta: "Um consultor assume daqui, ta?". Com a loja fechada ou de madrugada: "Boa noite! Um consultor confirma com voce assim que a loja abrir." Se ficou visita marcada, repita o dia e a hora na despedida. O cliente nunca pode mandar uma mensagem e cair no silencio sem saber que voce saiu.

HORARIO NA CONVERSA:')
 where template like '%HORARIO NA CONVERSA:%'
   and template not like '%DESPEDIDA ANTES DE PASSAR PARA O CONSULTOR:%';

do $do$
declare v_novo int; v_hor int;
begin
  select count(*) into v_novo from public.prompt_templates where template like '%DESPEDIDA ANTES DE PASSAR PARA O CONSULTOR:%';
  select count(*) into v_hor  from public.prompt_templates where template like '%HORARIO NA CONVERSA:%';
  if v_novo <> 3 then raise exception 'Esperava 3 templates com a despedida, achei %', v_novo; end if;
  if v_hor  <> 3 then raise exception 'HORARIO NA CONVERSA sumiu de algum template: achei %', v_hor; end if;
end
$do$;

update public.tenant_agents set system_prompt = system_prompt;
