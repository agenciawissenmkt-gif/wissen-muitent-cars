-- Laudo lido pela Julia (02/10).
--
-- Quando a loja sobe o PDF do laudo no painel, o fluxo "Wissen Cars - Leitor de laudo"
-- (n8n, a cada 3 minutos) pega os laudos ainda nao lidos (laudos_pendentes), manda o PDF
-- para a IA transcrever e salva o texto no carro (salvar_laudo_texto). Trocou o PDF, le de
-- novo. A api_cars devolve o texto em laudo.laudo_texto so quando a busca traz ate 2
-- carros (pergunta sobre um carro especifico), para nao pesar a lista do estoque.
--
-- Ja aplicada no banco.

alter table public.cars
  add column if not exists laudo_texto text,
  add column if not exists laudo_texto_de text;

create or replace function public.laudos_pendentes(p_limite int default 3)
returns table (car_id uuid, tenant_id uuid, url text, nome text)
language sql
stable
security definer
set search_path = public
as $function$
  select c.id, c.tenant_id, c.laudo_pdf_url, initcap(coalesce(c.brand, '') || ' ' || coalesce(c.model, '') || ' ' || coalesce(c.year::text, ''))
    from public.cars c
   where c.laudo_pdf_url is not null
     and c.laudo_texto_de is distinct from c.laudo_pdf_url
   order by c.updated_at desc nulls last
   limit greatest(1, least(coalesce(p_limite, 3), 10))
$function$;

create or replace function public.salvar_laudo_texto(p_car uuid, p_url text, p_texto text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  n int;
begin
  update public.cars
     set laudo_texto = nullif(btrim(left(coalesce(p_texto, ''), 6000)), ''),
         laudo_texto_de = p_url
   where id = p_car and laudo_pdf_url = p_url;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1);
end;
$function$;

revoke all on function public.laudos_pendentes(int) from public, anon, authenticated;
revoke all on function public.salvar_laudo_texto(uuid, text, text) from public, anon, authenticated;
grant execute on function public.laudos_pendentes(int) to service_role;
grant execute on function public.salvar_laudo_texto(uuid, text, text) to service_role;

CREATE OR REPLACE FUNCTION public.api_cars(p_tenant uuid, p_model text DEFAULT NULL::text, p_status text DEFAULT 'ativo'::text, p_com_fotos boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
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
    from (select e.*, count(*) over () as qtd_total from escolhidos e) c
  ) q
$function$
;
