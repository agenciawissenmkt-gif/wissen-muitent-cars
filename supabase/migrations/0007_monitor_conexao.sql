-- 0007_monitor_conexao.sql
--
-- Blindagem da conexão do WhatsApp.
--
-- Um workflow do n8n ("Wissen Cars - Monitor de conexao") pergunta de 5 em 5
-- minutos para a Evolution API como está cada instância e grava o resultado
-- aqui. O banco é quem conta as quedas seguidas, levanta a bandeira de alerta
-- e guarda o histórico — assim a regra fica em um lugar só, e não espalhada
-- pelos nós do fluxo.
--
-- O lojista logado enxerga apenas a linha do próprio tenant (policy abaixo).

-- 1. Estado atual de cada loja ------------------------------------------------

create table if not exists public.monitor_conexao (
  tenant_id          uuid primary key references public.tenants(id) on delete cascade,
  instancia          text,
  estado             text,
  ok                 boolean     not null default false,
  desde              timestamptz not null default now(),
  checado_em         timestamptz not null default now(),
  quedas_seguidas    integer     not null default 0,
  recuperacoes       integer     not null default 0,
  ultima_recuperacao timestamptz,
  alerta             boolean     not null default false
);

alter table public.monitor_conexao enable row level security;

-- 2. Histórico ----------------------------------------------------------------

create table if not exists public.monitor_eventos (
  id         bigserial primary key,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  instancia  text,
  estado     text,
  evento     text not null,
  criado_em  timestamptz not null default now()
);

create index if not exists monitor_eventos_tenant_idx
  on public.monitor_eventos (tenant_id, criado_em desc);

alter table public.monitor_eventos enable row level security;

-- 3. Contagem de quedas seguidas e bandeira de alerta -------------------------
-- Roda antes da gravação, inclusive no UPDATE que vem do upsert do n8n.

create or replace function public.monitor_conexao_contabiliza()
returns trigger
language plpgsql
as $fn$
declare
  v_limite integer := 3;
begin
  new.checado_em := now();

  if tg_op = 'INSERT' then
    new.quedas_seguidas := case when new.ok then 0 else 1 end;
    new.alerta := false;
    new.recuperacoes := coalesce(new.recuperacoes, 0);
    new.desde := now();
    return new;
  end if;

  new.recuperacoes := old.recuperacoes;
  new.ultima_recuperacao := old.ultima_recuperacao;

  if new.ok then
    new.quedas_seguidas := 0;
    new.alerta := false;
    if old.ok then
      new.desde := old.desde;
    else
      new.desde := now();
      new.recuperacoes := old.recuperacoes + 1;
      new.ultima_recuperacao := now();
    end if;
  else
    new.quedas_seguidas := old.quedas_seguidas + 1;
    new.alerta := (new.quedas_seguidas >= v_limite);
    if old.ok then
      new.desde := now();
    else
      new.desde := old.desde;
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_monitor_conexao_contabiliza on public.monitor_conexao;
create trigger trg_monitor_conexao_contabiliza
before insert or update on public.monitor_conexao
for each row execute function public.monitor_conexao_contabiliza();

-- 4. Registro do que aconteceu ------------------------------------------------

create or replace function public.monitor_conexao_registra_evento()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.monitor_eventos (tenant_id, instancia, estado, evento)
    values (new.tenant_id, new.instancia, new.estado,
            case when new.ok then 'inicio_ok' else 'inicio_falha' end);
    return new;
  end if;

  if old.ok is distinct from new.ok then
    insert into public.monitor_eventos (tenant_id, instancia, estado, evento)
    values (new.tenant_id, new.instancia, new.estado,
            case when new.ok then 'recuperou' else 'caiu' end);
  elsif new.alerta and not old.alerta then
    insert into public.monitor_eventos (tenant_id, instancia, estado, evento)
    values (new.tenant_id, new.instancia, new.estado, 'alerta');
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_monitor_conexao_evento on public.monitor_conexao;
create trigger trg_monitor_conexao_evento
after insert or update on public.monitor_conexao
for each row execute function public.monitor_conexao_registra_evento();

-- 5. RLS: cada lojista só vê a própria loja -----------------------------------

drop policy if exists app_owner_read on public.monitor_conexao;
create policy app_owner_read on public.monitor_conexao
  for select to authenticated
  using (public.owns_tenant(tenant_id));

drop policy if exists app_owner_read on public.monitor_eventos;
create policy app_owner_read on public.monitor_eventos
  for select to authenticated
  using (public.owns_tenant(tenant_id));

-- 6. Visão pronta para o painel -----------------------------------------------
-- security_invoker = true é obrigatório: sem isso a view rodaria com os
-- privilégios do dono e furaria o RLS das tabelas de cima, misturando lojas.

create or replace view public.monitor_lojas as
select
  t.id                 as tenant_id,
  t.nome               as loja,
  m.instancia,
  m.estado,
  m.ok,
  m.quedas_seguidas,
  m.alerta,
  m.desde,
  m.checado_em,
  m.recuperacoes,
  m.ultima_recuperacao,
  case
    when m.tenant_id is null      then 'nunca_checado'
    when m.ok                     then 'conectado'
    when m.estado = 'inexistente' then 'sem_instancia'
    when m.alerta                 then 'fora_do_ar'
    else 'instavel'
  end as situacao
from public.tenants t
left join public.monitor_conexao m on m.tenant_id = t.id;

alter view public.monitor_lojas set (security_invoker = true);

grant select on public.monitor_lojas to authenticated;
grant select on public.monitor_conexao to authenticated;
grant select on public.monitor_eventos to authenticated;
