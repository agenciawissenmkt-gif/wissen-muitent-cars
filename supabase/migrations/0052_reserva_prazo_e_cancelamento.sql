-- Reserva pelo WhatsApp, ajustes do teste de 30/09.
--
-- 1) O pedido expirava sempre em 24 h, mesmo quando o cliente pedia "segura ate
--    sabado" ou tinha visita marcada depois disso. Agora a Julia informa p_ate (o
--    dia ate quando ele quer segurar): o pedido vale ate o fim desse dia, no fuso
--    da loja, com no minimo 24 h e no maximo 7 dias.
-- 2) Quando o cliente desistia ("pode liberar"), a Julia nao tinha como desfazer o
--    pedido: o selo "Reserva solicitada" ficava no painel ate expirar. Nova funcao
--    cancelar_pedido_reserva: so apaga o pedido pendente do PROPRIO cliente (mesmo
--    telefone). Carro com sinal nao e desfeito pela IA: quem desfaz e o consultor.

drop function if exists public.solicitar_reserva(uuid, uuid, text, text, text, text, integer);

create or replace function public.solicitar_reserva(
  p_tenant uuid,
  p_car_id uuid,
  p_cliente text default null,
  p_telefone text default null,
  p_conversa_url text default null,
  p_obs text default null,
  p_horas integer default 24,
  p_ate date default null
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  c public.cars%rowtype;
  v_expira timestamptz;
  v_fim timestamptz;
  v_nome text;
  v_tz text;
begin
  select * into c from public.cars where id = p_car_id and tenant_id = p_tenant for update;
  if not found then
    return jsonb_build_object('ok', false, 'situacao', 'nao_encontrado',
      'mensagem', 'Esse carro nao esta no estoque desta loja. Pegue o id certo na ferramenta de estoque e tente de novo.');
  end if;

  v_nome := concat_ws(' ', c.brand, c.model, coalesce(c.model_year, c.year)::text, c.color);

  if c.status = 'vendido' then
    return jsonb_build_object('ok', false, 'situacao', 'vendido', 'carro', v_nome,
      'mensagem', 'Esse carro ja foi vendido. Diga isso com jeito e ofereca parecidos do estoque.');
  end if;

  if c.status = 'reservado' then
    return jsonb_build_object('ok', false, 'situacao', 'ja_reservado', 'carro', v_nome,
      'mensagem', 'Esse carro ja esta reservado: outro cliente deu sinal. Diga que ele esta reservado, ofereca parecidos do estoque e, se o cliente quiser, anote na nota que ele quer ser avisado se o carro voltar a ficar disponivel.');
  end if;

  if c.reserva_expira_em > now()
     and nullif(btrim(p_telefone), '') is distinct from c.reserva_telefone then
    return jsonb_build_object('ok', true, 'situacao', 'outro_pedido', 'carro', v_nome,
      'mensagem', 'Ja existe um pedido de reserva de outro cliente para esse carro, ainda sem sinal: o carro continua a venda. Registre o interesse deste cliente na nota para o consultor e siga como pedido de reserva. Nunca fale do outro cliente.');
  end if;

  v_expira := now() + make_interval(hours => greatest(1, least(coalesce(p_horas, 24), 168)));

  if p_ate is not null then
    select coalesce(nullif(t.timezone, ''), 'America/Sao_Paulo') into v_tz from public.tenants t where t.id = p_tenant;
    v_fim := ((p_ate + 1)::timestamp) at time zone coalesce(v_tz, 'America/Sao_Paulo');
    v_expira := greatest(now() + interval '24 hours', least(v_fim, now() + interval '7 days'));
  end if;

  update public.cars
     set reserva_solicitada_em = now(),
         reserva_expira_em = v_expira,
         reserva_cliente = nullif(btrim(p_cliente), ''),
         reserva_telefone = nullif(btrim(p_telefone), ''),
         reserva_conversa_url = nullif(btrim(p_conversa_url), ''),
         reserva_obs = left(nullif(btrim(p_obs), ''), 500)
   where id = c.id;

  return jsonb_build_object('ok', true, 'situacao', 'registrado', 'carro', v_nome, 'expira_em', v_expira,
    'mensagem', 'Pedido de reserva registrado no painel. O carro continua a venda ate o consultor confirmar o sinal. Agora deixe a nota [RESERVA] e escreva [TRANSFERIR:reserva|auto]; ao cliente, diga que o consultor ja foi avisado e confirma com ele como fica o sinal. Nunca passe chave Pix nem valor de sinal.');
end;
$function$;

revoke all on function public.solicitar_reserva(uuid, uuid, text, text, text, text, integer, date) from public, anon, authenticated;
grant execute on function public.solicitar_reserva(uuid, uuid, text, text, text, text, integer, date) to service_role;

create or replace function public.cancelar_pedido_reserva(
  p_tenant uuid,
  p_car_id uuid,
  p_telefone text default null
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  c public.cars%rowtype;
  v_nome text;
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_mesmo boolean;
begin
  select * into c from public.cars where id = p_car_id and tenant_id = p_tenant for update;
  if not found then
    return jsonb_build_object('ok', false, 'situacao', 'nao_encontrado',
      'mensagem', 'Esse carro nao esta no estoque desta loja. Pegue o id certo na ferramenta de estoque e tente de novo.');
  end if;

  v_nome := concat_ws(' ', c.brand, c.model, coalesce(c.model_year, c.year)::text, c.color);
  v_mesmo := length(v_tel) > 7 and regexp_replace(coalesce(c.reserva_telefone, ''), '\D', '', 'g') = v_tel;

  if c.status = 'reservado' and v_mesmo then
    return jsonb_build_object('ok', false, 'situacao', 'com_sinal', 'carro', v_nome,
      'mensagem', 'Esse carro ja esta reservado com o sinal deste cliente. Voce nao desfaz: quem desfaz a reserva e combina a devolucao do sinal e o consultor. Diga que avisou o consultor, deixe a nota [RESERVA] com a desistencia e escreva [TRANSFERIR:reserva|auto].');
  end if;

  if c.status = 'ativo' and c.reserva_expira_em > now() and v_mesmo then
    update public.cars
       set reserva_solicitada_em = null,
           reserva_expira_em = null,
           reserva_cliente = null,
           reserva_telefone = null,
           reserva_conversa_url = null,
           reserva_obs = null
     where id = c.id;
    return jsonb_build_object('ok', true, 'situacao', 'cancelado', 'carro', v_nome,
      'mensagem', 'Pedido cancelado: o carro ja voltou a venda no painel. Isso e interno da loja: ao cliente nao fale de pedido, painel, liberar nem segue a venda -- responda com empatia, numa frase, que pena que esse carro nao deu certo pra ele, e siga leve. Deixe a nota [RESERVA] com a desistencia para o consultor.');
  end if;

  return jsonb_build_object('ok', false, 'situacao', 'sem_pedido', 'carro', v_nome,
    'mensagem', 'Nao ha pedido de reserva deste cliente para esse carro. Nao cite outros clientes; siga a conversa.');
end;
$function$;

revoke all on function public.cancelar_pedido_reserva(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancelar_pedido_reserva(uuid, uuid, text) to service_role;
