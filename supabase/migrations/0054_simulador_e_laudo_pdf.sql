-- Simulador da Julia e envio do PDF do laudo (01/10).
--
-- 1) api_laudo_pdf: a Julia escreve [LAUDO:<id>] e o fluxo busca aqui a URL do PDF.
--    Sempre devolve uma linha (ok false quando nao ha PDF), para o envio das outras
--    mensagens nunca travar.
-- 2) Simulador: uma loja-espelho (tenant com slug 'simulador-...') com o mesmo cadastro,
--    estoque, fotos e base de conhecimento da loja de origem, ligada a uma caixa de API
--    do Chatwoot sem WhatsApp. Conversas roteirizadas entram por ela e passam pela
--    Julia de verdade (mesmo fluxo, mesmos prompts), sem vendedor, sem agenda e sem
--    mexer no estoque da loja real. A loja-espelho nao tem dono: ninguem entra no
--    painel com ela.

create or replace function public.api_laudo_pdf(p_tenant uuid, p_car_id text)
returns jsonb
language sql
stable
set search_path = public
as $function$
  select coalesce((
    select jsonb_build_object(
      'ok', true,
      'url', c.laudo_pdf_url,
      'nome', initcap(concat_ws(' ', c.brand, c.model, coalesce(c.model_year, c.year)::text)))
      from public.cars c
     where c.tenant_id = p_tenant
       and c.id::text = lower(btrim(coalesce(p_car_id, '')))
       and c.laudo_pdf_url is not null
       and c.status <> 'vendido'
     limit 1
  ), jsonb_build_object('ok', false));
$function$;

revoke all on function public.api_laudo_pdf(uuid, text) from public, anon, authenticated;
grant execute on function public.api_laudo_pdf(uuid, text) to service_role;

-- Loja-espelho do simulador nao tem dono.
alter table public.stores alter column owner_id drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stores_dono_ou_simulador') then
    alter table public.stores add constraint stores_dono_ou_simulador
      check (owner_id is not null or slug like 'simulador-%');
  end if;
end $$;

-- Transcricao de cada conversa simulada (so o service role le e escreve).
create table if not exists public.simulador_execucoes (
  id uuid primary key default gen_random_uuid(),
  cenario text not null,
  status text not null default 'rodando',
  conversa_id bigint,
  contato_telefone text,
  transcricao jsonb not null default '[]'::jsonb,
  erro text,
  criado_em timestamptz not null default now(),
  terminado_em timestamptz
);
alter table public.simulador_execucoes enable row level security;

-- Copia o cadastro, o estoque (com fotos e laudo) e a base de conhecimento da loja de
-- origem para a loja-espelho. Rode antes de cada bateria de simulacoes.
create or replace function public.simulador_sincroniza(p_origem uuid, p_sim uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
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
    consortium_details = o.consortium_details
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
    rear_camera, laudo_resultado, laudo_empresa, laudo_data, laudo_obs, laudo_pdf_url)
  select
    m.novo, p_sim, v_store, case when c.external_id is null then null else 'sim-' || c.external_id end,
    c.brand, c.model, c.version, c.year, c.color, c.doors, c.transmission,
    c.body_type, c.fuel, c.mileage_km, c.price_brl, c.engine, c.cylinders, c.horsepower, c.torque,
    c.acceleration_0_100, c.aspiration, c.traction, c.air_conditioning, c.steering, c.electric_windows,
    c.ipva_paid, c.licensed, c.single_owner, c.dealer_revisions, c.accepts_trade, c.description,
    c.cover_url, c.status, c.model_year, c.sunroof, c.carplay_android_auto, c.trunk_liters,
    c.leather_seats, c.keyless_entry, c.parking_sensor, c.rear_camera, c.laudo_resultado,
    c.laudo_empresa, c.laudo_data, c.laudo_obs, c.laudo_pdf_url
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

revoke all on function public.simulador_sincroniza(uuid, uuid) from public, anon, authenticated;
grant execute on function public.simulador_sincroniza(uuid, uuid) to service_role;

-- Funcoes que o fluxo do simulador (n8n) chama -- so service role.
create or replace function public.simulador_config(p_slug text default 'simulador-w-multimarcas')
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select jsonb_build_object(
    'tenant_id', t.id,
    'base_url', s.chatwoot_base_url,
    'token', s.chatwoot_token,
    'account_id', coalesce(c.chatwoot_account_id, o.chatwoot_account_id),
    'inbox_id', c.chatwoot_inbox_id,
    'origem', s.extra->>'origem')
  from public.tenants t
  join public.tenant_settings s on s.tenant_id = t.id
  left join public.tenant_channels c on c.tenant_id = t.id
  left join public.tenant_channels o on o.tenant_id = (s.extra->>'origem')::uuid
  where t.slug = p_slug and t.slug like 'simulador-%'
  limit 1
$function$;

create or replace function public.simulador_liga_caixa(p_inbox_id bigint, p_slug text default 'simulador-w-multimarcas')
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tenant uuid;
  v_conta bigint;
begin
  select t.id, o.chatwoot_account_id into v_tenant, v_conta
    from public.tenants t
    join public.tenant_settings s on s.tenant_id = t.id
    join public.tenant_channels o on o.tenant_id = (s.extra->>'origem')::uuid
   where t.slug = p_slug and t.slug like 'simulador-%'
   limit 1;
  if v_tenant is null then raise exception 'simulador % nao encontrado', p_slug; end if;
  delete from public.tenant_channels where tenant_id = v_tenant;
  insert into public.tenant_channels (tenant_id, chatwoot_account_id, chatwoot_inbox_id, ativo)
  values (v_tenant, v_conta, p_inbox_id, true);
  return jsonb_build_object('ok', true, 'tenant_id', v_tenant, 'account_id', v_conta, 'inbox_id', p_inbox_id);
end;
$function$;

create or replace function public.simulador_inicia(p_cenario text, p_conversa bigint, p_telefone text)
returns jsonb
language sql
security definer
set search_path = public
as $function$
  insert into public.simulador_execucoes (cenario, conversa_id, contato_telefone)
  values (coalesce(nullif(btrim(p_cenario), ''), 'sem nome'), p_conversa, p_telefone)
  returning jsonb_build_object('id', id);
$function$;

create or replace function public.simulador_registra_turno(p_id uuid, p_turno jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $function$
  update public.simulador_execucoes
     set transcricao = transcricao || jsonb_build_array(p_turno)
   where id = p_id
  returning jsonb_build_object('ok', true, 'turnos', jsonb_array_length(transcricao));
$function$;

create or replace function public.simulador_finaliza(p_id uuid, p_status text default 'ok', p_erro text default null)
returns jsonb
language sql
security definer
set search_path = public
as $function$
  update public.simulador_execucoes
     set status = coalesce(p_status, 'ok'), erro = p_erro, terminado_em = now()
   where id = p_id
  returning jsonb_build_object('ok', true);
$function$;

do $$
declare f text;
begin
  foreach f in array array['simulador_config(text)', 'simulador_liga_caixa(bigint, text)', 'simulador_inicia(text, bigint, text)',
                           'simulador_registra_turno(uuid, jsonb)', 'simulador_finaliza(uuid, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- A loja-espelho (dados, nao estrutura) foi criada a parte, uma vez:
--   tenants/stores com slug 'simulador-w-multimarcas', tenant_settings copiado da origem
--   sem Evolution, sem agenda e sem follow-up (extra.origem = tenant da loja real),
--   tenant_agents dos 4 agentes. Depois: select simulador_sincroniza(<origem>, <simulador>);
