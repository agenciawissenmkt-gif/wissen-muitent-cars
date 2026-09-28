-- Blindagem do banco (auditoria de 28/09).
--
-- 1) Funções SECURITY DEFINER abertas para quem não fez login.
--    O Postgres dá EXECUTE para PUBLIC em toda função nova, então o anon herdava
--    o acesso. render_agent_prompt só confere o dono quando há login
--    (auth.uid() não nulo): sem login ela devolvia o prompt completo de qualquer
--    loja a partir do id. O painel das lojas chama estas funções logado
--    (authenticated) e o n8n usa a service_role -- os dois continuam com acesso.
revoke execute on function public.render_agent_prompt(uuid, text) from public, anon;
revoke execute on function public.bootstrap_store(text) from public, anon;
revoke execute on function public.owns_tenant(uuid) from public, anon;

-- Funções de gatilho: o Postgres não confere EXECUTE ao disparar um gatilho,
-- então ninguém precisa chamá-las pela API.
revoke execute on function public.rerender_tenant_prompts() from public, anon, authenticated;
revoke execute on function public.tenant_agents_lock_prompt() from public, anon, authenticated;

-- 2) search_path fixo: sem ele a função resolve nomes pelo search_path de quem
--    chama. "extensions" entra porque a extensão vector passa a morar lá (3).
alter function public.api_cars(uuid, text, text, boolean) set search_path = public, extensions;
alter function public.api_loja(uuid) set search_path = public, extensions;
alter function public.arroba_publica(text) set search_path = public, extensions;
alter function public.carro_detalhes(uuid, text) set search_path = public, extensions;
alter function public.carro_fotos(uuid, text) set search_path = public, extensions;
alter function public.chatwoot_conf() set search_path = public, extensions;
alter function public.estoque_listar(uuid, text) set search_path = public, extensions;
alter function public.faq_ingest_source() set search_path = public, extensions;
alter function public.faq_sync_tenant() set search_path = public, extensions;
alter function public.faq_vec_sync_tenant() set search_path = public, extensions;
alter function public.faq_vec_upsert(uuid, text, jsonb, text) set search_path = public, extensions;
alter function public.get_agent_prompt(uuid, text) set search_path = public, extensions;
alter function public.link_publico(text) set search_path = public, extensions;
alter function public.match_faq(vector, integer, jsonb) set search_path = public, extensions;
alter function public.monitor_conexao_contabiliza() set search_path = public, extensions;
alter function public.monitor_conexao_registra_evento() set search_path = public, extensions;
alter function public.normaliza_busca(text) set search_path = public, extensions;
alter function public.proximo_vendedor(bigint, bigint) set search_path = public, extensions;
alter function public.resolve_tenant(bigint, bigint) set search_path = public, extensions;
alter function public.slugify_pt(text) set search_path = public, extensions;
alter function public.tenant_context(bigint, bigint) set search_path = public, extensions;
alter function public.upsert_lead(uuid, text, text, text, bigint, bigint) set search_path = public, extensions;

-- 3) A extensão vector sai do schema public. A coluna faq_vec.embedding e o
--    índice acompanham sozinhos; a API (PostgREST) já procura em "extensions".
alter extension vector set schema extensions;
