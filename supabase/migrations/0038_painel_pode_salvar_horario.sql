-- 0038: o painel volta a conseguir salvar o horario da IA.
--
-- Sintoma: "Nao foi possivel salvar os dados" na etapa Regras, logo depois de
-- mexer no horario da Julia. O Postgres respondia 42501, "permission denied
-- for table tenant_settings".
--
-- Causa: a 0024 trocou o privilegio de escrita da tabela inteira por uma lista
-- de colunas, para o lojista logado nunca conseguir escrever chatwoot_token,
-- evolution_base_url, evolution_instance e os ids de time. A lista e montada
-- lendo information_schema.columns no momento em que a migration roda -- ou
-- seja, congela as colunas que existiam naquele dia. A 0036 criou a coluna
-- ai_hours depois disso e nao refez a lista. Resultado: a coluna nasceu sem
-- privilegio de escrita, e a primeira tentativa de salvar o horario pelo
-- painel bateu no 42501. Ler continuava funcionando, porque SELECT nao mudou.
--
-- Correcao: refazer a lista, com a mesma regra da 0024 -- tudo menos as
-- colunas protegidas. Isso conserta ai_hours e qualquer outra coluna criada
-- depois da 0024. A isolacao entre lojas continua sendo da policy
-- app_owner_all (FOR ALL, owns_tenant no USING e no WITH CHECK); o GRANT e
-- so a primeira porta, que o Postgres cobra antes de olhar a policy.
--
-- ATENCAO para o futuro: migration que cria coluna nova em tenant_settings,
-- tenant_channels ou salespeople precisa rodar este mesmo bloco no fim, senao
-- a tela que grava essa coluna quebra do mesmo jeito.

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

-- Conferencia: o horario da IA precisa estar gravavel, e as colunas de
-- servidor precisam continuar fora do alcance do lojista.
do $$
declare
  v_ok int;
  v_furo int;
begin
  select count(*) into v_ok
    from information_schema.column_privileges
   where grantee = 'authenticated'
     and table_schema = 'public'
     and table_name = 'tenant_settings'
     and column_name = 'ai_hours'
     and privilege_type in ('INSERT','UPDATE');

  if v_ok < 2 then
    raise exception '0038: ai_hours continua sem privilegio de escrita (achei %)', v_ok;
  end if;

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
    raise exception '0038: % coluna(s) protegida(s) ficaram gravaveis', v_furo;
  end if;
end
$$;
