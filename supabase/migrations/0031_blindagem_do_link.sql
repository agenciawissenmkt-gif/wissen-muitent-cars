-- 0031_blindagem_do_link.sql
--
-- A 0030 ensinou a Julia a nao inventar link. Esta aqui garante que ela nunca
-- receba um link que nao deveria existir.
--
-- O caso: o campo `website` da loja guardava `https://wissen-cars.vercel.app/`
-- -- o endereco do painel da plataforma -- e a funcao que monta o prompt
-- copiava esse valor para dentro dele sem olhar. Quando o cliente perguntou "E
-- o site?", a Julia leu o proprio prompt e respondeu com o endereco do painel.
-- Ela acertou; o dado e que estava errado.
--
-- Corrigir o cadastro resolve esta loja. Nao resolve a proxima: e um campo de
-- texto livre que qualquer lojista preenche, e num produto whitelabel o cliente
-- final jamais pode ver o endereco da plataforma que atende a loja dele. Entao
-- a blindagem tem de estar no caminho, nao no dado.
--
-- Duas funcoes pequenas passam a filtrar o que entra no prompt:
--
--   link_publico   -- devolve o endereco, ou NULL se ele apontar para a
--                     infraestrutura (vercel, easypanel, supabase, ngrok,
--                     localhost). Nenhuma concessionaria tem site nesses
--                     dominios; se tiver, ficar sem site no prompt e um preco
--                     barato perto de vazar o painel.
--
--   arroba_publica -- devolve o @ limpo, ou NULL se nao for um @ possivel.
--                     "wissen oficial" tem espaco no meio: nao e um perfil,
--                     e um nome que alguem digitou no campo errado. Aceita
--                     tambem a URL completa do Instagram e extrai o perfil.
--
-- O prompt e alterado por cirurgia sobre a propria definicao da funcao: leio o
-- fonte, troco exatamente as tres linhas, e mando executar. Se qualquer uma das
-- tres nao for encontrada -- porque a funcao mudou desde que isto foi escrito
-- -- nada e aplicado e a migracao falha dizendo o motivo.

create or replace function public.link_publico(p_url text)
returns text
language sql
immutable
as $function$
  select case
    when nullif(btrim(coalesce(p_url, '')), '') is null then null
    when lower(btrim(p_url)) ~ '(^|[/.@])(vercel\.app|easypanel\.host|supabase\.(co|in)|onrender\.com|railway\.app|fly\.dev|netlify\.app|ngrok(-free)?\.(app|io)|localhost|127\.0\.0\.1)([/:?#]|$)' then null
    else btrim(p_url)
  end
$function$;

comment on function public.link_publico(text) is
  'Endereco que pode ser mostrado ao cliente final. NULL quando aponta para a infraestrutura da plataforma.';

create or replace function public.arroba_publica(p_handle text)
returns text
language sql
immutable
as $function$
  select case
    when s.h is null then null
    when s.h ~ '\s' then null
    when s.h !~ '^[A-Za-z0-9._]{1,30}$' then null
    else s.h
  end
  from (
    select nullif(btrim(regexp_replace(
             regexp_replace(coalesce(p_handle, ''), '^\s*(https?://)?(www\.)?instagram\.com/', '', 'i'),
             '^@+|/+$', '', 'g')), '') as h
  ) s
$function$;

comment on function public.arroba_publica(text) is
  'Perfil do Instagram pronto para mostrar, sem o @. NULL quando o campo nao contem um perfil valido.';

do $do$
declare
  v_def  text;
  v_novo text;
  v_site_old  text := $f$if nullif(btrim(coalesce(v_store.website, '')), '') is not null then v_linhas := v_linhas || ('- Site: ' || btrim(v_store.website)); end if;$f$;
  v_site_new  text := $f$if public.link_publico(v_store.website) is not null then v_linhas := v_linhas || ('- Site: ' || public.link_publico(v_store.website)); end if;$f$;
  v_insta_old text := $f$if nullif(btrim(coalesce(v_store.instagram, '')), '') is not null then v_linhas := v_linhas || ('- Instagram: @' || btrim(v_store.instagram)); end if;$f$;
  v_insta_new text := $f$if public.arroba_publica(v_store.instagram) is not null then v_linhas := v_linhas || ('- Instagram: @' || public.arroba_publica(v_store.instagram)); end if;$f$;
  v_mapa_old  text := $f$if nullif(btrim(coalesce(v_store.maps_url, '')), '') is not null then v_linhas := v_linhas || ('- Link do mapa: ' || v_store.maps_url); end if;$f$;
  v_mapa_new  text := $f$if public.link_publico(v_store.maps_url) is not null then v_linhas := v_linhas || ('- Link do mapa: ' || public.link_publico(v_store.maps_url)); end if;$f$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'render_agent_prompt';

  if v_def is null then
    raise exception 'render_agent_prompt nao existe neste banco';
  end if;

  if position('public.link_publico(v_store.website)' in v_def) > 0 then
    raise notice 'render_agent_prompt ja estava blindada.';
  else
    if position(v_site_old  in v_def) = 0 then raise exception 'Nao encontrei a linha do site em render_agent_prompt -- a funcao mudou desde a 0031'; end if;
    if position(v_insta_old in v_def) = 0 then raise exception 'Nao encontrei a linha do instagram em render_agent_prompt'; end if;
    if position(v_mapa_old  in v_def) = 0 then raise exception 'Nao encontrei a linha do mapa em render_agent_prompt'; end if;

    v_novo := replace(v_def,  v_site_old,  v_site_new);
    v_novo := replace(v_novo, v_insta_old, v_insta_new);
    v_novo := replace(v_novo, v_mapa_old,  v_mapa_new);

    if v_novo = v_def then raise exception 'A cirurgia nao alterou nada'; end if;

    execute v_novo;
  end if;
end
$do$;

-- Reescreve os prompts ja gravados com a funcao nova.
update public.tenant_agents set system_prompt = system_prompt;

do $do$
declare
  v_infra int;
  v_espaco int;
  v_site_ok text;
begin
  -- Prova final: nenhum prompt no ar carrega endereco de infraestrutura.
  select count(*) into v_infra
    from public.tenant_agents
   where system_prompt ~* '(vercel\.app|easypanel\.host|supabase\.(co|in)|ngrok)';
  if v_infra <> 0 then
    raise exception 'Ainda ha % prompt(s) com endereco de infraestrutura', v_infra;
  end if;

  -- E nenhum @ com espaco no meio, que nunca foi um perfil de verdade.
  select count(*) into v_espaco
    from public.tenant_agents
   where system_prompt ~ '- Instagram: @[^\n]* ';
  if v_espaco <> 0 then
    raise exception 'Ainda ha % prompt(s) com @ invalido', v_espaco;
  end if;

  -- Um site legitimo continua passando.
  select public.link_publico('https://autoscuritiba.com.br') into v_site_ok;
  if v_site_ok is distinct from 'https://autoscuritiba.com.br' then
    raise exception 'A blindagem esta barrando site legitimo: %', coalesce(v_site_ok, '<null>');
  end if;

  if public.link_publico('https://wissen-cars.vercel.app/') is not null then
    raise exception 'A blindagem nao barrou o endereco da plataforma';
  end if;

  if public.arroba_publica('wissen oficial') is not null then
    raise exception 'A blindagem nao barrou o @ com espaco';
  end if;

  if public.arroba_publica('https://www.instagram.com/galerinhadobrick/') is distinct from 'galerinhadobrick' then
    raise exception 'A extracao do perfil a partir da URL falhou';
  end if;
end
$do$;
