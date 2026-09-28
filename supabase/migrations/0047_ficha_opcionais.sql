-- 0047: opcionais na ficha do veiculo + ano do modelo para a Julia
--
-- O cadastro passa a pedir so o ANO DO MODELO (o painel grava o mesmo valor em
-- `year`, que e o que a busca e a Julia ja leem). E a ficha ganha os itens que o
-- cliente mais pergunta no WhatsApp: multimidia com CarPlay/Android Auto,
-- porta-malas, banco de couro, chave presencial, sensor e camera de re.
-- `sunroof` ja existia no banco mas nao aparecia no painel nem saia para a Julia.

alter table public.cars
  add column if not exists carplay_android_auto text,
  add column if not exists trunk_liters integer,
  add column if not exists leather_seats text,
  add column if not exists keyless_entry text,
  add column if not exists parking_sensor text,
  add column if not exists rear_camera text;

comment on column public.cars.sunroof is 'Teto solar: Não possui, Teto solar, Panorâmico';
comment on column public.cars.carplay_android_auto is 'Apple CarPlay / Android Auto: Sem fio, Com fio, Não possui';
comment on column public.cars.trunk_liters is 'Porta-malas em litros';
comment on column public.cars.leather_seats is 'Banco de couro: Sim, Não';
comment on column public.cars.keyless_entry is 'Chave presencial: Sim, Não';
comment on column public.cars.parking_sensor is 'Sensor de estacionamento: Traseiro, Dianteiro e traseiro, Não possui';
comment on column public.cars.rear_camera is 'Câmera de ré: Sim, Não';

-- Cadastros antigos que so tinham ano de fabricacao ficam com o ano do modelo igual.
update public.cars set model_year = year where model_year is null and year is not null;

create or replace function public.api_cars(
  p_tenant uuid,
  p_model text default null,
  p_status text default 'ativo',
  p_com_fotos boolean default true
)
returns jsonb
language sql
stable
as $function$
  with elegiveis as (
    select c.*
      from public.cars c
     where c.tenant_id = p_tenant
       and (p_status is null or p_status = '' or c.status = p_status)
  ),
  casaram as (
    select e.*
      from elegiveis e
     where p_model is null
        or btrim(p_model) = ''
        or coalesce((
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
     where not (select sim from houve)
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
        -- `year` e o ano que a Julia fala para o cliente: o ano do modelo.
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
        'photos_count', c.qtd_fotos,
        'tem_fotos', c.qtd_fotos > 0,
        'marcador_fotos', case when c.qtd_fotos > 0 then '[FOTOS:' || c.id::text || ']' end,
        'marcador_capa',  case when c.qtd_fotos > 0 then '[CAPA:'  || c.id::text || ']' end,
        'filtro', c.busca_filtro
      )
      ||
      case when p_com_fotos then jsonb_build_object(
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
