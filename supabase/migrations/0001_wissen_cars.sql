-- =============================================================================
-- Wissen Cars — schema base (apenas para um projeto Supabase NOVO)
-- =============================================================================
-- ATENÇÃO: o projeto wissen-cars-multitenant JÁ TEM este schema, criado junto
-- com o fluxo do N8N. Lá roda somente a migração 0002_app_layer.sql.
--
-- Este arquivo existe para subir uma segunda loja/ambiente do zero: ele recria
-- as tabelas que o painel usa, com os mesmos nomes de coluna do projeto de
-- produção, mais as duas funções lidas pelo agente no N8N. Tabelas do fluxo de
-- conversa (leads, followups, faq_vec, n8n_chat_histories) não estão aqui —
-- elas pertencem ao projeto do N8N, não ao painel.
-- =============================================================================

create extension if not exists pgcrypto;

-- Tenant: a loja do ponto de vista do agente ---------------------------------

create table if not exists public.tenants (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  nome       text not null,
  ativo      boolean not null default true,
  timezone   text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_channels (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete cascade,
  chatwoot_account_id bigint not null,
  chatwoot_inbox_id   bigint,
  evolution_instance  text,
  whatsapp_number     text,
  ativo               boolean not null default true,
  created_at          timestamptz not null default now()
);

create unique index if not exists tenant_channels_tenant_id_key on public.tenant_channels (tenant_id);

create table if not exists public.tenant_settings (
  tenant_id            uuid primary key references public.tenants (id) on delete cascade,
  chatwoot_base_url    text not null default 'http://wissen_chatwoot:3000',
  chatwoot_token       text,
  evolution_base_url   text,
  evolution_instance   text,
  bot_phone            text,
  google_calendar_id   text,
  team_atendimento_id  bigint,
  team_descoberta_id   bigint,
  team_fechamento_id   bigint,
  team_encantamento_id bigint,
  horario_atendimento  text,
  endereco_loja        text,
  followup_ativo       boolean not null default true,
  extra                jsonb not null default '{}'::jsonb
);

-- Prompts do agente, uma linha por fase da conversa ---------------------------

create table if not exists public.tenant_agents (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  agent_type    text not null check (agent_type in ('descoberta', 'fechamento', 'encantamento')),
  nome_agente   text not null default 'Julia',
  model         text not null default 'gpt-4.1-mini',
  temperature   numeric not null default 0.3,
  system_prompt text not null,
  ativo         boolean not null default true,
  updated_at    timestamptz not null default now()
);

-- Loja do lojista, ligada à conta Google que faz login ------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'inspection_type') then
    create type public.inspection_type as enum ('nenhum', 'pesquisa', 'completo');
  end if;
  if not exists (select 1 from pg_type where typname = 'onboarding_step') then
    create type public.onboarding_step as enum ('perfil', 'chatwoot', 'calendar', 'evolution', 'concluido');
  end if;
end;
$$;

create table if not exists public.stores (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references auth.users (id) on delete cascade,
  tenant_id            uuid references public.tenants (id),
  slug                 text unique,
  name                 text not null,
  legal_name           text,
  cnpj                 text,
  phone                text,
  whatsapp             text,
  email                text,
  website              text,
  instagram            text,
  logo_url             text,
  address_street       text,
  address_number       text,
  address_complement   text,
  address_district     text,
  address_city         text,
  address_state        text,
  address_zip          text,
  maps_url             text,
  has_inspection       boolean not null default false,
  inspection_type      public.inspection_type not null default 'nenhum',
  warranty_months      integer not null default 0,
  warranty_details     text,
  vehicle_conditions   text[] not null default '{}',
  vehicle_categories   text[] not null default '{}',
  accepts_trade        boolean not null default false,
  offers_financing     boolean not null default false,
  offers_consignment   boolean not null default false,
  offers_test_drive    boolean not null default false,
  offers_delivery      boolean not null default false,
  offers_documentation boolean not null default false,
  works_with_auction   boolean not null default false,
  partner_banks        text[] not null default '{}',
  payment_methods      text[] not null default '{}',
  differentials        text,
  service_notes        text,
  business_hours       jsonb not null default '[]'::jsonb,
  timezone             text not null default 'America/Sao_Paulo',
  onboarding_step      public.onboarding_step not null default 'perfil',
  profile_completed_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.stores enable row level security;

drop policy if exists "Owners manage own store" on public.stores;
create policy "Owners manage own store" on public.stores
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Estoque ---------------------------------------------------------------------

create table if not exists public.cars (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete cascade,
  store_id           uuid references public.stores (id),
  external_id        text,
  brand              text,
  model              text not null,
  version            text,
  year               integer,
  model_year         integer,
  color              text,
  doors              integer,
  transmission       text,
  body_type          text,
  fuel               text,
  mileage_km         integer,
  price_brl          numeric,
  engine             text,
  cylinders          text,
  horsepower         text,
  torque             text,
  acceleration_0_100 text,
  aspiration         text,
  traction           text,
  air_conditioning   text,
  steering           text,
  electric_windows   text,
  ipva_paid          boolean,
  licensed           boolean,
  single_owner       boolean,
  dealer_revisions   boolean,
  accepts_trade      boolean,
  description        text,
  cover_url          text,
  status             text not null default 'ativo',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists cars_tenant_id_idx on public.cars (tenant_id, status);

create table if not exists public.car_photos (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  car_id       uuid not null references public.cars (id) on delete cascade,
  url          text not null,
  storage_path text,
  ordem        integer not null default 0,
  is_cover     boolean not null default false
);

create index if not exists car_photos_car_id_idx on public.car_photos (car_id, ordem);

-- Funções lidas pelo agente no N8N -------------------------------------------
-- Mesmas assinaturas do projeto de produção. Chamadas com a service role key,
-- que ignora RLS.

create or replace function public.tenant_context(p_account_id bigint, p_inbox_id bigint default null)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'found', true,
    'tenant_id', t.id,
    'slug', t.slug,
    'nome', t.nome,
    'timezone', t.timezone,
    'chatwoot_base_url', s.chatwoot_base_url,
    'chatwoot_token', s.chatwoot_token,
    'evolution_base_url', s.evolution_base_url,
    'evolution_instance', s.evolution_instance,
    'bot_phone', s.bot_phone,
    'google_calendar_id', s.google_calendar_id,
    'horario_atendimento', s.horario_atendimento,
    'endereco_loja', s.endereco_loja,
    'followup_ativo', s.followup_ativo,
    'prompts', coalesce((
      select jsonb_object_agg(a.agent_type, a.system_prompt)
      from public.tenant_agents a where a.tenant_id = t.id and a.ativo
    ), '{}'::jsonb),
    'models', coalesce((
      select jsonb_object_agg(a.agent_type, jsonb_build_object('model', a.model, 'temperature', a.temperature))
      from public.tenant_agents a where a.tenant_id = t.id and a.ativo
    ), '{}'::jsonb)
  )
  from public.tenant_channels c
  join public.tenants t on t.id = c.tenant_id and t.ativo
  left join public.tenant_settings s on s.tenant_id = t.id
  where c.ativo
    and c.chatwoot_account_id = p_account_id
    and (c.chatwoot_inbox_id is null or p_inbox_id is null or c.chatwoot_inbox_id = p_inbox_id)
  order by c.chatwoot_inbox_id nulls last
  limit 1;
$$;

create or replace function public.api_cars(
  p_tenant uuid,
  p_model  text default null,
  p_status text default 'ativo'
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('cars', coalesce(jsonb_agg(x order by x->>'brand', x->>'model'), '[]'::jsonb))
  from (
    select jsonb_build_object(
      'id', c.id::text,
      'brand', c.brand,
      'model', c.model,
      'version', c.version,
      'year', c.year,
      'model_year', c.model_year,
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
      and (p_model is null or p_model = ''
           or c.model ilike '%' || p_model || '%'
           or c.brand ilike '%' || p_model || '%'
           or c.version ilike '%' || p_model || '%')
    limit 80
  ) s;
$$;

-- Depois deste arquivo, rode 0002_app_layer.sql.
