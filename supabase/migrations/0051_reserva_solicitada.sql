-- Pedido de reserva feito pelo cliente no WhatsApp ("reserva solicitada").
--
-- Quando o cliente pede para segurar o carro ou dar sinal, a Julia registra o
-- pedido aqui e avisa o vendedor na hora. O carro CONTINUA A VENDA: pedido nao
-- e sinal. So quando o vendedor recebe o sinal e clica "Deu sinal" no painel o
-- carro vira 'reservado' e sai da IA. Pedido que ninguem confirma expira sozinho
-- (24 h por padrao) -- o painel e a Julia so consideram pedido com
-- reserva_expira_em no futuro, entao nao precisa de rotina para limpar.

alter table public.cars
  add column if not exists reserva_solicitada_em timestamptz,
  add column if not exists reserva_expira_em timestamptz,
  add column if not exists reserva_cliente text,
  add column if not exists reserva_telefone text,
  add column if not exists reserva_conversa_url text,
  add column if not exists reserva_obs text;

comment on column public.cars.reserva_expira_em is
  'Pedido de reserva feito pelo cliente no WhatsApp (via Julia), valido ate esta hora. O carro continua a venda ate o vendedor clicar Deu sinal.';

-- Mudou o status: o pedido pendente termina.
-- Deu sinal (-> reservado): guarda quem pediu, se o pedido ainda valia, e tira o prazo.
-- Retomar venda (-> ativo) ou Vendido: limpa tudo.
create or replace function public.cars_fecha_pedido_reserva()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'reservado' and old.reserva_expira_em is not null and old.reserva_expira_em > now() then
    new.reserva_expira_em := null;
  else
    new.reserva_solicitada_em := null;
    new.reserva_expira_em := null;
    new.reserva_cliente := null;
    new.reserva_telefone := null;
    new.reserva_conversa_url := null;
    new.reserva_obs := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists cars_fecha_pedido_reserva on public.cars;
create trigger cars_fecha_pedido_reserva
  before update of status on public.cars
  for each row execute function public.cars_fecha_pedido_reserva();

-- Chamada pela Julia (n8n, chave de servico). Nunca muda o status do carro.
create or replace function public.solicitar_reserva(
  p_tenant uuid,
  p_car_id uuid,
  p_cliente text default null,
  p_telefone text default null,
  p_conversa_url text default null,
  p_obs text default null,
  p_horas integer default 24
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  c public.cars%rowtype;
  v_expira timestamptz;
  v_nome text;
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

revoke all on function public.solicitar_reserva(uuid, uuid, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.solicitar_reserva(uuid, uuid, text, text, text, text, integer) to service_role;

-- Estoque da Julia: carro com sinal (reservado) nao entra na lista geral, mas
-- aparece quando o cliente procura por ele -- para ela dizer que esta reservado
-- e oferecer parecidos, em vez de dizer que a loja nao tem.
create or replace function public.api_cars(p_tenant uuid, p_model text default null, p_status text default 'ativo', p_com_fotos boolean default true)
returns jsonb
language sql
stable
set search_path = public, extensions
as $function$
  with elegiveis as (
    select c.*,
           (c.status = 'reservado' and coalesce(p_status, '') = 'ativo') as extra
      from public.cars c
     where c.tenant_id = p_tenant
       and (p_status is null or p_status = '' or c.status = p_status
            or (p_status = 'ativo' and c.status = 'reservado'))
  ),
  casaram as (
    select e.*
      from elegiveis e
     where (p_model is null or btrim(p_model) = '')
       and not e.extra
     union all
    select e.*
      from elegiveis e
     where p_model is not null
       and btrim(p_model) <> ''
       and coalesce((
             select bool_and(
               public.normaliza_busca(
                 coalesce(e.brand, '') || ' ' || coalesce(e.model, '') || ' ' ||
                 coalesce(e.version, '') || ' ' || coalesce(e.body_type, '') || ' ' ||
                 coalesce(e.transmission, '') || ' ' || coalesce(e.fuel, '') || ' ' ||
                 coalesce(e.engine, '') || ' ' || coalesce(e.color, '') || ' ' ||
                 coalesce(e.year::text, '') || ' ' || coalesce(e.model_year::text, '')
               ) like '%' || public.normaliza_busca(w) || '%'
             )
             from unnest(string_to_array(btrim(p_model), ' ')) as w
             where btrim(w) <> ''
           ), true)
  ),
  houve as (
    select exists (select 1 from casaram) as sim
  ),
  escolhidos as (
    select e.*,
           case when (select sim from houve) then 'correspondencia' else 'sem_correspondencia' end
             as busca_filtro,
           (select count(*) from public.car_photos p where p.car_id = e.id) as qtd_fotos
      from elegiveis e
     where ((not (select sim from houve)) and not e.extra)
        or exists (select 1 from casaram m where m.id = e.id)
  )
  select jsonb_build_object(
    'cars',
    coalesce(jsonb_agg(x order by x->>'brand', x->>'model'), '[]'::jsonb)
  )
  from (
    select (
      jsonb_build_object(
        'id', c.id::text,
        'brand', c.brand,
        'model', c.model,
        'version', c.version,
        'year', coalesce(c.model_year, c.year),
        'model_year', coalesce(c.model_year, c.year),
        'color', c.color,
        'doors', c.doors,
        'transmission', c.transmission,
        'body_type', c.body_type,
        'fuel', c.fuel,
        'mileage_km', c.mileage_km,
        'price_brl', c.price_brl,
        'engine', c.engine,
        'cylinders', c.cylinders,
        'horsepower', c.horsepower,
        'torque', c.torque,
        'acceleration_0_100', c.acceleration_0_100,
        'aspiration', c.aspiration,
        'traction', c.traction,
        'air_conditioning', c.air_conditioning,
        'steering', c.steering,
        'electric_windows', c.electric_windows,
        'sunroof', c.sunroof,
        'carplay_android_auto', c.carplay_android_auto,
        'trunk_liters', c.trunk_liters,
        'leather_seats', c.leather_seats,
        'keyless_entry', c.keyless_entry,
        'parking_sensor', c.parking_sensor,
        'rear_camera', c.rear_camera,
        'ipva_paid', c.ipva_paid,
        'licensed', c.licensed,
        'single_owner', c.single_owner,
        'dealer_revisions', c.dealer_revisions,
        'accepts_trade', c.accepts_trade,
        'description', c.description,
        'status', c.status,
        'disponibilidade', case
          when c.status = 'reservado' then 'reservado_com_sinal'
          when c.reserva_expira_em > now() then 'reserva_solicitada'
          else 'disponivel' end,
        'photos_count', c.qtd_fotos,
        'tem_fotos', c.qtd_fotos > 0,
        'marcador_fotos', case when c.qtd_fotos > 0 and c.status <> 'reservado' then '[FOTOS:' || c.id::text || ']' end,
        'marcador_capa',  case when c.qtd_fotos > 0 and c.status <> 'reservado' then '[CAPA:'  || c.id::text || ']' end,
        'filtro', c.busca_filtro
      )
      ||
      case when p_com_fotos and c.status <> 'reservado' then jsonb_build_object(
        'cover_url', c.cover_url,
        'photos', coalesce((
          select jsonb_agg(jsonb_build_object('url', p.url, 'position', p.ordem, 'is_cover', p.is_cover)
                           order by p.is_cover desc, p.ordem)
          from public.car_photos p where p.car_id = c.id
        ), '[]'::jsonb)
      ) else '{}'::jsonb end
    ) as x
    from escolhidos c
  ) q
$function$;
