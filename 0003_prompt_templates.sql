-- 0003 — Template-base dos prompts da Júlia
--
-- Problema que este arquivo resolve: até aqui cada loja nova nascia com prompts
-- de uma linha (`bootstrap_store`) e o painel oferecia um texto de ~450
-- caracteres (`defaultPrompts`). O agente ficava sem as regras de estoque, sem
-- o marcador [FOTOS:] e sem o roteiro das três fases.
--
-- A partir daqui a essência do atendimento vive em `prompt_templates` (um texto
-- por fase, ~18 mil caracteres) e o painel só preenche as lacunas:
--   {{LOJA}}             nome da loja
--   {{ENDERECO_SUFIXO}}  " - <endereço>" quando houver endereço, senão vazio
--   {{DADOS_DA_LOJA}}    bloco montado com o que o lojista preencheu
-- Campo em branco não apaga nada: a linha simplesmente não entra no bloco.
--
-- O conteúdo dos templates NÃO está neste arquivo (são ~54 KB de texto) e já
-- foi carregado em produção. Para recarregar, exporte de um ambiente que já
-- tenha os dados:
--   copy public.prompt_templates to stdout with csv header;

create table if not exists public.prompt_templates (
  agent_type text primary key,
  template   text not null,
  updated_at timestamptz not null default now()
);

alter table public.prompt_templates enable row level security;
drop policy if exists prompt_templates_read on public.prompt_templates;
create policy prompt_templates_read on public.prompt_templates for select to authenticated using (true);

-- Monta o prompt final de uma fase para um tenant.
-- Chamada pelo painel (botão "Gerar sugestão") e pelo bootstrap_store.
create or replace function public.render_agent_prompt(p_tenant uuid, p_agent_type text)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tpl    text;
  v_store  public.stores%rowtype;
  v_set    public.tenant_settings%rowtype;
  v_nome   text;
  v_end    text;
  v_laudo  text;
  v_linhas text[] := '{}';
begin
  if auth.uid() is not null and not public.owns_tenant(p_tenant) then
    raise exception 'Sem permissao para este tenant.';
  end if;

  select template into v_tpl from public.prompt_templates where agent_type = p_agent_type;
  if v_tpl is null then
    return null;
  end if;

  select * into v_store from public.stores where tenant_id = p_tenant order by created_at limit 1;
  select * into v_set from public.tenant_settings where tenant_id = p_tenant;
  select nullif(btrim(t.nome), '') into v_nome from public.tenants t where t.id = p_tenant;
  v_nome := coalesce(nullif(btrim(coalesce(v_store.name, '')), ''), v_nome, 'a loja');

  v_end := nullif(btrim(concat_ws(', ',
      nullif(btrim(coalesce(v_store.address_street, '')), ''),
      nullif(btrim(coalesce(v_store.address_number, '')), ''),
      nullif(btrim(coalesce(v_store.address_district, '')), ''),
      nullif(btrim(coalesce(v_store.address_city, '')), ''))), '');
  if v_end is null then
    v_end := nullif(btrim(coalesce(v_set.endereco_loja, '')), '');
  end if;

  if v_end is not null then
    v_linhas := v_linhas || ('- Endereco da loja: ' || v_end);
  end if;
  if nullif(btrim(coalesce(v_set.horario_atendimento, '')), '') is not null then
    v_linhas := v_linhas || ('- Horario de atendimento: ' || case when v_set.horario_atendimento = '24h' then '24 horas por dia' else v_set.horario_atendimento end);
  end if;

  if v_store.id is not null then
    if nullif(btrim(coalesce(v_store.phone, '')), '') is not null then
      v_linhas := v_linhas || ('- Telefone da loja: ' || v_store.phone);
    end if;
    if nullif(btrim(coalesce(v_store.maps_url, '')), '') is not null then
      v_linhas := v_linhas || ('- Link do mapa: ' || v_store.maps_url);
    end if;
    if coalesce(array_length(v_store.partner_banks, 1), 0) > 0 then
      v_linhas := v_linhas || ('- Bancos parceiros: ' || array_to_string(v_store.partner_banks, ', '));
    end if;
    if coalesce(array_length(v_store.payment_methods, 1), 0) > 0 then
      v_linhas := v_linhas || ('- Formas de pagamento: ' || array_to_string(v_store.payment_methods, ', '));
    end if;
    if coalesce(array_length(v_store.vehicle_categories, 1), 0) > 0 then
      v_linhas := v_linhas || ('- Categorias de veiculo: ' || array_to_string(v_store.vehicle_categories, ', '));
    end if;
    if coalesce(array_length(v_store.vehicle_conditions, 1), 0) > 0 then
      v_linhas := v_linhas || ('- Condicoes dos veiculos: ' || array_to_string(v_store.vehicle_conditions, ', '));
    end if;
    v_linhas := v_linhas || ('- Troca: ' || case when coalesce(v_store.accepts_trade, false) then 'aceita o carro do cliente como parte do pagamento' else 'a loja nao trabalha com troca' end);
    if coalesce(v_store.offers_financing, false) then
      v_linhas := v_linhas || '- Financiamento: disponivel'::text;
    end if;
    if coalesce(v_store.offers_consignment, false) then
      v_linhas := v_linhas || '- Consignacao: a loja aceita veiculos em consignacao'::text;
    end if;
    if coalesce(v_store.works_with_auction, false) then
      v_linhas := v_linhas || '- Leilao: a loja tambem trabalha com veiculos de leilao, sempre informado ao cliente'::text;
    end if;
    if coalesce(v_store.offers_test_drive, false) then
      v_linhas := v_linhas || '- Test-drive: disponivel'::text;
    end if;
    if coalesce(v_store.offers_delivery, false) then
      v_linhas := v_linhas || '- Entrega: a loja entrega o veiculo na casa do cliente'::text;
    end if;
    if coalesce(v_store.offers_documentation, false) then
      v_linhas := v_linhas || '- Documentacao: a loja cuida da transferencia'::text;
    end if;
    if coalesce(v_store.has_inspection, false) then
      v_laudo := case v_store.inspection_type
        when 'completo' then 'todos os veiculos tem laudo cautelar completo aprovado'
        when 'pesquisa' then 'todos os veiculos passam por pesquisa veicular'
        else null end;
      if v_laudo is not null then
        v_linhas := v_linhas || ('- Laudo: ' || v_laudo);
      end if;
    end if;
    if coalesce(v_store.warranty_months, 0) > 0 then
      v_linhas := v_linhas || ('- Garantia: ' || v_store.warranty_months || ' meses' || coalesce(' (' || nullif(btrim(coalesce(v_store.warranty_details, '')), '') || ')', ''));
    end if;
    if nullif(btrim(coalesce(v_store.differentials, '')), '') is not null then
      v_linhas := v_linhas || ('- Diferenciais da loja: ' || btrim(v_store.differentials));
    end if;
    if nullif(btrim(coalesce(v_store.service_notes, '')), '') is not null then
      v_linhas := v_linhas || ('- Observacoes de atendimento: ' || btrim(v_store.service_notes));
    end if;
  end if;

  -- Nada preenchido ainda: o bloco inteiro sai do prompt, sem deixar rastro.
  if coalesce(array_length(v_linhas, 1), 0) = 0 then
    v_tpl := replace(v_tpl, chr(10) || chr(10) || 'DADOS DA LOJA (preenchidos no painel):' || chr(10) || '{{DADOS_DA_LOJA}}', '');
  else
    v_tpl := replace(v_tpl, '{{DADOS_DA_LOJA}}', array_to_string(v_linhas, chr(10)));
  end if;

  v_tpl := replace(v_tpl, '{{ENDERECO_SUFIXO}}', case when v_end is null then '' else ' - ' || v_end end);
  v_tpl := replace(v_tpl, '{{LOJA}}', v_nome);

  return v_tpl;
end;
$fn$;

grant execute on function public.render_agent_prompt(uuid, text) to authenticated, service_role;

-- Loja nova já nasce com o prompt completo em vez das frases de uma linha.
-- A ordem mudou: a loja é criada antes dos agentes, porque render_agent_prompt
-- lê os dados dela.
create or replace function public.bootstrap_store(p_nome text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $bs$
declare
  v_uid    uuid := auth.uid();
  v_store  public.stores%rowtype;
  v_tenant uuid;
  v_nome   text := coalesce(nullif(btrim(p_nome), ''), 'Minha Loja');
  v_slug   text;
begin
  if v_uid is null then
    raise exception 'E preciso estar autenticado.';
  end if;

  select * into v_store from public.stores where owner_id = v_uid order by created_at limit 1;

  if v_store.id is not null and v_store.tenant_id is not null then
    return v_store.id;
  end if;

  v_slug := coalesce(nullif(public.slugify_pt(v_nome), ''), 'loja') || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into public.tenants (nome, slug) values (v_nome, v_slug) returning id into v_tenant;
  insert into public.tenant_settings (tenant_id) values (v_tenant) on conflict do nothing;

  if v_store.id is null then
    insert into public.stores (owner_id, name, tenant_id, slug)
    values (v_uid, v_nome, v_tenant, v_slug)
    returning * into v_store;
  else
    update public.stores set tenant_id = v_tenant where id = v_store.id;
  end if;

  insert into public.tenant_agents (tenant_id, agent_type, system_prompt)
  select v_tenant, x.t, coalesce(public.render_agent_prompt(v_tenant, x.t), x.fb)
  from (values
    ('descoberta',   'Entenda o cliente antes de oferecer: veiculo de interesse, uso, troca, forma de pagamento e valor de entrada. Uma pergunta por vez.'),
    ('encantamento', 'Apresente o veiculo usando somente a ficha tecnica real do estoque e envie as fotos cadastradas, na ordem em que estao.'),
    ('fechamento',   'Conduza para a visita ou test-drive: ofereca dois horarios concretos e agende na agenda da loja assim que o cliente escolher.')
  ) as x(t, fb);

  return v_store.id;
end;
$bs$;

grant execute on function public.bootstrap_store(text) to authenticated;
