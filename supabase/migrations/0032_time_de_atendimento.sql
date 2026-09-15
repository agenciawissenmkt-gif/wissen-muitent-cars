-- 0032_time_de_atendimento.sql
--
-- Duas coisas precisam existir para a Julia entregar a conversa a um time:
-- a chave no tenant_context e o id gravado em tenant_settings. So a primeira
-- estava resolvida -- e mesmo assim fora do repositorio.
--
-- No banco de producao o tenant_context ja devolve team_atendimento_id (e os
-- outros tres times): alguem alterou a funcao direto no SQL editor, sem
-- migration. Um banco reconstruido a partir daqui nao teria essa chave, e o no
-- "Chatwoot - Transfere ao time atendimento" leria undefined. Esta migration
-- fecha essa diferenca -- em producao ela nao faz nada, porque o guard abaixo
-- ve a chave e sai.
--
-- O que continua faltando e a SEGUNDA parte, e essa e do painel: das 6 lojas,
-- so duas tinham tenant_settings.team_atendimento_id preenchido, as duas na
-- mao. Para as outras -- inclusive a JC CAR VEICULOS, que e cliente real -- o
-- valor e null, e o passo de transferir vira um POST com team_id: null, que
-- LIMPA o time em vez de definir um. O handoff so nao quebra porque o rodizio
-- atribui um vendedor logo depois.
--
-- A etapa 3 do painel passa a criar (ou reaproveitar) o time "atendimento" na
-- central da loja e gravar o id aqui. Ver ensureTeamAtendimento em
-- server/lib/chatwoot-account.js.

do $do$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'tenant_context';

  if src is null then raise exception 'tenant_context nao encontrada'; end if;
  if position('''team_atendimento_id''' in src) > 0 then return; end if;

  src := replace(
    src,
    '''chatwoot_token'', s.chatwoot_token,',
    '''chatwoot_token'', s.chatwoot_token,' || chr(10) ||
    '    ''team_atendimento_id'', s.team_atendimento_id,'
  );

  execute src;
end
$do$;

notify pgrst, 'reload schema';
