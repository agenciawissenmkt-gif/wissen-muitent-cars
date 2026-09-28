-- 0043: relatório semanal da Júlia para o lojista
--
-- O lojista cadastra no painel das lojas quem recebe o relatório (até 3 números
-- de WhatsApp e 3 e-mails). Toda sexta às 19h (horário de Brasília) o Painel
-- Empresarial gera o PDF da semana (sábado 00h até sexta 19h), guarda no bucket
-- privado `relatorios` e envia pelo WhatsApp da Wissen e por e-mail. O admin
-- também pode mandar na hora, cobrindo do último sábado até o momento do envio.
--
-- Mesma migração nos dois repositórios (painel das lojas e Painel Empresarial).

-- 1. Quem recebe --------------------------------------------------------------------

create table if not exists public.report_settings (
  tenant_id        uuid primary key references public.tenants (id) on delete cascade,
  whatsapp_numbers text[] not null default '{}',
  emails           text[] not null default '{}',
  active           boolean not null default true,
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);

-- Normaliza e confere antes de gravar: número só com dígitos e DDI 55, e-mail
-- em minúsculas. Uma mensagem clara volta para a tela se algo estiver errado.
create or replace function public.normalize_report_settings()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  n text;
  e text;
  numeros text[] := '{}';
  emails text[] := '{}';
begin
  foreach n in array coalesce(new.whatsapp_numbers, '{}') loop
    n := regexp_replace(coalesce(n, ''), '\D', '', 'g');
    continue when n = '';
    if length(n) in (10, 11) then n := '55' || n; end if;
    if n !~ '^55[1-9][0-9]{9,10}$' then
      raise exception 'Número de WhatsApp inválido: %. Use DDD + número, por exemplo (41) 99999-9999.', n
        using errcode = '22023';
    end if;
    if not n = any (numeros) then numeros := numeros || n; end if;
  end loop;

  foreach e in array coalesce(new.emails, '{}') loop
    e := lower(btrim(coalesce(e, '')));
    continue when e = '';
    if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'E-mail inválido: %.', e using errcode = '22023';
    end if;
    if not e = any (emails) then emails := emails || e; end if;
  end loop;

  if cardinality(numeros) > 3 or cardinality(emails) > 3 then
    raise exception 'Cadastre no máximo 3 números e 3 e-mails.' using errcode = '22023';
  end if;

  new.whatsapp_numbers := numeros;
  new.emails := emails;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists report_settings_normalize on public.report_settings;
create trigger report_settings_normalize
  before insert or update on public.report_settings
  for each row execute function public.normalize_report_settings();

alter table public.report_settings enable row level security;
revoke all on public.report_settings from anon, authenticated;
grant select, insert, update on public.report_settings to authenticated;

drop policy if exists report_settings_select on public.report_settings;
create policy report_settings_select on public.report_settings
  for select to authenticated using (public.owns_tenant(tenant_id));
drop policy if exists report_settings_insert on public.report_settings;
create policy report_settings_insert on public.report_settings
  for insert to authenticated with check (public.owns_tenant(tenant_id));
drop policy if exists report_settings_update on public.report_settings;
create policy report_settings_update on public.report_settings
  for update to authenticated using (public.owns_tenant(tenant_id)) with check (public.owns_tenant(tenant_id));

-- 2. Histórico de relatórios ----------------------------------------------------------

create table if not exists public.store_reports (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  kind             text not null check (kind in ('semanal', 'manual')),
  week_key         text,
  period_start     timestamptz not null,
  period_end       timestamptz not null,
  status           text not null default 'gerando'
                   check (status in ('gerando', 'enviado', 'parcial', 'falhou', 'sem_destino')),
  attempts         integer not null default 1,
  metrics          jsonb,
  insights         jsonb,
  pdf_path         text,
  whatsapp_to      text[] not null default '{}',
  whatsapp_sent_at timestamptz,
  email_to         text[] not null default '{}',
  email_sent_at    timestamptz,
  errors           text[] not null default '{}',
  requested_by     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Um relatório semanal por loja por semana: o agendamento pode rodar de novo sem duplicar.
create unique index if not exists store_reports_week_uidx
  on public.store_reports (tenant_id, week_key) where kind = 'semanal';
create index if not exists store_reports_tenant_idx on public.store_reports (tenant_id, created_at desc);

alter table public.store_reports enable row level security;
revoke all on public.store_reports from anon, authenticated;
grant select on public.store_reports to authenticated;

drop policy if exists store_reports_select on public.store_reports;
create policy store_reports_select on public.store_reports
  for select to authenticated using (public.owns_tenant(tenant_id));

-- 3. Data da venda do carro -------------------------------------------------------------
-- "Carros vendidos na semana/no mês" precisa saber QUANDO o carro virou vendido.

alter table public.cars add column if not exists sold_at timestamptz;

update public.cars
   set sold_at = coalesce(updated_at, created_at)
 where status = 'vendido' and sold_at is null;

create or replace function public.cars_track_sold_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'vendido' then
    if tg_op = 'INSERT' then
      new.sold_at := coalesce(new.sold_at, now());
    elsif old.status is distinct from 'vendido' then
      new.sold_at := now();
    end if;
  else
    new.sold_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists cars_sold_at on public.cars;
create trigger cars_sold_at
  before insert or update of status on public.cars
  for each row execute function public.cars_track_sold_at();

create index if not exists cars_sold_at_idx on public.cars (tenant_id, sold_at) where sold_at is not null;

-- 4. Onde o PDF fica guardado -----------------------------------------------------------
-- Bucket privado. O lojista só lê a pasta da própria loja; quem grava é o servidor.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('relatorios', 'relatorios', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists relatorios_read on storage.objects;
create policy relatorios_read on storage.objects
  for select to authenticated
  using (bucket_id = 'relatorios' and public.owns_tenant(nullif((storage.foldername(name))[1], '')::uuid));

-- 5. Número que envia -------------------------------------------------------------------
-- Instância da Evolution do WhatsApp da Wissen, (41) 99509-6228. Troca-se em Configurações.

insert into public.admin_settings (key, value) values
  ('report_instance', '"wissen-wise-multimarcas"'::jsonb),
  ('report_enabled',  'true'::jsonb)
on conflict (key) do nothing;
