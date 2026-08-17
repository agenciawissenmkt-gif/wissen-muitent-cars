-- =============================================================================
-- Wissen Cars — camada do aplicativo do lojista (100% aditiva)
-- =============================================================================
-- Escrita para rodar sobre o projeto que já existe (wissen-cars-multitenant),
-- onde o fluxo do N8N está em produção. Nada aqui altera ou remove tabelas,
-- colunas, funções ou dados existentes:
--
--   * as funções tenant_context(), api_cars(), resolve_tenant(),
--     get_agent_prompt(), upsert_lead() e match_faq() ficam intactas;
--   * as tabelas leads, followups, faq_vec e n8n_chat_histories não são tocadas;
--   * o N8N segue usando a service role, que ignora RLS.
--
-- O que falta hoje e este script resolve:
--   1. stores e tenants não têm ligação — o app não sabe qual tenant é da loja;
--   2. só existe uma policy no projeto (em stores), então o lojista logado não
--      consegue ler os próprios veículos pelo navegador;
--   3. não há bucket de fotos nem tabela de vendedores/credenciais do Google.
-- =============================================================================

-- 1. Ligação loja -> tenant ---------------------------------------------------

alter table public.stores add column if not exists tenant_id uuid references public.tenants (id);
create index if not exists stores_tenant_id_idx on public.stores (tenant_id);

-- 2. Colunas que o painel usa e ainda não existiam ----------------------------

alter table public.stores add column if not exists works_with_auction boolean not null default false;
alter table public.stores add column if not exists partner_banks text[] not null default '{}';
alter table public.cars add column if not exists model_year integer;
alter table public.car_photos add column if not exists storage_path text;

-- 3. Equipe de vendas (etapa 3 da implementação) ------------------------------

create table if not exists public.salespeople (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  name             text not null,
  email            text not null,
  role             text not null default 'agent' check (role in ('administrator', 'agent')),
  chatwoot_user_id bigint,
  created_at       timestamptz not null default now(),
  unique (tenant_id, email)
);

create index if not exists salespeople_tenant_id_idx on public.salespeople (tenant_id);

-- 4. Credenciais do Google Agenda (etapa 2) -----------------------------------

create table if not exists public.tenant_google_credentials (
  tenant_id     uuid primary key references public.tenants (id) on delete cascade,
  email         text,
  calendar_id   text not null default 'primary',
  access_token  text,
  refresh_token text,
  scope         text,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 5. Quem é dono de qual tenant ----------------------------------------------

create or replace function public.owns_tenant(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.stores s
    where s.tenant_id = p_tenant and s.owner_id = auth.uid()
  );
$$;

-- 6. RLS para o lojista logado ------------------------------------------------

alter table public.salespeople               enable row level security;
alter table public.tenant_google_credentials enable row level security;

drop policy if exists app_owner_read on public.tenants;
create policy app_owner_read on public.tenants
  for select to authenticated
  using (public.owns_tenant(id));

drop policy if exists app_owner_update on public.tenants;
create policy app_owner_update on public.tenants
  for update to authenticated
  using (public.owns_tenant(id))
  with check (public.owns_tenant(id));

do $$
declare t text;
begin
  foreach t in array array[
    'tenant_channels', 'tenant_settings', 'tenant_agents', 'cars', 'car_photos',
    'salespeople', 'tenant_google_credentials'
  ]
  loop
    execute format('drop policy if exists app_owner_all on public.%I', t);
    execute format(
      'create policy app_owner_all on public.%I for all to authenticated
         using (public.owns_tenant(tenant_id))
         with check (public.owns_tenant(tenant_id))', t);
  end loop;
end;
$$;

-- 7. Bucket das fotos ---------------------------------------------------------
-- Caminho: car-photos/<tenant_id>/<car_id>/<arquivo>. As fotos já cadastradas
-- continuam apontando para a URL externa gravada em car_photos.url.

insert into storage.buckets (id, name, public)
values ('car-photos', 'car-photos', true)
on conflict (id) do update set public = true;

drop policy if exists car_photos_read on storage.objects;
create policy car_photos_read on storage.objects
  for select to public
  using (bucket_id = 'car-photos');

drop policy if exists car_photos_write on storage.objects;
create policy car_photos_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'car-photos'
    and public.owns_tenant(nullif((storage.foldername(name))[1], '')::uuid)
  );

drop policy if exists car_photos_delete on storage.objects;
create policy car_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'car-photos'
    and public.owns_tenant(nullif((storage.foldername(name))[1], '')::uuid)
  );

-- 8. Primeiro login: garante loja + tenant + agentes --------------------------
-- Evita abrir insert em tenants para qualquer usuário autenticado. Se a loja já
-- existe e só falta o vínculo com o tenant, o vínculo é criado sem duplicar nada.

create or replace function public.slugify_pt(p_text text)
returns text
language sql
immutable
as $$
  select btrim(
    regexp_replace(
      lower(translate(coalesce(p_text, ''),
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
        'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
      '[^a-z0-9]+', '-', 'g'),
    '-');
$$;

create or replace function public.bootstrap_store(p_nome text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_store  public.stores%rowtype;
  v_tenant uuid;
  v_nome   text := coalesce(nullif(btrim(p_nome), ''), 'Minha Loja');
  v_slug   text;
begin
  if v_uid is null then
    raise exception 'É preciso estar autenticado.';
  end if;

  select * into v_store from public.stores where owner_id = v_uid order by created_at limit 1;

  -- Já configurado: nada a fazer.
  if v_store.id is not null and v_store.tenant_id is not null then
    return v_store.id;
  end if;

  v_slug := coalesce(nullif(public.slugify_pt(v_nome), ''), 'loja') || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into public.tenants (nome, slug) values (v_nome, v_slug) returning id into v_tenant;
  insert into public.tenant_settings (tenant_id) values (v_tenant) on conflict do nothing;

  insert into public.tenant_agents (tenant_id, agent_type, system_prompt)
  values
    (v_tenant, 'descoberta',   'Entenda o cliente antes de oferecer: veículo de interesse, uso, troca, forma de pagamento e valor de entrada. Uma pergunta por vez.'),
    (v_tenant, 'encantamento', 'Apresente o veículo usando somente a ficha técnica real do estoque e envie as fotos cadastradas, na ordem em que estão.'),
    (v_tenant, 'fechamento',   'Conduza para a visita ou test-drive: ofereça dois horários concretos e agende na agenda da loja assim que o cliente escolher.');

  if v_store.id is null then
    insert into public.stores (owner_id, name, tenant_id, slug)
    values (v_uid, v_nome, v_tenant, v_slug)
    returning * into v_store;
  else
    update public.stores set tenant_id = v_tenant where id = v_store.id;
  end if;

  return v_store.id;
end;
$$;

grant execute on function public.bootstrap_store(text) to authenticated;
grant execute on function public.owns_tenant(uuid) to authenticated, service_role;
