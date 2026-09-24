-- =============================================================================
-- 0039 — Painel Empresarial Wissen Cars (camada do super admin)
-- =============================================================================
-- Roda sobre o mesmo projeto Supabase do painel das lojas (wissen-cars-multitenant),
-- depois da 0038 do repositório wissen-muitent-cars. É idempotente: pode ser executada de novo.
--
-- Regras de segurança adotadas em todo o arquivo:
--   * toda tabela nova tem RLS ligado e NENHUMA policy para anon/authenticated,
--     além de REVOKE explícito — só a service_role (servidor do painel empresarial)
--     lê e escreve. A única exceção é store_access_blocks, que o lojista pode LER
--     para o painel dele mostrar a tela de conta suspensa;
--   * toda função administrativa é SECURITY DEFINER com search_path fixo e
--     EXECUTE revogado de public/anon/authenticated;
--   * nenhuma tabela ou função usada pelo fluxo do N8N é alterada. A única função
--     existente que muda é owns_tenant(), criada pela 0002 para o painel das lojas.
-- =============================================================================

-- 0. Configurações do painel -----------------------------------------------------

create table if not exists public.admin_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.admin_settings (key, value) values
  ('enforce_allowlist',     'true'::jsonb),
  ('usd_brl',               '5.50'::jsonb),
  ('alert_whatsapp',        'null'::jsonb),
  ('alert_instance',        'null'::jsonb),
  ('ai_cost_alert_brl',     '300'::jsonb),
  ('overdue_grace_days',    '3'::jsonb)
on conflict (key) do nothing;

-- 1. Liberação de acesso (allowlist) ---------------------------------------------
-- Só entra no painel das lojas quem tiver o e-mail liberado aqui. Contas que já
-- existem em auth.users não são afetadas: a trava age apenas na CRIAÇÃO de conta.

create table if not exists public.access_allowlist (
  email          text primary key check (email = lower(btrim(email)) and email like '%_@_%'),
  full_name      text,
  store_name     text,
  phone          text,
  plan           text check (plan in ('plano_599', 'plano_899', 'personalizado')),
  amount_brl     numeric(10, 2) check (amount_brl is null or amount_brl >= 0),
  notes          text,
  created_by     text not null,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_by     text,
  user_id        uuid,
  first_login_at timestamptz
);

create or replace function public.enforce_access_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enforce boolean;
begin
  select (value #>> '{}')::boolean into v_enforce
  from public.admin_settings where key = 'enforce_allowlist';

  -- Sem a linha de configuração a trava continua ligada (falha fechada).
  if v_enforce is false then
    return new;
  end if;

  if new.email is null or not exists (
    select 1 from public.access_allowlist a
    where a.email = lower(btrim(new.email)) and a.revoked_at is null
  ) then
    raise exception 'WISSEN_ACCESS_NOT_APPROVED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.mark_access_allowlist_used()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.access_allowlist
     set user_id = new.id,
         first_login_at = coalesce(first_login_at, now())
   where email = lower(btrim(new.email));
  return new;
end;
$$;

drop trigger if exists wissen_enforce_allowlist on auth.users;
create trigger wissen_enforce_allowlist
  before insert on auth.users
  for each row execute function public.enforce_access_allowlist();

drop trigger if exists wissen_mark_allowlist_used on auth.users;
create trigger wissen_mark_allowlist_used
  after insert on auth.users
  for each row execute function public.mark_access_allowlist_used();

-- 2. Bloqueio de loja ------------------------------------------------------------

create table if not exists public.store_access_blocks (
  tenant_id             uuid primary key references public.tenants (id) on delete cascade,
  reason                text not null,
  blocked_by            text not null,
  blocked_at            timestamptz not null default now(),
  whatsapp_disconnected boolean not null default false
);

alter table public.store_access_blocks enable row level security;
revoke all on public.store_access_blocks from anon, authenticated;
grant select on public.store_access_blocks to authenticated;

-- O lojista lê o próprio bloqueio (para ver a tela de conta suspensa) — nada mais.
drop policy if exists owner_read_block on public.store_access_blocks;
create policy owner_read_block on public.store_access_blocks
  for select to authenticated
  using (exists (
    select 1 from public.stores s
    where s.tenant_id = store_access_blocks.tenant_id and s.owner_id = auth.uid()
  ));

-- Loja bloqueada deixa de "possuir" o tenant: todas as policies app_owner_* e as
-- do bucket de fotos passam a negar leitura e escrita para o lojista.
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
  )
  and not exists (
    select 1 from public.store_access_blocks b where b.tenant_id = p_tenant
  );
$$;

-- 3. Cobrança --------------------------------------------------------------------

create table if not exists public.store_billing (
  tenant_id     uuid primary key references public.tenants (id) on delete cascade,
  plan          text not null default 'plano_599' check (plan in ('plano_599', 'plano_899', 'personalizado')),
  amount_brl    numeric(10, 2) not null default 599 check (amount_brl >= 0),
  due_day       smallint not null default 10 check (due_day between 1 and 28),
  next_due_date date,
  status        text not null default 'ativo' check (status in ('ativo', 'cortesia', 'cancelado')),
  notes         text,
  updated_at    timestamptz not null default now(),
  updated_by    text
);

-- Pagamentos ficam mesmo depois que a loja é apagada: o histórico de faturamento
-- não pode mudar retroativamente. Por isso tenant_id vira NULL e o nome fica guardado.
create table if not exists public.store_payments (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references public.tenants (id) on delete set null,
  store_name      text not null,
  amount_brl      numeric(10, 2) not null check (amount_brl > 0),
  paid_at         date not null default current_date,
  reference_month date not null check (reference_month = date_trunc('month', reference_month)::date),
  method          text,
  note            text,
  created_by      text not null,
  created_at      timestamptz not null default now()
);

create index if not exists store_payments_paid_at_idx on public.store_payments (paid_at);
create index if not exists store_payments_tenant_idx on public.store_payments (tenant_id);

-- Quando uma loja nova ganha tenant, a cobrança nasce com o plano que foi
-- combinado na liberação do e-mail.
create or replace function public.ensure_store_billing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_plan  text;
  v_value numeric;
begin
  if new.tenant_id is null then
    return new;
  end if;

  if exists (select 1 from public.store_billing where tenant_id = new.tenant_id) then
    return new;
  end if;

  select lower(btrim(u.email)) into v_email from auth.users u where u.id = new.owner_id;
  select a.plan, a.amount_brl into v_plan, v_value from public.access_allowlist a where a.email = v_email;

  -- Loja sem liberação prévia (conta antiga): fica sem cobrança até alguém definir.
  if v_plan is null then
    return new;
  end if;

  insert into public.store_billing (tenant_id, plan, amount_brl, next_due_date)
  values (
    new.tenant_id,
    v_plan,
    coalesce(v_value, case v_plan when 'plano_899' then 899 else 599 end),
    (current_date + interval '1 month')::date
  )
  on conflict (tenant_id) do nothing;

  return new;
end;
$$;

drop trigger if exists wissen_ensure_store_billing on public.stores;
create trigger wissen_ensure_store_billing
  after insert or update of tenant_id on public.stores
  for each row execute function public.ensure_store_billing();

-- 4. Consumo de IA ---------------------------------------------------------------
-- O N8N grava uma linha por chamada ao modelo (função log_ai_usage, abaixo).

create table if not exists public.ai_usage (
  id                bigint generated always as identity primary key,
  tenant_id         uuid not null references public.tenants (id) on delete cascade,
  occurred_at       timestamptz not null default now(),
  model             text not null,
  agent_type        text,
  prompt_tokens     integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  conversation_id   text,
  execution_id      text
);

create index if not exists ai_usage_tenant_time_idx on public.ai_usage (tenant_id, occurred_at desc);
create index if not exists ai_usage_time_idx on public.ai_usage (occurred_at);

-- Preços em dólar por 1 milhão de tokens. Editáveis no painel (aba Consumo de IA);
-- confira sempre a tabela oficial da OpenAI.
create table if not exists public.ai_model_prices (
  model             text primary key,
  input_usd_per_1m  numeric(10, 4) not null check (input_usd_per_1m >= 0),
  output_usd_per_1m numeric(10, 4) not null check (output_usd_per_1m >= 0),
  updated_at        timestamptz not null default now(),
  updated_by        text
);

insert into public.ai_model_prices (model, input_usd_per_1m, output_usd_per_1m) values
  ('gpt-4o-mini',  0.15, 0.60),
  ('gpt-4o',       2.50, 10.00),
  ('gpt-4.1-nano', 0.10, 0.40),
  ('gpt-4.1-mini', 0.40, 1.60),
  ('gpt-4.1',      2.00, 8.00),
  ('gpt-5-nano',   0.05, 0.40),
  ('gpt-5-mini',   0.25, 2.00),
  ('gpt-5',        1.25, 10.00)
on conflict (model) do nothing;

-- 5. Erros de workflow -----------------------------------------------------------

create table if not exists public.workflow_errors (
  id              bigint generated always as identity primary key,
  tenant_id       uuid references public.tenants (id) on delete cascade,
  occurred_at     timestamptz not null default now(),
  workflow_id     text,
  workflow_name   text,
  execution_id    text,
  execution_url   text,
  node_name       text,
  message         text not null,
  conversation_id text,
  resolved_at     timestamptz,
  resolved_by     text
);

create unique index if not exists workflow_errors_execution_uidx
  on public.workflow_errors (execution_id) where execution_id is not null;
create index if not exists workflow_errors_tenant_time_idx on public.workflow_errors (tenant_id, occurred_at desc);

-- 6. Saúde das conexões e métricas mensais ----------------------------------------

create table if not exists public.store_health_checks (
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  checked_at timestamptz not null default now(),
  whatsapp   text not null check (whatsapp   in ('ok', 'alerta', 'erro', 'nao_configurado')),
  chatwoot   text not null check (chatwoot   in ('ok', 'alerta', 'erro', 'nao_configurado')),
  calendar   text not null check (calendar   in ('ok', 'alerta', 'erro', 'nao_configurado')),
  automation text not null check (automation in ('ok', 'alerta', 'erro', 'nao_configurado')),
  details    jsonb not null default '{}'::jsonb
);

create index if not exists store_health_checks_tenant_time_idx on public.store_health_checks (tenant_id, checked_at desc);

create table if not exists public.store_monthly_metrics (
  tenant_id          uuid not null references public.tenants (id) on delete cascade,
  month              date not null check (month = date_trunc('month', month)::date),
  conversations      integer not null default 0,
  incoming_messages  integer not null default 0,
  outgoing_messages  integer not null default 0,
  updated_at         timestamptz not null default now(),
  primary key (tenant_id, month)
);

-- 7. Alertas ---------------------------------------------------------------------

create table if not exists public.admin_alerts (
  id           bigint generated always as identity primary key,
  dedupe_key   text not null,
  tenant_id    uuid references public.tenants (id) on delete cascade,
  severity     text not null check (severity in ('info', 'alerta', 'critico')),
  kind         text not null,
  title        text not null,
  message      text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  notified_at  timestamptz,
  resolved_at  timestamptz,
  resolved_by  text
);

create unique index if not exists admin_alerts_open_uidx on public.admin_alerts (dedupe_key) where resolved_at is null;
create index if not exists admin_alerts_created_idx on public.admin_alerts (created_at desc);

-- 8. Auditoria (somente inserção) --------------------------------------------------

create table if not exists public.admin_audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor_email  text not null,
  action       text not null,
  target_type  text,
  target_id    text,
  target_label text,
  details      jsonb not null default '{}'::jsonb,
  ip           text,
  user_agent   text
);

create index if not exists admin_audit_log_at_idx on public.admin_audit_log (at desc);

create or replace function public.admin_audit_log_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin_audit_log é somente inserção';
end;
$$;

drop trigger if exists admin_audit_log_no_update on public.admin_audit_log;
create trigger admin_audit_log_no_update
  before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_log_is_append_only();

drop trigger if exists admin_audit_log_no_truncate on public.admin_audit_log;
create trigger admin_audit_log_no_truncate
  before truncate on public.admin_audit_log
  for each statement execute function public.admin_audit_log_is_append_only();

-- 9. Sessões e tentativas de login do painel empresarial ---------------------------

create table if not exists public.admin_sessions (
  token_hash   text primary key,
  id           uuid not null unique default gen_random_uuid(),
  email        text not null,
  display_name text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  ip           text,
  user_agent   text,
  revoked_at   timestamptz
);

create index if not exists admin_sessions_email_idx on public.admin_sessions (email);

create table if not exists public.admin_auth_events (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  email   text,
  ip      text,
  outcome text not null check (outcome in ('success', 'denied_email', 'denied_unverified', 'error', 'rate_limited', 'logout')),
  detail  text
);

create index if not exists admin_auth_events_ip_at_idx on public.admin_auth_events (ip, at desc);
create index if not exists admin_auth_events_at_idx on public.admin_auth_events (at desc);

-- 10. Tranca todas as tabelas novas ------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'admin_settings', 'access_allowlist', 'store_billing', 'store_payments', 'ai_usage',
    'ai_model_prices', 'workflow_errors', 'store_health_checks', 'store_monthly_metrics',
    'admin_alerts', 'admin_audit_log', 'admin_sessions', 'admin_auth_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end;
$$;

-- 11. Funções para o N8N registrar consumo e erros --------------------------------
-- Resolvem a loja pelo par (conta, inbox) do Chatwoot — o mesmo que o fluxo já
-- recebe no webhook —, ou pelo tenant_id quando ele já é conhecido.

create or replace function public.resolve_tenant_for_admin(
  p_tenant     uuid,
  p_account_id bigint,
  p_inbox_id   bigint
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_tenant,
    (select c.tenant_id from public.tenant_channels c
      where c.chatwoot_account_id = p_account_id
        and (p_inbox_id is null or c.chatwoot_inbox_id = p_inbox_id)
      order by (c.chatwoot_inbox_id = p_inbox_id) desc nulls last
      limit 1)
  );
$$;

create or replace function public.log_ai_usage(
  p_model             text,
  p_prompt_tokens     integer,
  p_completion_tokens integer,
  p_tenant            uuid    default null,
  p_account_id        bigint  default null,
  p_inbox_id          bigint  default null,
  p_agent_type        text    default null,
  p_conversation_id   text    default null,
  p_execution_id      text    default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.resolve_tenant_for_admin(p_tenant, p_account_id, p_inbox_id);
  v_id     bigint;
begin
  if v_tenant is null then
    raise exception 'log_ai_usage: loja não encontrada (tenant %, conta %, inbox %)', p_tenant, p_account_id, p_inbox_id;
  end if;

  insert into public.ai_usage (tenant_id, model, agent_type, prompt_tokens, completion_tokens, conversation_id, execution_id)
  values (
    v_tenant,
    lower(coalesce(nullif(btrim(p_model), ''), 'desconhecido')),
    p_agent_type,
    greatest(coalesce(p_prompt_tokens, 0), 0),
    greatest(coalesce(p_completion_tokens, 0), 0),
    p_conversation_id,
    p_execution_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.log_workflow_error(
  p_message         text,
  p_workflow_id     text   default null,
  p_workflow_name   text   default null,
  p_execution_id    text   default null,
  p_execution_url   text   default null,
  p_node_name       text   default null,
  p_tenant          uuid   default null,
  p_account_id      bigint default null,
  p_inbox_id        bigint default null,
  p_conversation_id text   default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  insert into public.workflow_errors (
    tenant_id, workflow_id, workflow_name, execution_id, execution_url, node_name, message, conversation_id
  )
  values (
    public.resolve_tenant_for_admin(p_tenant, p_account_id, p_inbox_id),
    p_workflow_id, p_workflow_name, p_execution_id, p_execution_url, p_node_name,
    left(coalesce(nullif(btrim(p_message), ''), 'Erro sem mensagem'), 2000),
    p_conversation_id
  )
  on conflict (execution_id) where execution_id is not null do nothing
  returning id into v_id;

  return v_id;
end;
$$;

-- 12. Leitura agregada para o painel ------------------------------------------------

create or replace function public.admin_store_rows(p_month_start timestamptz, p_month_end timestamptz default null)
returns table (
  tenant_id            uuid,
  store_id             uuid,
  store_name           text,
  tenant_name          text,
  slug                 text,
  owner_id             uuid,
  owner_email          text,
  created_at           timestamptz,
  onboarding_step      text,
  tenant_active        boolean,
  city                 text,
  state                text,
  cars_total           bigint,
  cars_available       bigint,
  cars_reserved        bigint,
  cars_sold            bigint,
  photos_total         bigint,
  inventory_value      numeric,
  salespeople_total    bigint,
  ai_calls             bigint,
  ai_conversations     bigint,
  ai_prompt_tokens     bigint,
  ai_completion_tokens bigint,
  ai_cost_usd          numeric,
  ai_unpriced_calls    bigint,
  errors_open          bigint,
  errors_month         bigint,
  blocked_at           timestamptz,
  block_reason         text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    s.id,
    coalesce(s.name, t.nome),
    t.nome,
    t.slug,
    s.owner_id,
    u.email::text,
    coalesce(s.created_at, now()),
    s.onboarding_step::text,
    t.ativo,
    s.address_city,
    s.address_state,
    coalesce(c.total, 0),
    coalesce(c.available, 0),
    coalesce(c.reserved, 0),
    coalesce(c.sold, 0),
    coalesce(p.total, 0),
    coalesce(c.inventory_value, 0),
    coalesce(sp.total, 0),
    coalesce(ai.calls, 0),
    coalesce(ai.conversations, 0),
    coalesce(ai.prompt_tokens, 0),
    coalesce(ai.completion_tokens, 0),
    coalesce(ai.cost_usd, 0),
    coalesce(ai.unpriced, 0),
    coalesce(e.open, 0),
    coalesce(e.month, 0),
    b.blocked_at,
    b.reason
  from public.tenants t
  left join lateral (
    select * from public.stores s2 where s2.tenant_id = t.id order by s2.created_at limit 1
  ) s on true
  left join auth.users u on u.id = s.owner_id
  left join lateral (
    select count(*) as total,
           count(*) filter (where status = 'ativo')     as available,
           count(*) filter (where status = 'reservado') as reserved,
           count(*) filter (where status = 'vendido')   as sold,
           sum(price_brl) filter (where status = 'ativo') as inventory_value
    from public.cars where cars.tenant_id = t.id
  ) c on true
  left join lateral (
    select count(*) as total from public.car_photos where car_photos.tenant_id = t.id
  ) p on true
  left join lateral (
    select count(*) as total from public.salespeople where salespeople.tenant_id = t.id
  ) sp on true
  left join lateral (
    select count(*) as calls,
           count(distinct a.conversation_id) as conversations,
           sum(a.prompt_tokens) as prompt_tokens,
           sum(a.completion_tokens) as completion_tokens,
           sum(a.prompt_tokens * mp.input_usd_per_1m / 1e6 + a.completion_tokens * mp.output_usd_per_1m / 1e6) as cost_usd,
           count(*) filter (where mp.model is null) as unpriced
    from public.ai_usage a
    left join public.ai_model_prices mp on mp.model = a.model
    where a.tenant_id = t.id and a.occurred_at >= p_month_start
      and (p_month_end is null or a.occurred_at < p_month_end)
  ) ai on true
  left join lateral (
    select count(*) filter (where resolved_at is null) as open,
           count(*) filter (where occurred_at >= p_month_start
                              and (p_month_end is null or occurred_at < p_month_end)) as month
    from public.workflow_errors where workflow_errors.tenant_id = t.id
  ) e on true
  left join public.store_access_blocks b on b.tenant_id = t.id;
$$;

create or replace function public.admin_monthly_series(p_months integer default 6, p_tenant uuid default null)
returns table (
  month                  date,
  ai_calls               bigint,
  ai_conversations       bigint,
  ai_prompt_tokens       bigint,
  ai_completion_tokens   bigint,
  ai_cost_usd            numeric,
  payments_brl           numeric,
  new_stores             bigint,
  errors                 bigint,
  chatwoot_conversations bigint,
  chatwoot_incoming      bigint,
  chatwoot_outgoing      bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date as current_month
  ),
  months as (
    select (b.current_month - make_interval(months => g))::date as month
    from bounds b, generate_series(0, greatest(least(p_months, 24), 1) - 1) g
  )
  select
    m.month,
    coalesce(ai.calls, 0),
    coalesce(ai.conversations, 0),
    coalesce(ai.prompt_tokens, 0),
    coalesce(ai.completion_tokens, 0),
    coalesce(ai.cost_usd, 0),
    coalesce(pay.total, 0),
    coalesce(st.total, 0),
    coalesce(er.total, 0),
    coalesce(cw.conversations, 0),
    coalesce(cw.incoming, 0),
    coalesce(cw.outgoing, 0)
  from months m
  left join lateral (
    select count(*) as calls,
           count(distinct a.conversation_id) as conversations,
           sum(a.prompt_tokens) as prompt_tokens,
           sum(a.completion_tokens) as completion_tokens,
           sum(a.prompt_tokens * mp.input_usd_per_1m / 1e6 + a.completion_tokens * mp.output_usd_per_1m / 1e6) as cost_usd
    from public.ai_usage a
    left join public.ai_model_prices mp on mp.model = a.model
    where date_trunc('month', a.occurred_at at time zone 'America/Sao_Paulo')::date = m.month
      and (p_tenant is null or a.tenant_id = p_tenant)
  ) ai on true
  left join lateral (
    select sum(amount_brl) as total from public.store_payments sp
    where sp.reference_month = m.month and (p_tenant is null or sp.tenant_id = p_tenant)
  ) pay on true
  left join lateral (
    select count(*) as total from public.stores s
    where date_trunc('month', s.created_at at time zone 'America/Sao_Paulo')::date = m.month
      and (p_tenant is null or s.tenant_id = p_tenant)
  ) st on true
  left join lateral (
    select count(*) as total from public.workflow_errors w
    where date_trunc('month', w.occurred_at at time zone 'America/Sao_Paulo')::date = m.month
      and (p_tenant is null or w.tenant_id = p_tenant)
  ) er on true
  left join lateral (
    select sum(conversations) as conversations, sum(incoming_messages) as incoming, sum(outgoing_messages) as outgoing
    from public.store_monthly_metrics mm
    where mm.month = m.month and (p_tenant is null or mm.tenant_id = p_tenant)
  ) cw on true
  order by m.month;
$$;

create or replace function public.admin_ai_usage_by_model(
  p_month_start timestamptz,
  p_month_end   timestamptz default null,
  p_tenant      uuid        default null
)
returns table (
  model             text,
  calls             bigint,
  prompt_tokens     bigint,
  completion_tokens bigint,
  cost_usd          numeric,
  priced            boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select a.model,
         count(*),
         sum(a.prompt_tokens),
         sum(a.completion_tokens),
         coalesce(sum(a.prompt_tokens * mp.input_usd_per_1m / 1e6 + a.completion_tokens * mp.output_usd_per_1m / 1e6), 0),
         bool_and(mp.model is not null)
  from public.ai_usage a
  left join public.ai_model_prices mp on mp.model = a.model
  where a.occurred_at >= p_month_start
    and (p_month_end is null or a.occurred_at < p_month_end)
    and (p_tenant is null or a.tenant_id = p_tenant)
  group by a.model
  order by 5 desc;
$$;

create or replace function public.admin_latest_health()
returns setof public.store_health_checks
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (tenant_id) *
  from public.store_health_checks
  order by tenant_id, checked_at desc;
$$;

-- 13. Exclusão total de uma loja ---------------------------------------------------
-- Descobre sozinha toda tabela do schema public que tenha a coluna tenant_id, o que
-- inclui tabelas criadas pelo N8N. A prévia mostra quantas linhas saem de cada uma.

create or replace function public.admin_tenant_tables()
returns table (table_name text)
language sql
stable
security definer
set search_path = public
as $$
  select c.table_name::text
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public'
    and c.column_name = 'tenant_id'
    and t.table_type = 'BASE TABLE'
    and c.table_name not in ('store_payments')  -- histórico financeiro preservado
  order by 1;
$$;

create or replace function public.admin_purge_preview(p_tenant uuid)
returns table (table_name text, row_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select * from public.admin_tenant_tables() loop
    table_name := r.table_name;
    execute format('select count(*) from public.%I where tenant_id::text = $1::text', r.table_name)
      into row_count using p_tenant;
    return next;
  end loop;

  table_name := 'tenants';
  select count(*) into row_count from public.tenants where id = p_tenant;
  return next;
end;
$$;

create or replace function public.admin_purge_tenant(p_tenant uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining text[];
  v_deleted   jsonb := '{}'::jsonb;
  v_progress  boolean;
  v_pass      integer := 0;
  v_count     bigint;
  v_name      text;
  t           text;
begin
  select nome into v_name from public.tenants where id = p_tenant;
  if not found then
    raise exception 'Loja não encontrada.';
  end if;

  update public.store_payments set tenant_id = null, store_name = coalesce(store_name, v_name)
  where tenant_id = p_tenant;

  select array_agg(table_name) into v_remaining from public.admin_tenant_tables();

  -- Apaga em passadas: uma tabela que ainda é referenciada por outra falha por
  -- chave estrangeira e é tentada de novo na passada seguinte.
  while coalesce(array_length(v_remaining, 1), 0) > 0 loop
    v_pass := v_pass + 1;
    v_progress := false;

    foreach t in array v_remaining loop
      begin
        execute format('delete from public.%I where tenant_id::text = $1::text', t) using p_tenant;
        get diagnostics v_count = row_count;
        v_deleted := v_deleted || jsonb_build_object(t, v_count);
        v_remaining := array_remove(v_remaining, t);
        v_progress := true;
      exception when foreign_key_violation then
        null;
      end;
    end loop;

    if not v_progress or v_pass > 12 then
      raise exception 'Não foi possível apagar as tabelas % (dependência não resolvida). Nada foi apagado.', v_remaining;
    end if;
  end loop;

  delete from public.tenants where id = p_tenant;
  get diagnostics v_count = row_count;
  v_deleted := v_deleted || jsonb_build_object('tenants', v_count);

  return v_deleted;
end;
$$;

-- 14. Permissões das funções ---------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'public.enforce_access_allowlist()',
    'public.mark_access_allowlist_used()',
    'public.ensure_store_billing()',
    'public.admin_audit_log_is_append_only()',
    'public.resolve_tenant_for_admin(uuid, bigint, bigint)',
    'public.log_ai_usage(text, integer, integer, uuid, bigint, bigint, text, text, text)',
    'public.log_workflow_error(text, text, text, text, text, text, uuid, bigint, bigint, text)',
    'public.admin_store_rows(timestamptz, timestamptz)',
    'public.admin_monthly_series(integer, uuid)',
    'public.admin_ai_usage_by_model(timestamptz, timestamptz, uuid)',
    'public.admin_latest_health()',
    'public.admin_tenant_tables()',
    'public.admin_purge_preview(uuid)',
    'public.admin_purge_tenant(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- owns_tenant continua disponível para as policies do lojista.
grant execute on function public.owns_tenant(uuid) to authenticated, service_role;
