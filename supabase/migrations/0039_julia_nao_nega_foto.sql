-- 0039: a Julia para de negar foto de carro que tem foto.
--
-- Sintoma (24/09, conversa 10): o cliente pediu "me manda as fotos do lancer".
-- A ferramenta de estoque devolveu o Lancer com photos_count = 5, e a lista de
-- fotos que vai no prompt tambem tinha "MITSUBISHI LANCER 2014: frente, interna,
-- lateral, painel, traseira". Mesmo assim ela respondeu "Do Lancer eu nao tenho
-- fotos disponiveis" e deixou nota [FALTA FOTO].
--
-- Causa: para mandar foto, o modelo precisava cruzar tres coisas espalhadas num
-- prompt de ~28 mil tokens -- o id do carro no resultado da ferramenta, a lista
-- de fotos no fim do prompt e a regra do marcador. Uma hora ele erra o
-- cruzamento. Nao e dado faltando; e o caminho que e longo demais.
--
-- Correcao, em duas partes:
--   1. api_cars devolve, junto de cada carro que tem foto, o marcador pronto:
--      tem_fotos, marcador_fotos e marcador_capa. O modelo so precisa copiar o
--      que esta do lado do carro.
--   2. Os tres prompts ganham um paragrafo dizendo que esses campos sao a prova
--      de que a foto existe, e que com eles nao se nega foto nem se deixa
--      [FALTA FOTO].
-- Nenhum campo existente muda; os novos so se somam.

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
                 coalesce(e.year::text, '')
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
        'electric_windows', c.electric_windows, 'sunroof', c.sunroof,
        'ipva_paid', c.ipva_paid,
        'licensed', c.licensed,
        'single_owner', c.single_owner,
        'dealer_revisions', c.dealer_revisions,
        'accepts_trade', c.accepts_trade,
        'description', c.description,
        'status', c.status,
        -- photos_count fica sempre: e barato e a Julia usa para dizer quantas
        -- fotos ela tem daquele carro.
        'photos_count', c.qtd_fotos,
        -- A prova de que a foto existe vai do lado do carro, pronta para copiar.
        'tem_fotos', c.qtd_fotos > 0,
        'marcador_fotos', case when c.qtd_fotos > 0 then '[FOTOS:' || c.id::text || ']' end,
        'marcador_capa',  case when c.qtd_fotos > 0 then '[CAPA:'  || c.id::text || ']' end,
        -- 'correspondencia' = casou com o termo. 'sem_correspondencia' = o termo
        -- nao casou com nada e isto aqui e o estoque inteiro, para julgamento.
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

-- Paragrafo novo nos tres prompts, logo antes da VITRINE.
update public.prompt_templates
   set template = replace(
         template,
         'VITRINE (o cliente pede uma categoria ou um perfil):',
         'FOTOS PELA FERRAMENTA: cada carro que a ferramenta de estoque devolve com foto traz os campos tem_fotos, marcador_fotos e marcador_capa. Eles sao a prova de que a foto existe, valem mais do que a sua memoria e mais do que a lista de partes. Se o cliente pedir as fotos de um carro e ele veio com marcador_fotos, a resposta e uma frase curta com marca, modelo e ano e, na mensagem seguinte, esse marcador copiado exatamente como veio. Nunca diga que nao tem foto de um carro que veio com tem_fotos verdadeiro, e nunca deixe nota [FALTA FOTO] para ele. Se o carro ainda nao apareceu na conversa, consulte a ferramenta de estoque antes de responder sobre foto. A lista de partes continua valendo so para pedido de parte especifica (frente, traseira, motor...).' || E'\n\n' ||
         'VITRINE (o cliente pede uma categoria ou um perfil):'
       ),
       updated_at = now()
 where template like '%VITRINE (o cliente pede uma categoria ou um perfil):%'
   and template not like '%FOTOS PELA FERRAMENTA:%';

-- Conferencia: os tres prompts com o paragrafo, uma vez so.
do $$
declare
  n_ok int;
  n_dup int;
begin
  select count(*) into n_ok from public.prompt_templates
   where template like '%FOTOS PELA FERRAMENTA:%';
  select count(*) into n_dup from public.prompt_templates
   where (length(template) - length(replace(template, 'FOTOS PELA FERRAMENTA:', '')))
         / length('FOTOS PELA FERRAMENTA:') > 1;
  if n_ok <> 3 or n_dup > 0 then
    raise exception '0039: esperava o paragrafo nos 3 prompts uma vez so (ok=%, duplicados=%)', n_ok, n_dup;
  end if;
end $$;

-- Remonta os prompts de cada loja a partir dos templates.
update public.tenant_agents set system_prompt = system_prompt;
