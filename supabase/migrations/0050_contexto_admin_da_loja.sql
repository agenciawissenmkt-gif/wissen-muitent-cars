-- tenant_context passa a informar o administrador da loja no Chatwoot.
--
-- O no "Chatwoot - Stop AI" da Julia atribuia a conversa sempre ao usuario 1 do
-- Chatwoot. Na w Multimarcas o usuario 1 e o dono; em qualquer outra loja e
-- outra pessoa ou nem existe na conta -- o Chatwoot recusava, a execucao da
-- Julia quebrava e a rede de seguranca mandava "Tive um imprevisto" ao cliente.
-- Agora o fluxo usa admin_chatwoot_id: o primeiro administrador cadastrado da
-- propria loja.
create or replace function public.tenant_context(p_account_id bigint, p_inbox_id bigint default null)
returns jsonb
language sql
stable
set search_path = public, extensions
as $function$
  select jsonb_build_object(
    'found', true,
    'vendedores', coalesce((
      select jsonb_agg(jsonb_build_object('nome', s.name, 'chatwoot_user_id', s.chatwoot_user_id) order by s.created_at)
      from public.salespeople s
      where s.tenant_id = t.id and s.chatwoot_user_id is not null and (coalesce(s.role, 'agent') = 'agent' or not exists (select 1 from public.salespeople s2 where s2.tenant_id = t.id and s2.chatwoot_user_id is not null and coalesce(s2.role, 'agent') = 'agent'))
    ), '[]'::jsonb),
    'admin_chatwoot_id', (
      select s.chatwoot_user_id from public.salespeople s
      where s.tenant_id = t.id and s.chatwoot_user_id is not null and s.role = 'administrator'
      order by s.created_at
      limit 1
    ),
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
    'team_atendimento_id', s.team_atendimento_id,
    'team_descoberta_id', s.team_descoberta_id,
    'team_fechamento_id', s.team_fechamento_id,
    'team_encantamento_id', s.team_encantamento_id,
    'horario_atendimento', s.horario_atendimento,
    'ai_hours', s.ai_hours,
    'endereco_loja', s.endereco_loja,
    'followup_ativo', s.followup_ativo,
    'prompts', coalesce((
      select jsonb_object_agg(a.agent_type, a.system_prompt)
      from public.tenant_agents a
      where a.tenant_id = t.id and a.ativo
    ), '{}'::jsonb),
    'models', coalesce((
      select jsonb_object_agg(a.agent_type, jsonb_build_object('model', a.model, 'temperature', a.temperature))
      from public.tenant_agents a
      where a.tenant_id = t.id and a.ativo
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
$function$;
