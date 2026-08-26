-- 0013_busca_por_palavras.sql
--
-- "ela nao conseguiu consultar a ficha tecnica do carro."
--
-- O cliente perguntou os detalhes do Mitsubishi Lancer Evolution X e a Julia
-- respondeu que "o sistema nao retornou os detalhes tecnicos" e que ia chamar um
-- consultor. Os dados estavam todos no painel: motor 2.0, 295 cv, 37.3 kgfm, 4
-- cilindros, turbo, tracao traseira. E o api_cars devolve todos esses campos.
--
-- O problema era a busca. Cada campo era comparado com a frase INTEIRA:
--
--   c.brand ilike '%' || p_model || '%' or c.model ilike ... or c.version ilike ...
--
-- Entao "Lancer" achava o carro, mas "Mitsubishi Lancer" nao achava nada -- a
-- marca esta em brand e o modelo em model, e nenhum dos dois contem a frase toda.
-- "Lancer Evolution X" tambem falhava: model e "LANCER" e version e "2.0
-- EVOLUTION X 4X4 16V...". Ou seja, o jeito mais natural de pedir um carro, e o
-- que o proprio prompt manda a Julia usar ("o cliente citou marca e modelo"),
-- era justamente o que voltava vazio. Medido antes da correcao:
--
--   Lancer -> 1    Evolution X -> 1
--   Mitsubishi Lancer -> 0    Lancer Evolution X -> 0
--
-- Agora a frase e quebrada em palavras e TODAS precisam aparecer em algum lugar
-- da identidade do carro (marca, modelo, versao, carroceria, cambio,
-- combustivel, ano), com acento dobrado para os dois lados como na 0008. Assim
-- "Mitsubishi Lancer", "lancer evolution", "corolla 2026" e "sedan automatico"
-- passam a achar o que existe.
--
-- Junto vem normaliza_busca(), que dobra acento e junta os apelidos de
-- carroceria. Sem ela "sedan" continuava nao achando "Seda" (a folha de acento
-- transforma "Seda" em "seda", e "seda" nao contem "sedan") -- e "sedan" e
-- exatamente como o cliente escreve no WhatsApp.
--
-- A api_cars e reescrita inteira de proposito: a lista de campos devolvidos
-- continua identica a que estava viva, so a clausula de busca muda.

create or replace function public.normaliza_busca(p text)
returns text
language sql
immutable
as $fn$
  select replace(replace(replace(replace(replace(replace(
           translate(lower(coalesce(p, '')),
                     'áàâãäéèêëíìîïóòôõöúùûüç',
                     'aaaaaeeeeiiiiooooouuuuc'),
           'hatchback', 'hatch'),
           'caminhonete', 'picape'),
           'camionete', 'picape'),
           'pick-up', 'picape'),
           'pickup', 'picape'),
           'sedan', 'seda')
$fn$;

create or replace function public.api_cars(
  p_tenant uuid,
  p_model  text default null,
  p_status text default 'ativo'
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
    select jsonb_build_object(
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
      'cover_url', c.cover_url,
      'photos', coalesce((
        select jsonb_agg(jsonb_build_object('url', p.url, 'position', p.ordem, 'is_cover', p.is_cover)
                         order by p.is_cover desc, p.ordem)
        from public.car_photos p where p.car_id = c.id
      ), '[]'::jsonb),
      'photos_count', (select count(*) from public.car_photos p where p.car_id = c.id)
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

grant execute on function public.normaliza_busca(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
