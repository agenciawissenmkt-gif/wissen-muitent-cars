-- 0014_estoque_enxuto.sql
--
-- Metade do que a Julia le do estoque e URL de foto que ela esta proibida de usar.
--
-- Medido na w Multimarcas, 13 carros ativos:
--
--   resposta completa do api_cars ......... 24.985 caracteres (~7.000 tokens)
--   sem photos e cover_url ................  9.362
--   so os campos que ela usa na vitrine ...  3.979
--   gasto so com o array photos ........... 12.675
--
-- O prompt diz, em letras maiusculas, para nunca escrever link de foto: as
-- imagens saem por marcador [FOTOS:<id>] e [CAPA:<id>]. Quem realmente envia e o
-- no "Buscar fotos do carro" do n8n, que chama este mesmo api_cars por fora do
-- agente -- a resposta dele nunca entra no contexto do modelo. Ou seja, as
-- ferramentas do agente carregavam 12 mil caracteres por consulta para nao usar
-- nenhum deles.
--
-- Com o limite de 30.000 tokens por minuto da conta OpenAI, isso e a diferenca
-- entre uma resposta por minuto e tres.
--
-- p_com_fotos entra com default true de proposito: se algum no do n8n deixar de
-- mandar o parametro, ele volta a receber tudo -- perde a economia, nao quebra a
-- foto. O caminho seguro e o silencioso.
--
-- Precisa de drop antes do create porque acrescentar parametro nao substitui a
-- funcao, cria uma sobrecarga -- e duas api_cars deixariam o PostgREST sem saber
-- qual chamar.

drop function if exists public.api_cars(uuid, text, text);

create function public.api_cars(
  p_tenant     uuid,
  p_model      text default null,
  p_status     text default 'ativo',
  p_com_fotos  boolean default true
)
returns jsonb
language sql
stable
as $fn$
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
        'year', c.year,
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
        'ipva_paid', c.ipva_paid,
        'licensed', c.licensed,
        'single_owner', c.single_owner,
        'dealer_revisions', c.dealer_revisions,
        'accepts_trade', c.accepts_trade,
        'description', c.description,
        'status', c.status,
        -- photos_count fica sempre: e barato e a Julia usa para dizer quantas
        -- fotos ela tem daquele carro.
        'photos_count', (select count(*) from public.car_photos p where p.car_id = c.id)
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
    from public.cars c
    where c.tenant_id = p_tenant
      and (p_status is null or p_status = '' or c.status = p_status)
      and (
        p_model is null or btrim(p_model) = ''
        or coalesce((
          select bool_and(
            public.normaliza_busca(
              coalesce(c.brand, '') || ' ' || coalesce(c.model, '') || ' ' ||
              coalesce(c.version, '') || ' ' || coalesce(c.body_type, '') || ' ' ||
              coalesce(c.transmission, '') || ' ' || coalesce(c.fuel, '') || ' ' ||
              coalesce(c.year::text, '')
            ) like '%' || public.normaliza_busca(w) || '%'
          )
          from unnest(string_to_array(btrim(p_model), ' ')) as w
          where btrim(w) <> ''
        ), true)
      )
  ) q
$fn$;

grant execute on function public.api_cars(uuid, text, text, boolean) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
