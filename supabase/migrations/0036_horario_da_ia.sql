-- 0036: o horario da IA passa a valer de verdade
--
-- O campo tenant_settings.horario_atendimento ja existia e o painel ja
-- gravava nele ("24h" ou "18:00-08:00"). So que nenhuma workflow lia esse
-- valor: a Julia atendia 24 horas em todas as lojas, nao importa o que o
-- lojista escolhesse. A w Multimarcas esta com 18:00-08:00 desde sempre e
-- nunca parou de atender.
--
-- Aqui o campo vira estrutura, com janela separada para a semana e para o
-- fim de semana, e passa a chegar na Julia pelo tenant_context.
--
-- O horario da LOJA (stores.business_hours) nao e tocado. Sao coisas
-- diferentes: um diz quando a loja abre, o outro diz quando a IA fala.

alter table public.tenant_settings
  add column if not exists ai_hours jsonb;

comment on column public.tenant_settings.ai_hours is
  'Janela em que a Julia pode responder. {modo: 24h|janela|desligado, semana:{ativo,abre,fecha}, fds:{ativo,abre,fecha}}. Fora dela ela fica muda e a conversa e reservada para um vendedor.';

-- Traz o que ja estava no campo antigo, para ninguem perder configuracao.
update public.tenant_settings
set ai_hours = case
  when ai_hours is not null then ai_hours
  when coalesce(horario_atendimento, '24h') = '24h' then
    jsonb_build_object(
      'modo', '24h',
      'semana', jsonb_build_object('ativo', true, 'abre', '00:00', 'fecha', '23:59'),
      'fds',    jsonb_build_object('ativo', true, 'abre', '00:00', 'fecha', '23:59')
    )
  when horario_atendimento ~ '^[0-9]{2}:[0-9]{2}-[0-9]{2}:[0-9]{2}$' then
    jsonb_build_object(
      'modo', 'janela',
      'semana', jsonb_build_object('ativo', true,
        'abre',  split_part(horario_atendimento, '-', 1),
        'fecha', split_part(horario_atendimento, '-', 2)),
      'fds', jsonb_build_object('ativo', true,
        'abre',  split_part(horario_atendimento, '-', 1),
        'fecha', split_part(horario_atendimento, '-', 2))
    )
  else
    jsonb_build_object(
      'modo', '24h',
      'semana', jsonb_build_object('ativo', true, 'abre', '00:00', 'fecha', '23:59'),
      'fds',    jsonb_build_object('ativo', true, 'abre', '00:00', 'fecha', '23:59')
    )
end
where ai_hours is null;

-- O tenant_context e remendado no lugar, como nas migracoes 0032 a 0034:
-- le a definicao atual e injeta o campo novo. Assim nenhuma mudanca
-- anterior da funcao se perde.
do $$
declare
  def text;
  novo text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'tenant_context'
  limit 1;

  if def is null then
    raise notice '0036: tenant_context nao existe, nada a fazer';
    return;
  end if;

  if position('ai_hours' in def) > 0 then
    raise notice '0036: tenant_context ja devolve ai_hours';
    return;
  end if;

  novo := regexp_replace(
    def,
    '(''horario_atendimento''\s*,\s*s\.horario_atendimento\s*,)',
    E'\\1\n      ''ai_hours'', s.ai_hours,',
    'g'
  );

  if novo = def then
    raise exception '0036: nao achei onde encaixar ai_hours no tenant_context';
  end if;

  execute novo;
  raise notice '0036: tenant_context agora devolve ai_hours';
end $$;
