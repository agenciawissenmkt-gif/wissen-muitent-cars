-- Ficha da loja mais completa e laudo cautelar por carro (01/10).
--
-- 1) Ficha da loja: a Julia respondia "o consultor confirma" para tudo o que o
--    painel nao dizia -- area e custo da entrega, quem paga a transferencia, se o
--    cliente pode levar o carro numa vistoria de confianca, como funciona desconto,
--    regras de consorcio. Agora a loja preenche e isso entra nos DADOS DA LOJA.
-- 2) Laudo por carro: antes so existia a regra geral da loja ("todos os veiculos
--    tem laudo cautelar completo aprovado"). Agora cada carro pode ter o proprio
--    laudo -- resultado, empresa, data, apontamentos e o PDF --, a Julia fala do
--    laudo daquele carro e envia o PDF pelo WhatsApp com o marcador [LAUDO:id].

alter table public.stores
  add column if not exists delivery_details text,
  add column if not exists documentation_details text,
  add column if not exists accepts_own_inspection boolean not null default false,
  add column if not exists discount_policy text,
  add column if not exists consortium_details text;

alter table public.cars
  add column if not exists laudo_resultado text,
  add column if not exists laudo_empresa text,
  add column if not exists laudo_data date,
  add column if not exists laudo_obs text,
  add column if not exists laudo_pdf_path text,
  add column if not exists laudo_pdf_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cars_laudo_resultado_check') then
    alter table public.cars add constraint cars_laudo_resultado_check
      check (laudo_resultado is null or laudo_resultado in ('aprovado', 'com_apontamento', 'reprovado'));
  end if;
end $$;

-- PDF do laudo: bucket publico (como as fotos), caminho com uuid, so PDF ate 10 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('car-laudos', 'car-laudos', true, 10485760, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists car_laudos_read on storage.objects;
create policy car_laudos_read on storage.objects for select to public
  using (bucket_id = 'car-laudos');

drop policy if exists car_laudos_write on storage.objects;
create policy car_laudos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'car-laudos' and public.owns_tenant(nullif((storage.foldername(name))[1], '')::uuid));

drop policy if exists car_laudos_delete on storage.objects;
create policy car_laudos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'car-laudos' and public.owns_tenant(nullif((storage.foldername(name))[1], '')::uuid));

-- DADOS DA LOJA no prompt: entrega e documentacao com detalhes, vistoria de
-- confianca, politica de desconto e regras de consorcio.
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
    if coalesce(v_store.offers_consignment, false) then v_linhas := v_linhas || '- Consignacao: a loja aceita veiculos em consignacao'::text; end if;
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

-- Dados oficiais da loja (ferramenta da Julia): os campos novos tambem.
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


-- Estoque da Julia: o laudo de cada carro (resultado, empresa, data, apontamentos)
-- e o marcador [LAUDO:id] quando a loja subiu o PDF.
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
        -- 01/10: laudo cautelar deste carro, quando a loja cadastrou.
        'laudo', case when c.laudo_resultado is not null or c.laudo_pdf_url is not null then jsonb_strip_nulls(jsonb_build_object(
          'resultado', c.laudo_resultado,
          'empresa', nullif(btrim(coalesce(c.laudo_empresa, '')), ''),
          'data', to_char(c.laudo_data, 'DD/MM/YYYY'),
          'apontamentos', nullif(btrim(coalesce(c.laudo_obs, '')), ''),
          'tem_pdf', c.laudo_pdf_url is not null)) end,
        'marcador_laudo', case when c.laudo_pdf_url is not null and c.status <> 'reservado' then '[LAUDO:' || c.id::text || ']' end,
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

-- Remonta os prompts com os DADOS DA LOJA novos.
update public.tenant_agents set system_prompt = system_prompt;
