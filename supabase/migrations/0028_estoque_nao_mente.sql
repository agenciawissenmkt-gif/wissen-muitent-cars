-- 0028_estoque_nao_mente.sql
--
-- Print das 23:22. O cliente perguntou "Vc tem algum esportivo?" e a Julia
-- respondeu que nao tinha. A loja tinha: um Lancer Evolution X 2014.
--
-- Ela nao inventou nem esqueceu. A execucao mostra que ela FEZ a consulta, com
-- o termo `esportivo`, e o banco devolveu lista vazia. Um minuto depois, quando
-- o cliente citou o nome do carro, ela consultou de novo com `Lancer` e achou
-- na hora.
--
-- O motivo esta no filtro. A busca compara o termo contra marca, modelo,
-- versao, carroceria, cambio, combustivel e ano. "Esportivo" nao e nenhuma
-- dessas coisas -- e um julgamento sobre o carro, nao um campo dele. Nenhum
-- veiculo tem a palavra "esportivo" escrita em lugar nenhum do cadastro, entao
-- o casamento falha e a funcao devolve `[]`.
--
-- E `[]` e uma resposta ambigua. Para quem le, "nenhum carro casou com a sua
-- palavra" e "esta loja nao tem carro nenhum assim" sao a mesma coisa. A Julia
-- leu do segundo jeito, que e o jeito que faz o cliente ir embora.
--
-- A correcao nao e ensinar sinonimos. Sinonimo acaba: esportivo, familiar,
-- economico, para trabalho, para a estrada, primeiro carro -- nao da para
-- prever a palavra que o cliente vai usar, e cada palavra que faltar vira
-- outra venda perdida.
--
-- A correcao e a funcao parar de responder vazio quando ha estoque. Se o termo
-- nao casa com nada, ela devolve o estoque inteiro e marca cada carro com
-- `filtro: "sem_correspondencia"` -- que quer dizer, em portugues: "nao entendi
-- a sua palavra, entao te mando tudo o que tem e voce julga". Que e exatamente
-- o que um vendedor faz quando alguem pede uma coisa que ele nao sabe filtrar:
-- olha o patio inteiro.
--
-- Quando o termo casa, todo carro devolvido vem com `filtro:
-- "correspondencia"`, e vazio volta a significar o que sempre deveria ter
-- significado: a loja realmente nao tem nenhum carro.
--
-- Tambem entram no campo de busca o motor e a cor, que ja estavam no cadastro
-- e nunca tinham sido consultados -- "1.4 turbo" e "carro branco" sao pedidos
-- comuns. A descricao ficou de fora de proposito: e texto livre, e uma
-- descricao que diz "melhor que muita picape" faria um sedan aparecer para quem
-- pediu picape, agora sem aviso nenhum de que foi um palpite.

create or replace function public.api_cars(
  p_tenant uuid,
  p_model text default null::text,
  p_status text default 'ativo'::text,
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
             as busca_filtro
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
        'photos_count', (select count(*) from public.car_photos p where p.car_id = c.id),
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

-- Conferencia contra a loja que tem mais carros ativos: uma palavra que existe
-- no cadastro tem de casar; uma palavra que nao existe em cadastro nenhum tem
-- de devolver o estoque inteiro marcado, e nunca vazio.
do $do$
declare
  v_tenant uuid;
  v_ativos int;
  v_tudo   int;
  v_nada   int;
  v_marca  text;
  v_casou  int;
  v_flag   text;
begin
  select c.tenant_id, count(*)
    into v_tenant, v_ativos
    from public.cars c
   where c.status = 'ativo'
   group by c.tenant_id
   order by count(*) desc
   limit 1;

  if v_tenant is null then
    raise notice 'Nenhuma loja com carro ativo: nada a conferir.';
    return;
  end if;

  select jsonb_array_length(public.api_cars(v_tenant, null, 'ativo', false) -> 'cars') into v_tudo;
  if v_tudo <> v_ativos then
    raise exception 'Termo vazio devolveu % carros, mas a loja tem % ativos', v_tudo, v_ativos;
  end if;

  -- Palavra que nao existe em cadastro nenhum: a rede de seguranca tem de abrir.
  select jsonb_array_length(public.api_cars(v_tenant, 'zzqqxx', 'ativo', false) -> 'cars') into v_nada;
  if v_nada <> v_ativos then
    raise exception 'Termo desconhecido devolveu % carros; esperava o estoque inteiro (%)', v_nada, v_ativos;
  end if;

  select public.api_cars(v_tenant, 'zzqqxx', 'ativo', false) -> 'cars' -> 0 ->> 'filtro' into v_flag;
  if v_flag is distinct from 'sem_correspondencia' then
    raise exception 'Esperava a marca sem_correspondencia, veio %', coalesce(v_flag, '<null>');
  end if;

  -- Uma marca que existe de verdade continua filtrando de verdade.
  select c.brand into v_marca
    from public.cars c
   where c.tenant_id = v_tenant and c.status = 'ativo' and coalesce(c.brand, '') <> ''
   limit 1;

  if v_marca is not null then
    select jsonb_array_length(public.api_cars(v_tenant, v_marca, 'ativo', false) -> 'cars') into v_casou;
    if v_casou = 0 or v_casou > v_ativos then
      raise exception 'Busca por "%" devolveu % carros', v_marca, v_casou;
    end if;

    select public.api_cars(v_tenant, v_marca, 'ativo', false) -> 'cars' -> 0 ->> 'filtro' into v_flag;
    if v_flag is distinct from 'correspondencia' then
      raise exception 'Busca legitima veio marcada como %', coalesce(v_flag, '<null>');
    end if;
  end if;
end
$do$;
