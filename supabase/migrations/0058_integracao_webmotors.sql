-- 0058_integracao_webmotors.sql
--
-- Base da integracao do estoque com a Webmotors (Integracao Revendedor, SOAP).
-- Mesmo desenho da 0057 (OLX): tudo aditivo. Colunas novas com valor padrao e
-- duas tabelas novas. Nenhuma coluna existente muda, nenhuma funcao que a Julia
-- usa e tocada, e enquanto nenhuma loja conectar a Webmotors nada disso e lido.
--
-- As chamadas para a Webmotors saem do integrador no Easypanel (IP fixo
-- 187.127.22.205, exigido pela Webmotors), nunca direto da Vercel.
--
-- 1. Cadastro do carro
--    A Webmotors exige marca/modelo/versao pelo codigo do catalogo dela. O texto
--    que a loja digita continua sendo o que a Julia usa; os codigos ficam ao lado.
--    Garantia de fabrica e adaptado para PcD sao campos que so a Webmotors pede.
--
-- 2. webmotors_conexoes -- uma por loja
--    Login do usuario "Integrador de API" da loja (CNPJ, e-mail e senha). A senha
--    fica cifrada e, junto com a chave de sessao, nunca chega ao navegador: o
--    painel le so as colunas liberadas uma a uma (mesmo esquema da 0057).
--
-- 3. webmotors_anuncios -- uma linha por carro enviado
--    Codigo do anuncio na Webmotors, situacao (publicado/erro e por que) e as
--    fotos ja enviadas. Sem chave estrangeira para `cars` de proposito: quando a
--    loja exclui o carro, a linha precisa sobreviver para o servidor saber qual
--    anuncio tirar do ar.

alter table public.cars
  add column if not exists wm_marca_cod integer,
  add column if not exists wm_modelo_cod integer,
  add column if not exists wm_versao_cod integer,
  add column if not exists wm_marca text,
  add column if not exists wm_modelo text,
  add column if not exists wm_versao text,
  add column if not exists wm_publicar boolean not null default true,
  add column if not exists wm_garantia_fabrica boolean not null default false,
  add column if not exists wm_adaptado_pcd boolean not null default false;

comment on column public.cars.wm_publicar is 'false quando a loja tirou este carro da Webmotors pelo painel.';

-- 2. Conexao da loja com a Webmotors ---------------------------------------------

create table if not exists public.webmotors_conexoes (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  cnpj text not null,
  email text not null,
  senha_cifrada text not null,
  hash_sessao text,
  hash_expira_em timestamptz,
  modalidade_cod integer,
  modalidade_nome text,
  publicar_tudo boolean not null default true,
  conectado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.webmotors_conexoes enable row level security;
revoke all on public.webmotors_conexoes from anon, authenticated;
grant select (tenant_id, cnpj, email, modalidade_cod, modalidade_nome, publicar_tudo, conectado_em, atualizado_em)
  on public.webmotors_conexoes to authenticated;

drop policy if exists webmotors_conexoes_select on public.webmotors_conexoes;
create policy webmotors_conexoes_select on public.webmotors_conexoes
  for select to authenticated using (public.owns_tenant(tenant_id));

-- 3. Anuncio de cada carro na Webmotors -------------------------------------------

create table if not exists public.webmotors_anuncios (
  car_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  codigo_anuncio bigint,
  situacao text not null default 'pendente',
  mensagem text,
  conteudo_hash text,
  fotos jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now()
);

alter table public.webmotors_anuncios drop constraint if exists webmotors_anuncios_situacao_check;
alter table public.webmotors_anuncios add constraint webmotors_anuncios_situacao_check
  check (situacao in ('pendente', 'incompleto', 'enviando_fotos', 'publicado', 'erro', 'removido'));

create index if not exists webmotors_anuncios_tenant on public.webmotors_anuncios (tenant_id);

alter table public.webmotors_anuncios enable row level security;
revoke all on public.webmotors_anuncios from anon, authenticated;
grant select (car_id, tenant_id, codigo_anuncio, situacao, mensagem, atualizado_em)
  on public.webmotors_anuncios to authenticated;

drop policy if exists webmotors_anuncios_select on public.webmotors_anuncios;
create policy webmotors_anuncios_select on public.webmotors_anuncios
  for select to authenticated using (public.owns_tenant(tenant_id));

-- Conferencia: o navegador nao pode ler a senha nem a chave de sessao.
do $do$
begin
  if exists (
    select 1 from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'webmotors_conexoes'
       and column_name in ('senha_cifrada', 'hash_sessao') and grantee in ('authenticated', 'anon')
  ) then
    raise exception 'A senha ou a sessao da Webmotors ficou visivel para o navegador';
  end if;
end
$do$;
