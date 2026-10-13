-- 0057_integracao_olx.sql
--
-- Base da integracao do estoque com a OLX. Tudo aqui e aditivo: colunas novas
-- com valor padrao e duas tabelas novas. Nenhuma coluna existente muda, nenhuma
-- funcao que a Julia usa e tocada, e enquanto nenhuma loja conectar a OLX nada
-- disso e lido por ninguem.
--
-- 1. Cadastro do carro
--    A OLX exige a placa (carro usado) e marca/modelo/versao do catalogo dela,
--    por codigo. O texto que a loja digita continua sendo o que a Julia usa;
--    os codigos da OLX ficam ao lado, em colunas proprias.
--    Os opcionais sim/nao (chave reserva, manual, blindado, leilao, multas) e a
--    situacao financeira valem para qualquer loja, conectada ou nao.
--
-- 2. olx_conexoes -- uma por loja
--    Guarda a chave de acesso que a OLX devolve quando o lojista autoriza.
--    A chave nunca pode chegar ao navegador: o painel le e altera so as colunas
--    liberadas uma a uma (mesmo esquema da 0024), e a chave fica so para o
--    servidor (service role).
--
-- 3. olx_anuncios -- uma linha por carro enviado
--    O que a OLX respondeu sobre aquele carro: publicado, em analise, recusado e
--    por que. Sem chave estrangeira para `cars` de proposito: quando a loja
--    exclui o carro, a linha precisa sobreviver para o servidor ainda saber qual
--    anuncio tirar do ar na OLX.

alter table public.cars
  add column if not exists placa text,
  add column if not exists situacao_financeira text,
  add column if not exists chave_reserva boolean not null default false,
  add column if not exists manual_proprietario boolean not null default false,
  add column if not exists blindado boolean not null default false,
  add column if not exists de_leilao boolean not null default false,
  add column if not exists com_multas boolean not null default false,
  add column if not exists olx_marca_id integer,
  add column if not exists olx_modelo_id integer,
  add column if not exists olx_versao_id integer,
  add column if not exists olx_marca text,
  add column if not exists olx_modelo text,
  add column if not exists olx_versao text,
  add column if not exists olx_publicar boolean not null default true;

alter table public.cars drop constraint if exists cars_situacao_financeira_check;
alter table public.cars add constraint cars_situacao_financeira_check
  check (situacao_financeira is null or situacao_financeira in ('quitado', 'financiado'));

comment on column public.cars.placa is 'Placa do carro, maiuscula e sem traco. Exigida pela OLX para carro usado, nao aparece no anuncio.';
comment on column public.cars.olx_publicar is 'false quando a loja tirou este carro da OLX pelo painel.';

-- 2. Conexao da loja com a OLX ---------------------------------------------------

create table if not exists public.olx_conexoes (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  access_token text not null,
  conta_nome text,
  conta_email text,
  telefone_anuncio text,
  publicar_tudo boolean not null default true,
  conectado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.olx_conexoes enable row level security;
revoke all on public.olx_conexoes from anon, authenticated;
grant select (tenant_id, conta_nome, conta_email, telefone_anuncio, publicar_tudo, conectado_em, atualizado_em)
  on public.olx_conexoes to authenticated;
grant update (telefone_anuncio, publicar_tudo, atualizado_em) on public.olx_conexoes to authenticated;

drop policy if exists olx_conexoes_select on public.olx_conexoes;
create policy olx_conexoes_select on public.olx_conexoes
  for select to authenticated using (public.owns_tenant(tenant_id));
drop policy if exists olx_conexoes_update on public.olx_conexoes;
create policy olx_conexoes_update on public.olx_conexoes
  for update to authenticated using (public.owns_tenant(tenant_id)) with check (public.owns_tenant(tenant_id));

-- 3. Anuncio de cada carro na OLX -----------------------------------------------

create table if not exists public.olx_anuncios (
  car_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  olx_id text not null unique,
  situacao text not null default 'pendente',
  mensagem text,
  operacao text,
  token_importacao text,
  list_id text,
  url text,
  atualizado_em timestamptz not null default now()
);

alter table public.olx_anuncios drop constraint if exists olx_anuncios_situacao_check;
alter table public.olx_anuncios add constraint olx_anuncios_situacao_check
  check (situacao in ('pendente', 'incompleto', 'enviado', 'em_analise', 'publicado', 'recusado', 'erro', 'removendo', 'removido'));

-- Resumo do ultimo anuncio enviado: salvar sem mudar nada nao manda de novo
-- (cada envio passa pela moderacao da OLX).
alter table public.olx_anuncios add column if not exists conteudo_hash text;

create index if not exists olx_anuncios_tenant on public.olx_anuncios (tenant_id);

alter table public.olx_anuncios enable row level security;
revoke all on public.olx_anuncios from anon, authenticated;
grant select on public.olx_anuncios to authenticated;

drop policy if exists olx_anuncios_select on public.olx_anuncios;
create policy olx_anuncios_select on public.olx_anuncios
  for select to authenticated using (public.owns_tenant(tenant_id));

-- Conferencia: o navegador nao pode ler a chave da OLX.
do $do$
begin
  if exists (
    select 1 from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'olx_conexoes'
       and column_name = 'access_token' and grantee in ('authenticated', 'anon')
  ) then
    raise exception 'A chave da OLX ficou visivel para o navegador';
  end if;
end
$do$;
