-- Compra e consignacao do carro do cliente (01/10).
--
-- 1) Ficha da loja: se a loja compra carro, como compra, as condicoes da consignacao
--    e as regras para receber carro. Entra nos DADOS DA LOJA e na ferramenta da loja.
-- 2) Carros oferecidos: o agente de Captacao registra aqui o carro que o cliente quer
--    vender ou deixar em consignacao (dados, preco pedido, fotos). A Julia nunca fecha:
--    o consultor avalia e acompanha pelo painel.
--
-- Ja aplicada no banco, menos a nova simulador_sincroniza (so serve para copiar a loja
-- para o simulador): rodar esse trecho pelo SQL editor do Supabase quando precisar.

alter table public.stores
  add column if not exists buys_cars boolean not null default false,
  add column if not exists purchase_details text,
  add column if not exists consignment_terms text,
  add column if not exists intake_rules text;

create table if not exists public.car_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  tipo text not null default 'indefinido' check (tipo in ('venda', 'consignacao', 'indefinido')),
  status text not null default 'novo' check (status in ('novo', 'em_avaliacao', 'comprado', 'consignado', 'recusado', 'desistiu')),
  cliente_nome text,
  cliente_telefone text,
  conversa_url text,
  marca text,
  modelo text,
  versao text,
  ano integer,
  km integer,
  cor text,
  estado text,
  quitado boolean,
  financiamento_detalhes text,
  historico text,
  documentacao text,
  preco_pedido numeric(12, 2),
  cidade text,
  urgencia text,
  observacoes text,
  fotos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists car_offers_tenant_status on public.car_offers (tenant_id, status, created_at desc);
create index if not exists car_offers_tenant_tel on public.car_offers (tenant_id, cliente_telefone);

alter table public.car_offers enable row level security;
revoke all on public.car_offers from anon, authenticated;
grant select, update, delete on public.car_offers to authenticated;
drop policy if exists car_offers_select on public.car_offers;
create policy car_offers_select on public.car_offers
  for select to authenticated using (public.owns_tenant(tenant_id));
drop policy if exists car_offers_update on public.car_offers;
create policy car_offers_update on public.car_offers
  for update to authenticated using (public.owns_tenant(tenant_id)) with check (public.owns_tenant(tenant_id));
drop policy if exists car_offers_delete on public.car_offers;
create policy car_offers_delete on public.car_offers
  for delete to authenticated using (public.owns_tenant(tenant_id));

-- A Julia registra e atualiza o carro oferecido. Uma oferta aberta por cliente: chamadas
-- seguintes completam o mesmo registro (campo vazio nunca apaga o que ja tinha).
create or replace function public.registrar_carro_oferecido(
  p_tenant uuid,
  p_telefone text,
  p_dados jsonb default '{}'::jsonb,
  p_fotos text[] default null,
  p_conversa_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tel text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
  v_id uuid;
  d jsonb := coalesce(p_dados, '{}'::jsonb);
  v_txt text;
  v_tipo text;
  v_quitado boolean;
  v_ano integer;
  v_km integer;
  v_preco numeric;
  v_fotos jsonb := coalesce(to_jsonb(p_fotos), '[]'::jsonb);
begin
  if p_tenant is null then
    return jsonb_build_object('ok', false, 'mensagem', 'Loja nao identificada.');
  end if;

  v_tipo := lower(btrim(coalesce(d->>'tipo', '')));
  v_tipo := case when v_tipo like 'consig%' then 'consignacao' when v_tipo like 'vend%' or v_tipo like 'compr%' then 'venda' else null end;
  v_txt := lower(btrim(coalesce(d->>'quitado', '')));
  v_quitado := case when v_txt in ('sim', 'true', 'quitado', 's') then true when v_txt in ('nao', 'não', 'false', 'financiado', 'n') then false else null end;
  v_ano := substring(coalesce(d->>'ano', '') from '(\d{4})')::integer;
  if v_ano is not null and (v_ano < 1950 or v_ano > 2100) then v_ano := null; end if;
  v_km := nullif(regexp_replace(coalesce(d->>'km', ''), '\D', '', 'g'), '')::bigint::integer;
  if v_km is not null and v_km < 1000 and coalesce(d->>'km', '') ~* 'mil' then v_km := v_km * 1000; end if;
  v_txt := regexp_replace(coalesce(d->>'preco_pedido', ''), '[^0-9,\.]', '', 'g');
  v_txt := case when v_txt ~ ',\d{1,2}$' then replace(replace(v_txt, '.', ''), ',', '.') else replace(replace(v_txt, '.', ''), ',', '') end;
  v_preco := nullif(v_txt, '')::numeric;
  if v_preco is not null and v_preco < 1000 and coalesce(d->>'preco_pedido', '') ~* 'mil' then v_preco := v_preco * 1000; end if;

  select id into v_id
    from public.car_offers
   where tenant_id = p_tenant
     and v_tel is not null
     and regexp_replace(coalesce(cliente_telefone, ''), '\D', '', 'g') = v_tel
     and status in ('novo', 'em_avaliacao')
     and created_at > now() - interval '30 days'
   order by created_at desc
   limit 1;

  if v_id is null then
    insert into public.car_offers (tenant_id, cliente_telefone, conversa_url) values (p_tenant, v_tel, nullif(btrim(coalesce(p_conversa_url, '')), ''))
    returning id into v_id;
  end if;

  update public.car_offers o set
    tipo = coalesce(v_tipo, o.tipo),
    cliente_nome = coalesce(nullif(btrim(d->>'cliente_nome'), ''), o.cliente_nome),
    conversa_url = coalesce(o.conversa_url, nullif(btrim(coalesce(p_conversa_url, '')), '')),
    marca = coalesce(nullif(btrim(d->>'marca'), ''), o.marca),
    modelo = coalesce(nullif(btrim(d->>'modelo'), ''), o.modelo),
    versao = coalesce(nullif(btrim(d->>'versao'), ''), o.versao),
    ano = coalesce(v_ano, o.ano),
    km = coalesce(v_km, o.km),
    cor = coalesce(nullif(btrim(d->>'cor'), ''), o.cor),
    estado = coalesce(nullif(btrim(d->>'estado'), ''), o.estado),
    quitado = coalesce(v_quitado, o.quitado),
    financiamento_detalhes = coalesce(nullif(btrim(d->>'financiamento_detalhes'), ''), o.financiamento_detalhes),
    historico = coalesce(nullif(btrim(d->>'historico'), ''), o.historico),
    documentacao = coalesce(nullif(btrim(d->>'documentacao'), ''), o.documentacao),
    preco_pedido = coalesce(v_preco, o.preco_pedido),
    cidade = coalesce(nullif(btrim(d->>'cidade'), ''), o.cidade),
    urgencia = coalesce(nullif(btrim(d->>'urgencia'), ''), o.urgencia),
    observacoes = coalesce(nullif(btrim(d->>'observacoes'), ''), o.observacoes),
    fotos = (select coalesce(jsonb_agg(distinct f), '[]'::jsonb)
               from jsonb_array_elements_text(o.fotos || v_fotos) f
              where f ~ '^https?://'),
    updated_at = now()
  where o.id = v_id;

  return jsonb_build_object('ok', true, 'id', v_id,
    'mensagem', 'Carro registrado para o consultor. Siga a conversa normalmente; nunca fale de painel nem de registro ao cliente.');
end;
$function$;

revoke all on function public.registrar_carro_oferecido(uuid, text, jsonb, text[], text) from public, anon, authenticated;
grant execute on function public.registrar_carro_oferecido(uuid, text, jsonb, text[], text) to service_role;

-- DADOS DA LOJA no prompt: compra de carro, consignacao com condicoes e regras para receber carro.
create or replace function public.render_agent_prompt(p_tenant uuid, p_agent_type text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ph_loja constant text := chr(123) || chr(123) || 'LOJA' || chr(125) || chr(125);
  ph_endereco constant text := chr(123) || chr(123) || 'ENDERECO_SUFIXO' || chr(125) || chr(125);
  ph_dados constant text := chr(123) || chr(123) || 'DADOS_DA_LOJA' || chr(125) || chr(125);
  v_tpl text;
  v_store public.stores%rowtype;
  v_set public.tenant_settings%rowtype;
  v_nome text;
  v_end text;
  v_laudo text;
  v_linhas text[] := '{}';
begin
  if auth.uid() is not null and not public.owns_tenant(p_tenant) then
    raise exception 'Sem permissao para este tenant.';
  end if;
  select template into v_tpl from public.prompt_templates where agent_type = p_agent_type;
  if v_tpl is null then return null; end if;
  select * into v_store from public.stores where tenant_id = p_tenant order by created_at limit 1;
  select * into v_set from public.tenant_settings where tenant_id = p_tenant;
  select nullif(btrim(t.nome), '') into v_nome from public.tenants t where t.id = p_tenant;
  v_nome := coalesce(nullif(btrim(coalesce(v_store.name, '')), ''), v_nome, 'a loja');
  v_end := nullif(btrim(concat_ws(', ',
    nullif(btrim(coalesce(v_store.address_street, '')), ''),
    nullif(btrim(coalesce(v_store.address_number, '')), ''),
    nullif(btrim(coalesce(v_store.address_complement, '')), ''),
    nullif(btrim(coalesce(v_store.address_district, '')), ''),
    nullif(btrim(coalesce(v_store.address_city, '')), ''),
    nullif(btrim(coalesce(v_store.address_state, '')), ''))), '');
  if v_end is null then v_end := nullif(btrim(coalesce(v_set.endereco_loja, '')), ''); end if;
  if v_end is not null then v_linhas := v_linhas || ('- Endereco da loja: ' || v_end); end if;
  if nullif(btrim(coalesce(v_set.horario_atendimento, '')), '') is not null then
    v_linhas := v_linhas || ('- Horario de atendimento: ' || case when v_set.horario_atendimento = '24h' then '24 horas por dia' else v_set.horario_atendimento end);
  end if;
  if v_store.id is not null then
    if nullif(btrim(coalesce(v_store.business_hours_text, '')), '') is not null then
      v_linhas := v_linhas || ('- Horario de funcionamento da loja: ' || btrim(v_store.business_hours_text));
    end if;
    if nullif(btrim(coalesce(v_store.legal_name, '')), '') is not null then v_linhas := v_linhas || ('- Razao social: ' || btrim(v_store.legal_name)); end if;
    if nullif(btrim(coalesce(v_store.cnpj, '')), '') is not null then v_linhas := v_linhas || ('- CNPJ: ' || btrim(v_store.cnpj)); end if;
    if nullif(btrim(coalesce(v_store.phone, '')), '') is not null then v_linhas := v_linhas || ('- Telefone da loja: ' || v_store.phone); end if;
    if nullif(btrim(coalesce(v_store.whatsapp, '')), '') is not null then v_linhas := v_linhas || ('- WhatsApp comercial: ' || v_store.whatsapp); end if;
    if nullif(btrim(coalesce(v_store.email, '')), '') is not null then v_linhas := v_linhas || ('- E-mail: ' || btrim(v_store.email)); end if;
    if public.link_publico(v_store.website) is not null then v_linhas := v_linhas || ('- Site: ' || public.link_publico(v_store.website)); end if;
    if public.arroba_publica(v_store.instagram) is not null then v_linhas := v_linhas || ('- Instagram: @' || public.arroba_publica(v_store.instagram)); end if;
    if public.link_publico(v_store.maps_url) is not null then v_linhas := v_linhas || ('- Link do mapa: ' || public.link_publico(v_store.maps_url)); end if;
    if coalesce(array_length(v_store.partner_banks, 1), 0) > 0 then v_linhas := v_linhas || ('- Bancos parceiros: ' || array_to_string(v_store.partner_banks, ', ')); end if;
    if coalesce(array_length(v_store.payment_methods, 1), 0) > 0 then v_linhas := v_linhas || ('- Formas de pagamento: ' || array_to_string(v_store.payment_methods, ', ')); end if;
    if coalesce(array_length(v_store.vehicle_categories, 1), 0) > 0 then v_linhas := v_linhas || ('- Categorias de veiculo: ' || array_to_string(v_store.vehicle_categories, ', ')); end if;
    if coalesce(array_length(v_store.vehicle_conditions, 1), 0) > 0 then v_linhas := v_linhas || ('- Condicoes dos veiculos: ' || array_to_string(v_store.vehicle_conditions, ', ')); end if;
    v_linhas := v_linhas || ('- Troca: ' || case when coalesce(v_store.accepts_trade, false) then 'aceita o carro do cliente como parte do pagamento' else 'a loja nao trabalha com troca' end);
    if coalesce(v_store.offers_financing, false) then v_linhas := v_linhas || '- Financiamento: disponivel'::text; end if;
    if coalesce(v_store.buys_cars, false) then
      v_linhas := v_linhas || ('- Compra de carros: a loja compra o carro do cliente' || coalesce(' -- ' || nullif(btrim(coalesce(v_store.purchase_details, '')), ''), ''));
    end if;
    if coalesce(v_store.offers_consignment, false) then
      v_linhas := v_linhas || ('- Consignacao: a loja aceita veiculos em consignacao' || coalesce(' -- ' || nullif(btrim(coalesce(v_store.consignment_terms, '')), ''), ''));
    end if;
    if (coalesce(v_store.buys_cars, false) or coalesce(v_store.offers_consignment, false))
       and nullif(btrim(coalesce(v_store.intake_rules, '')), '') is not null then
      v_linhas := v_linhas || ('- Para receber carro (compra ou consignacao): ' || btrim(v_store.intake_rules));
    end if;
    if coalesce(v_store.works_with_auction, false) then v_linhas := v_linhas || '- Leilao: a loja tambem trabalha com veiculos de leilao, sempre informado ao cliente'::text; end if;
    if coalesce(v_store.offers_test_drive, false) then v_linhas := v_linhas || '- Test-drive: disponivel'::text; end if;
    if coalesce(v_store.offers_delivery, false) then
      v_linhas := v_linhas || ('- Entrega: a loja entrega o veiculo na casa do cliente' || coalesce(' -- ' || nullif(btrim(coalesce(v_store.delivery_details, '')), ''), ''));
    end if;
    if coalesce(v_store.offers_documentation, false) then
      v_linhas := v_linhas || ('- Documentacao: a loja cuida da transferencia' || coalesce(' -- ' || nullif(btrim(coalesce(v_store.documentation_details, '')), ''), ''));
    end if;
    if coalesce(v_store.has_inspection, false) then
      v_laudo := case v_store.inspection_type
        when 'completo' then 'todos os veiculos tem laudo cautelar completo aprovado'
        when 'pesquisa' then 'todos os veiculos passam por pesquisa veicular'
        else null end;
      if v_laudo is not null then v_linhas := v_linhas || ('- Laudo: ' || v_laudo); end if;
    end if;
    if coalesce(v_store.accepts_own_inspection, false) then
      v_linhas := v_linhas || '- Vistoria de confianca: o cliente pode levar o carro a uma vistoria ou laudo de confianca antes de fechar'::text;
    end if;
    if coalesce(v_store.warranty_months, 0) > 0 then
      v_linhas := v_linhas || ('- Garantia: ' || v_store.warranty_months || ' meses' || coalesce(' (' || nullif(btrim(coalesce(v_store.warranty_details, '')), '') || ')', ''));
    end if;
    if nullif(btrim(coalesce(v_store.discount_policy, '')), '') is not null then v_linhas := v_linhas || ('- Desconto: ' || btrim(v_store.discount_policy)); end if;
    if nullif(btrim(coalesce(v_store.consortium_details, '')), '') is not null then v_linhas := v_linhas || ('- Consorcio: ' || btrim(v_store.consortium_details)); end if;
    if nullif(btrim(coalesce(v_store.differentials, '')), '') is not null then v_linhas := v_linhas || ('- Sobre a loja: ' || btrim(v_store.differentials)); end if;
    if nullif(btrim(coalesce(v_store.service_notes, '')), '') is not null then v_linhas := v_linhas || ('- Regras importantes da loja: ' || btrim(v_store.service_notes)); end if;
  end if;
  if coalesce(array_length(v_linhas, 1), 0) = 0 then
    v_tpl := replace(v_tpl, chr(10) || chr(10) || 'DADOS DA LOJA (preenchidos no painel):' || chr(10) || ph_dados, '');
  else
    v_tpl := replace(v_tpl, ph_dados, array_to_string(v_linhas, chr(10)));
  end if;
  v_tpl := replace(v_tpl, ph_endereco, case when v_end is null then '' else ' - ' || v_end end);
  v_tpl := replace(v_tpl, ph_loja, v_nome);
  return v_tpl;
end;
$function$;

-- Ferramenta da loja: os mesmos campos.
create or replace function public.api_loja(p_tenant uuid)
returns jsonb
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  select jsonb_build_object(
    'loja', jsonb_build_object(
      'nome', s.name,
      'cnpj', s.cnpj,
      'telefone', s.phone,
      'endereco', nullif(
        concat_ws(', ', s.address_street, s.address_number, s.address_district,
                        s.address_city, s.address_state), ''),
      'horario_de_funcionamento', s.business_hours_text,
      'horario_atendimento', coalesce(ts.horario_atendimento, '24h')
    ),
    'condicoes', jsonb_strip_nulls(jsonb_build_object(
      'bancos_parceiros', coalesce(s.partner_banks, array[]::text[]),
      'formas_pagamento', coalesce(s.payment_methods, array[]::text[]),
      'garantia_meses', s.warranty_months,
      'garantia_detalhes', nullif(btrim(coalesce(s.warranty_details, '')), ''),
      'aceita_troca', s.accepts_trade,
      'aceita_consignacao', s.offers_consignment,
      'compra_carro_do_cliente', case when s.buys_cars then true end,
      'compra_detalhes', case when s.buys_cars then nullif(btrim(coalesce(s.purchase_details, '')), '') end,
      'consignacao_detalhes', case when s.offers_consignment then nullif(btrim(coalesce(s.consignment_terms, '')), '') end,
      'regras_para_receber_carro', nullif(btrim(coalesce(s.intake_rules, '')), ''),
      'trabalha_com_carro_de_leilao', s.works_with_auction,
      'laudo_cautelar', case when s.has_inspection then s.inspection_type else null end,
      -- So quando a loja marcou que aceita: desmarcado e "nao informado" (o consultor confirma),
      -- nunca "a loja nao aceita".
      'aceita_vistoria_de_confianca', case when s.accepts_own_inspection then true end,
      'faz_test_drive', s.offers_test_drive,
      'faz_entrega', s.offers_delivery,
      'entrega_detalhes', nullif(btrim(coalesce(s.delivery_details, '')), ''),
      'cuida_da_documentacao', s.offers_documentation,
      'documentacao_detalhes', nullif(btrim(coalesce(s.documentation_details, '')), ''),
      'politica_de_desconto', nullif(btrim(coalesce(s.discount_policy, '')), ''),
      'consorcio_detalhes', nullif(btrim(coalesce(s.consortium_details, '')), '')
    ))
  )
  from public.stores s
  left join public.tenant_settings ts on ts.tenant_id = s.tenant_id
  where s.tenant_id = p_tenant
  limit 1
$function$;

-- O simulador copia tambem os campos novos da loja.
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

-- Remonta os prompts.
update public.tenant_agents set system_prompt = system_prompt;
