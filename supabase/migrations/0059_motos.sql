-- 0059_motos.sql
--
-- Motos no estoque.
--
-- 1. Cadastro
--    tipo_veiculo separa carro de moto. O padrao e 'carro', entao todo o estoque
--    que ja existia continua exatamente igual. Campos que so a moto usa:
--    cilindrada_cc, estilo_moto, freio_abs e partida_eletrica. O resto (marca,
--    modelo, ano, km, preco, cambio, combustivel, potencia, torque, consumo,
--    documentacao, laudo, situacao financeira) e o mesmo campo do carro.
--
-- 2. api_cars (busca da Julia)
--    - devolve tipo_veiculo em todos os veiculos e, na moto, cilindrada, estilo,
--      ABS e partida eletrica. Campos que so existem em carro (portas, porta-malas,
--      ar-condicionado, teto solar...) saem do retorno da moto;
--    - "moto", "motos", "motocicleta", "cc" e "cilindrada" filtram pelo tipo, e
--      "carro"/"carros"/"automovel" tambem. Antes, "moto" casava com o "motor
--      eletrico" escrito no motor de carro hibrido;
--    - estilo (Scooter, Trail, Naked...) e cilindrada ("160cc") entram no texto
--      da busca.
--
-- 3. simulador_sincroniza copia os campos novos.
--
-- Aplicada no banco em 03/11/2026 em duas etapas: colunas, constraints e
-- simulador primeiro (invisiveis para a Julia); api_cars junto com as regras de
-- moto nos prompts.

-- 1. Cadastro -------------------------------------------------------------------

alter table public.cars
  add column if not exists tipo_veiculo text not null default 'carro',
  add column if not exists cilindrada_cc integer,
  add column if not exists estilo_moto text,
  add column if not exists freio_abs text,
  add column if not exists partida_eletrica text;

alter table public.cars drop constraint if exists cars_tipo_veiculo_check;
alter table public.cars add constraint cars_tipo_veiculo_check check (tipo_veiculo in ('carro', 'moto'));
alter table public.cars drop constraint if exists cars_cilindrada_cc_check;
alter table public.cars add constraint cars_cilindrada_cc_check check (cilindrada_cc is null or cilindrada_cc between 30 and 3000);

comment on column public.cars.tipo_veiculo is 'carro ou moto. Padrao carro: o estoque que ja existia continua igual.';
comment on column public.cars.cilindrada_cc is 'So moto: cilindrada em cc (ex.: 160).';
comment on column public.cars.estilo_moto is 'So moto: Street, Naked, Esportiva, Trail, Big Trail, Scooter, Motoneta, Custom, Touring ou Off Road.';
comment on column public.cars.freio_abs is 'So moto: Sim ou Nao.';
comment on column public.cars.partida_eletrica is 'So moto: Sim ou Nao.';

-- 2. Busca da Julia --------------------------------------------------------------

create or replace function public.api_cars(p_tenant uuid, p_model text default null::text, p_status text default 'ativo'::text, p_com_fotos boolean default true)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'extensions'
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
               case
                 -- 03/11: motos. "moto" e "carro" filtram pelo tipo do veiculo (no texto,
                 -- "moto" casava com o "motor eletrico" de carro hibrido).
                 when public.normaliza_busca(w) in ('moto', 'motos', 'motocicleta', 'motocicletas',
                                                    'motoca', 'motocas', 'cc', 'cilindrada', 'cilindradas')
                   then e.tipo_veiculo = 'moto'
                 when public.normaliza_busca(w) in ('carro', 'carros', 'automovel', 'automoveis')
                   then e.tipo_veiculo = 'carro'
                 else public.normaliza_busca(
                   coalesce(e.brand, '') || ' ' || coalesce(e.model, '') || ' ' ||
                   coalesce(e.version, '') || ' ' || coalesce(e.body_type, '') || ' ' ||
                   coalesce(e.transmission, '') || ' ' || coalesce(e.fuel, '') || ' ' ||
                   coalesce(e.engine, '') || ' ' || coalesce(e.color, '') || ' ' ||
                   coalesce(e.year::text, '') || ' ' || coalesce(e.model_year::text, '') || ' ' ||
                   coalesce(e.estilo_moto, '') || ' ' || coalesce(e.cilindrada_cc::text || 'cc', '')
                 ) like '%' || public.normaliza_busca(w) || '%'
               end
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
    -- 03/11: na moto saem os campos que so existem em carro.
    select case when b.tipo_veiculo = 'moto'
                then b.base - array['doors', 'body_type', 'traction', 'acceleration_0_100', 'aspiration',
                                    'air_conditioning', 'steering', 'electric_windows', 'sunroof',
                                    'carplay_android_auto', 'trunk_liters', 'leather_seats',
                                    'keyless_entry', 'parking_sensor', 'rear_camera']
                else b.base end as x
    from (
    select c.tipo_veiculo, (
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
        -- 28/10: marcacoes da loja que a Julia usa em sinistro, leilao e documentacao.
        'sinistro', coalesce(c.sinistro, false),
        'de_leilao', coalesce(c.de_leilao, false),
        'com_multas', coalesce(c.com_multas, false),
        -- 03/11: quitado ou financiado, como a loja marcou no cadastro (null = nao informado).
        'situacao_financeira', c.situacao_financeira,
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
        -- 01/10: laudo cautelar deste carro, quando a loja cadastrou.
        -- 02/10: laudo_texto = texto lido do PDF (so quando a busca traz ate 2 carros).
        'laudo', case when c.laudo_resultado is not null or c.laudo_pdf_url is not null then jsonb_strip_nulls(jsonb_build_object(
          'resultado', c.laudo_resultado,
          'empresa', nullif(btrim(coalesce(c.laudo_empresa, '')), ''),
          'data', to_char(c.laudo_data, 'DD/MM/YYYY'),
          'apontamentos', nullif(btrim(coalesce(c.laudo_obs, '')), ''),
          'laudo_texto', case when c.qtd_total <= 2 and c.laudo_texto_de = c.laudo_pdf_url then c.laudo_texto end,
          'tem_pdf', c.laudo_pdf_url is not null)) end,
        'marcador_laudo', case when c.laudo_pdf_url is not null and c.status <> 'reservado' then '[LAUDO:' || c.id::text || ']' end,
        'filtro', c.busca_filtro
      )
      || jsonb_strip_nulls(jsonb_build_object('consumo_cidade', c.consumo_cidade, 'consumo_estrada', c.consumo_estrada, 'nivel_consumo', c.nivel_consumo))
      -- 03/11: carro ou moto; na moto, cilindrada, estilo, ABS e partida eletrica.
      || jsonb_build_object('tipo_veiculo', c.tipo_veiculo)
      || jsonb_strip_nulls(jsonb_build_object('cilindrada_cc', c.cilindrada_cc, 'estilo_moto', c.estilo_moto,
                                              'freio_abs', c.freio_abs, 'partida_eletrica', c.partida_eletrica))
      ||
      case when p_com_fotos and c.status <> 'reservado' then jsonb_build_object(
        'cover_url', c.cover_url,
        'photos', coalesce((
          select jsonb_agg(jsonb_build_object('url', p.url, 'position', p.ordem, 'is_cover', p.is_cover)
                           order by p.is_cover desc, p.ordem)
          from public.car_photos p where p.car_id = c.id
        ), '[]'::jsonb)
      ) else '{}'::jsonb end
    ) as base
    from (select e.*, count(*) over () as qtd_total from escolhidos e) c
    ) b
  ) q
$function$;

-- 3. Simulador copia os campos novos ---------------------------------------------

create or replace function public.simulador_sincroniza(p_origem uuid, p_sim uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_store uuid;
  n_carros int;
  n_fotos int;
  n_faq int;
begin
  if not exists (select 1 from public.tenants where id = p_sim and slug like 'simulador-%') then
    raise exception 'O tenant % nao e de simulador.', p_sim;
  end if;

  select id into v_store from public.stores where tenant_id = p_sim;
  if v_store is null then
    raise exception 'O simulador % nao tem loja.', p_sim;
  end if;

  update public.stores d set
    name = o.name, legal_name = o.legal_name, cnpj = o.cnpj, phone = o.phone, whatsapp = o.whatsapp,
    email = o.email, website = o.website, instagram = o.instagram, logo_url = o.logo_url,
    address_street = o.address_street, address_number = o.address_number,
    address_complement = o.address_complement, address_district = o.address_district,
    address_city = o.address_city, address_state = o.address_state, address_zip = o.address_zip,
    maps_url = o.maps_url, has_inspection = o.has_inspection, inspection_type = o.inspection_type,
    warranty_months = o.warranty_months, warranty_details = o.warranty_details,
    vehicle_conditions = o.vehicle_conditions, vehicle_categories = o.vehicle_categories,
    accepts_trade = o.accepts_trade, offers_financing = o.offers_financing,
    offers_consignment = o.offers_consignment, offers_test_drive = o.offers_test_drive,
    offers_delivery = o.offers_delivery, offers_documentation = o.offers_documentation,
    payment_methods = o.payment_methods, differentials = o.differentials,
    service_notes = o.service_notes, business_hours = o.business_hours, timezone = o.timezone,
    works_with_auction = o.works_with_auction, partner_banks = o.partner_banks,
    business_hours_text = o.business_hours_text, delivery_details = o.delivery_details,
    documentation_details = o.documentation_details,
    accepts_own_inspection = o.accepts_own_inspection, discount_policy = o.discount_policy,
    consortium_details = o.consortium_details, buys_cars = o.buys_cars,
    purchase_details = o.purchase_details, consignment_terms = o.consignment_terms,
    intake_rules = o.intake_rules
  from public.stores o
  where o.tenant_id = p_origem and d.id = v_store;

  -- Estoque: refeito do zero. As fotos e o PDF do laudo apontam para os mesmos
  -- arquivos da loja de origem, sem storage_path (apagar no simulador nunca apaga o
  -- arquivo da loja real).
  delete from public.car_photos where tenant_id = p_sim;
  delete from public.cars where tenant_id = p_sim;

  create temp table _sim_mapa on commit drop as
    select id as velho, gen_random_uuid() as novo
      from public.cars
     where tenant_id = p_origem and status <> 'vendido';

  insert into public.cars (
    id, tenant_id, store_id, external_id, brand, model, version, year, color, doors, transmission,
    body_type, fuel, mileage_km, price_brl, engine, cylinders, horsepower, torque, acceleration_0_100,
    aspiration, traction, air_conditioning, steering, electric_windows, ipva_paid, licensed,
    single_owner, dealer_revisions, accepts_trade, description, cover_url, status, model_year,
    sunroof, carplay_android_auto, trunk_liters, leather_seats, keyless_entry, parking_sensor,
    rear_camera, laudo_resultado, laudo_empresa, laudo_data, laudo_obs, laudo_pdf_url,
    tipo_veiculo, cilindrada_cc, estilo_moto, freio_abs, partida_eletrica)
  select
    m.novo, p_sim, v_store, case when c.external_id is null then null else 'sim-' || c.external_id end,
    c.brand, c.model, c.version, c.year, c.color, c.doors, c.transmission,
    c.body_type, c.fuel, c.mileage_km, c.price_brl, c.engine, c.cylinders, c.horsepower, c.torque,
    c.acceleration_0_100, c.aspiration, c.traction, c.air_conditioning, c.steering, c.electric_windows,
    c.ipva_paid, c.licensed, c.single_owner, c.dealer_revisions, c.accepts_trade, c.description,
    c.cover_url, c.status, c.model_year, c.sunroof, c.carplay_android_auto, c.trunk_liters,
    c.leather_seats, c.keyless_entry, c.parking_sensor, c.rear_camera, c.laudo_resultado,
    c.laudo_empresa, c.laudo_data, c.laudo_obs, c.laudo_pdf_url,
    c.tipo_veiculo, c.cilindrada_cc, c.estilo_moto, c.freio_abs, c.partida_eletrica
  from public.cars c
  join _sim_mapa m on m.velho = c.id;
  get diagnostics n_carros = row_count;

  insert into public.car_photos (id, tenant_id, car_id, url, ordem, is_cover, storage_path)
  select gen_random_uuid(), p_sim, m.novo, p.url, p.ordem, p.is_cover, null
    from public.car_photos p
    join _sim_mapa m on m.velho = p.car_id;
  get diagnostics n_fotos = row_count;

  -- Base de conhecimento (a busca filtra por metadata.tenant_id).
  delete from public.faq_vec where tenant_id = p_sim;
  insert into public.faq_vec (tenant_id, content, metadata, embedding)
  select p_sim, f.content, jsonb_set(coalesce(f.metadata, '{}'::jsonb), '{tenant_id}', to_jsonb(p_sim::text)), f.embedding
    from public.faq_vec f
   where f.tenant_id = p_origem;
  get diagnostics n_faq = row_count;

  -- Prompts remontados com o cadastro copiado.
  update public.tenant_agents set system_prompt = system_prompt where tenant_id = p_sim;

  return jsonb_build_object('carros', n_carros, 'fotos', n_fotos, 'base_de_conhecimento', n_faq);
end;
$function$;
