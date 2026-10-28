-- 0059_sinistro_e_leilao_para_julia.sql
--
-- A loja passa a marcar no cadastro do carro se ele tem sinistro (campo novo) e se
-- e de leilao (de_leilao, que ja existia so para os anuncios). A Julia responde por
-- essas marcacoes quando o cliente pergunta:
--   * marcado: confirma que sim e convida para ver o carro na loja com o consultor;
--   * nao marcado e com PDF do historico: manda o documento;
--   * nao marcado e sem historico: responde que nao tem.
-- Junto vai com_multas, para a resposta de "documentacao em dia" seguir o que a loja
-- preencheu (ipva_paid e licensed ja chegavam).
--
-- Tudo aditivo: coluna nova com padrao false e tres campos a mais no JSON de cada
-- carro da api_cars. Nenhum campo existente muda.

alter table public.cars
  add column if not exists sinistro boolean not null default false;

comment on column public.cars.sinistro is 'Marcado pela loja no cadastro: o carro tem sinistro. A Julia confirma ao cliente quando ele pergunta.';
comment on column public.cars.de_leilao is 'Marcado pela loja no cadastro: o carro e de leilao. Vale mais que a regra geral de leilao da loja.';

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
        -- 28/10: marcacoes da loja que a Julia usa em sinistro, leilao e documentacao.
        'sinistro', coalesce(c.sinistro, false),
        'de_leilao', coalesce(c.de_leilao, false),
        'com_multas', coalesce(c.com_multas, false),
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
$function$;
