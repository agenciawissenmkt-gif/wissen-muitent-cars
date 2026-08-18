-- 0005 — O bloco DADOS DA LOJA passa a cobrir a etapa 1 inteira
--
-- A tela de implementação agora expõe razão social, WhatsApp, e-mail, site,
-- Instagram, endereço completo, formas de pagamento e perfil de estoque. Esta
-- migration só amplia o bloco montado por render_agent_prompt — o texto base em
-- prompt_templates continua intocado, e a trava da 0004 continua valendo.
--
-- Os marcadores são montados com chr() porque o editor SQL do Supabase
-- atrapalha chaves digitadas à mão.

create or replace function public.render_agent_prompt(p_tenant uuid, p_agent_type text)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  ph_loja     constant text := chr(123) || chr(123) || 'LOJA' || chr(125) || chr(125);
  ph_endereco constant text := chr(123) || chr(123) || 'ENDERECO_SUFIXO' || chr(125) || chr(125);
  ph_dados    constant text := chr(123) || chr(123) || 'DADOS_DA_LOJA' || chr(125) || chr(125);
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
      nullif(btrim(coalesce(v_store.address_complement, '')), ''),
      nullif(btrim(coalesce(v_store.address_district, '')), ''),
      nullif(btrim(coalesce(v_store.address_city, '')), ''),
      nullif(btrim(coalesce(v_store.address_state, '')), ''))), '');
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
    if nullif(btrim(coalesce(v_store.legal_name, '')), '') is not null then
      v_linhas := v_linhas || ('- Razao social: ' || btrim(v_store.legal_name));
    end if;
    if nullif(btrim(coalesce(v_store.phone, '')), '') is not null then
      v_linhas := v_linhas || ('- Telefone da loja: ' || v_store.phone);
    end if;
    if nullif(btrim(coalesce(v_store.whatsapp, '')), '') is not null then
      v_linhas := v_linhas || ('- WhatsApp comercial: ' || v_store.whatsapp);
    end if;
    if nullif(btrim(coalesce(v_store.email, '')), '') is not null then
      v_linhas := v_linhas || ('- E-mail: ' || btrim(v_store.email));
    end if;
    if nullif(btrim(coalesce(v_store.website, '')), '') is not null then
      v_linhas := v_linhas || ('- Site: ' || btrim(v_store.website));
    end if;
    if nullif(btrim(coalesce(v_store.instagram, '')), '') is not null then
      v_linhas := v_linhas || ('- Instagram: @' || btrim(v_store.instagram));
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
      v_linhas := v_linhas || ('- Sobre a loja: ' || btrim(v_store.differentials));
    end if;
    if nullif(btrim(coalesce(v_store.service_notes, '')), '') is not null then
      v_linhas := v_linhas || ('- Regras importantes da loja: ' || btrim(v_store.service_notes));
    end if;
  end if;

  if coalesce(array_length(v_linhas, 1), 0) = 0 then
    v_tpl := replace(v_tpl, chr(10) || chr(10) || 'DADOS DA LOJA (preenchidos no painel):' || chr(10) || ph_dados, '');
  else
    v_tpl := replace(v_tpl, ph_dados, array_to_string(v_linhas, chr(10)));
  end if;

  v_tpl := replace(v_tpl, ph_endereco, case when v_end is null then '' else ' - ' || v_end end);
  v_tpl := replace(v_tpl, ph_loja, v_nome);

  return v_tpl;
end;
$fn$;

grant execute on function public.render_agent_prompt(uuid, text) to authenticated, service_role;

-- Remonta todas as lojas com o bloco ampliado.
update public.tenant_agents set system_prompt = system_prompt;
