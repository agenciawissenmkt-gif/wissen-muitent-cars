-- 0009_vendedores_no_contexto.sql
--
-- O fluxo do agente ja sabia transferir para um vendedor especifico quando o
-- cliente pedia pelo nome ("quero falar com o Miguel"). O problema e que a
-- equipe estava escrita na unha dentro do no do n8n: os ids 2, 3 e 5 do
-- Chatwoot, com os apelidos de tres pessoas de UMA loja.
--
-- Em qualquer outra loja aquilo atribuiria a conversa aos usuarios 2, 3 e 5
-- daquela conta -- pessoas completamente diferentes. Num produto multi-tenant
-- isso e um vazamento esperando acontecer.
--
-- Aqui o tenant_context passa a devolver a equipe da propria loja, e o no do
-- n8n le dali. Quando a loja ainda nao tem vendedor vinculado ao Chatwoot, a
-- lista vem vazia e o fluxo simplesmente respeita o rodizio do Chatwoot em vez
-- de chutar um id.

do $do$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'tenant_context';

  if src is null then raise exception 'tenant_context nao encontrada'; end if;
  if position('''vendedores''' in src) > 0 then return; end if;

  src := replace(
    src,
    '''found'', true,',
    '''found'', true,' || chr(10) ||
    '    ''vendedores'', coalesce((' || chr(10) ||
    '      select jsonb_agg(jsonb_build_object(''nome'', s.name, ''chatwoot_user_id'', s.chatwoot_user_id) order by s.created_at)' || chr(10) ||
    '      from public.salespeople s' || chr(10) ||
    '      where s.tenant_id = t.id and s.chatwoot_user_id is not null' || chr(10) ||
    '    ), ''[]''::jsonb),'
  );

  execute src;
end
$do$;

notify pgrst, 'reload schema';
