-- 0024_colunas_do_servidor.sql
--
-- A policy `app_owner_all` (0002) e `for all` sobre TODAS as colunas de
-- tenant_settings, tenant_channels e salespeople. O dono da loja escreve nelas
-- direto do navegador, com a anon key e o proprio JWT. O servidor, do outro
-- lado, le algumas dessas colunas como se fossem dado interno confiavel.
--
-- Isso abre tres portas entre lojistas:
--
--   1. salespeople.chatwoot_user_id -> a rota /chatwoot/sso pede a Platform API
--      um link de sessao para esse id. O filtro por tenant_id garante QUAL
--      LINHA, nao o que esta dentro dela. Trocando o id para 3, o lojista A
--      recebe uma sessao autenticada do dono da loja B -- ou do super admin.
--
--   2. tenant_channels.chatwoot_account_id -> o provisionamento aceita o id e
--      adiciona a equipe de A como administradora da conta de B, gravando um
--      token admin de B nas settings de A.
--
--   3. tenant_settings.evolution_base_url -> o servidor mandava a
--      EVOLUTION_API_KEY (a chave global da instalacao) para o endereco escrito
--      ali. Ja corrigido no servidor; a coluna fica travada aqui tambem, para o
--      dia em que alguem reintroduzir a leitura sem lembrar do motivo.
--
-- RLS decide QUAIS LINHAS o lojista alcanca. Quem decide QUAIS COLUNAS ele pode
-- escrever e o privilegio de coluna -- e e a ferramenta certa aqui. Um gatilho
-- tambem barraria, mas quebraria o INSERT do painel: colunas com DEFAULT (como
-- chatwoot_base_url) chegam preenchidas no NEW, e o gatilho nao tem como saber
-- se o valor veio do cliente ou do default. Com privilegio de coluna o default
-- continua se aplicando normalmente.
--
-- O que o painel realmente escreve (conferido em src/core/tenant.tsx e
-- src/screens/implementation/): em tenant_settings apenas `bot_phone` e
-- `horario_atendimento`; em salespeople apenas tenant_id, name, email e role;
-- em tenant_channels, nada -- o painel so le. Nenhuma coluna travada abaixo e
-- escrita pelo navegador hoje.

do $$
declare
  alvo record;
  colunas text;
  protegidas text[];
begin
  for alvo in
    select * from (values
      ('tenant_settings', array[
        'chatwoot_base_url','chatwoot_token','chatwoot_bot_token',
        'evolution_base_url','evolution_instance',
        'team_atendimento_id','team_descoberta_id',
        'team_fechamento_id','team_encantamento_id'
      ]),
      ('tenant_channels', array[
        'chatwoot_account_id','chatwoot_inbox_id','evolution_instance'
      ]),
      ('salespeople', array[
        'chatwoot_user_id'
      ])
    ) as t(tabela, cols)
  loop
    protegidas := alvo.cols;

    -- Lista as colunas que SOBRAM: e nelas que o painel continua escrevendo.
    -- Coluna nova criada no futuro entra aqui automaticamente, o que mantem o
    -- comportamento de hoje em vez de quebrar uma tela sem aviso.
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into colunas
      from information_schema.columns
     where table_schema = 'public'
       and table_name = alvo.tabela
       and not (column_name = any (protegidas));

    execute format('revoke insert, update on public.%I from authenticated', alvo.tabela);
    execute format('grant insert (%s) on public.%I to authenticated', colunas, alvo.tabela);
    execute format('grant update (%s) on public.%I to authenticated', colunas, alvo.tabela);
  end loop;
end
$$;

-- Conferencia: nenhuma coluna protegida pode ter privilegio de escrita para
-- `authenticated`, e as demais precisam continuar gravaveis.
do $do$
declare v_furo int; v_ok int;
begin
  select count(*) into v_furo
    from information_schema.column_privileges
   where grantee = 'authenticated'
     and table_schema = 'public'
     and privilege_type in ('INSERT','UPDATE')
     and (
       (table_name = 'tenant_settings' and column_name in (
          'chatwoot_base_url','chatwoot_token','chatwoot_bot_token',
          'evolution_base_url','evolution_instance',
          'team_atendimento_id','team_descoberta_id',
          'team_fechamento_id','team_encantamento_id'))
       or (table_name = 'tenant_channels' and column_name in (
          'chatwoot_account_id','chatwoot_inbox_id','evolution_instance'))
       or (table_name = 'salespeople' and column_name = 'chatwoot_user_id')
     );

  if v_furo > 0 then
    raise exception 'Sobraram % privilegios de escrita em colunas do servidor', v_furo;
  end if;

  -- As colunas que o painel usa de verdade seguem gravaveis.
  select count(*) into v_ok
    from information_schema.column_privileges
   where grantee = 'authenticated'
     and table_schema = 'public'
     and privilege_type = 'UPDATE'
     and (
       (table_name = 'tenant_settings' and column_name in ('bot_phone','horario_atendimento'))
       or (table_name = 'salespeople' and column_name in ('name','email','role'))
     );

  if v_ok <> 5 then
    raise exception 'Esperava 5 colunas do painel ainda gravaveis, achei %', v_ok;
  end if;
end
$do$;
