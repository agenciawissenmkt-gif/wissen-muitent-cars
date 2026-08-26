-- 0011_horario_da_loja.sql
--
-- "falta na etapa 1 um campo para dia e horario de funcionamento da loja."
--
-- A etapa 1 tinha um bloco de horario, mas ele e da Julia: diz a partir de que
-- hora ela avisa que um vendedor humano so retorna no proximo expediente. O que
-- nao existia em lugar nenhum era o horario da loja -- os dias e as horas em que
-- a porta esta aberta. Sem isso a IA nao tinha o que responder para a pergunta
-- mais comum de todas ("que horas voces abrem?", "abre sabado?") e marcava
-- visita e test-drive sem saber se havia alguem la.
--
-- A semana fica em stores.business_hours, uma coluna jsonb que existe desde a
-- 0001 e nunca tinha sido usada. Ao lado dela guardamos a frase pronta em
-- business_hours_text ("Segunda a sexta das 9h as 18h, sabado das 9h as 13h e
-- domingo fechado"), montada no painel. Montar portugues legivel a partir do
-- JSON dentro do Postgres daria um plpgsql grande e fragil para pouca coisa --
-- e e a frase, nao o JSON, que o prompt e a base de conhecimento leem.

alter table public.stores
  add column if not exists business_hours_text text;

comment on column public.stores.business_hours is
  'Semana de funcionamento da loja: [{dia:0..6 (0=segunda), aberto, abre, fecha}]. Escrita pela etapa 1.';
comment on column public.stores.business_hours_text is
  'A mesma semana em portugues, pronta para o prompt e para a ferramenta base_de_conhecimento.';

-- 1. O prompt da Julia passa a carregar o horario da loja ---------------------
-- Patch da definicao viva em vez de reescrever render_agent_prompt inteira: ela
-- ja foi ampliada duas vezes (0003 e 0005) e recria-la aqui arriscaria derrubar
-- algum campo no caminho. Idempotente.

do $do$
declare
  src   text;
  -- Sem a indentacao no comeco: a definicao viva nao tem os mesmos espacos do
  -- arquivo da 0005, e ancorar na linha inteira falhava. Este pedaco aparece
  -- uma vez so na funcao.
  ancora constant text := 'if nullif(btrim(coalesce(v_store.legal_name, '''')), '''') is not null then';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'render_agent_prompt';

  if src is null then raise exception 'render_agent_prompt nao encontrada'; end if;
  if position('business_hours_text' in src) > 0 then
    return; -- ja aplicado
  end if;
  if position(ancora in src) = 0 then
    raise exception 'render_agent_prompt mudou de forma: ancora da razao social nao encontrada';
  end if;

  -- Entra logo antes da razao social, junto do resto da identificacao da loja.
  src := replace(
    src,
    ancora,
    'if nullif(btrim(coalesce(v_store.business_hours_text, '''')), '''') is not null then' || chr(10) ||
    '      v_linhas := v_linhas || (''- Horario de funcionamento da loja: '' || btrim(v_store.business_hours_text));' || chr(10) ||
    '    end if;' || chr(10) ||
    '    ' || ancora
  );

  execute src;
end
$do$;

-- 2. A ferramenta base_de_conhecimento tambem enxerga o horario ---------------
-- api_loja e pequena e nasceu inteira na 0008, entao aqui vale reescrever.

create or replace function public.api_loja(p_tenant uuid)
returns jsonb
language sql
stable
as $fn$
  select jsonb_build_object(
    'loja', jsonb_build_object(
      'nome', s.name,
      'cnpj', s.cnpj,
      'telefone', s.phone,
      'endereco', nullif(
        concat_ws(', ', s.address_street, s.address_number, s.address_district,
                        s.address_city, s.address_state), ''),
      -- Quando a loja abre e fecha. E a pergunta mais comum do cliente.
      'horario_de_funcionamento', s.business_hours_text,
      -- Quando a Julia considera que ha vendedor disponivel.
      'horario_atendimento', coalesce(ts.horario_atendimento, '24h')
    ),
    'condicoes', jsonb_build_object(
      'bancos_parceiros', coalesce(s.partner_banks, array[]::text[]),
      'formas_pagamento', coalesce(s.payment_methods, array[]::text[]),
      'garantia_meses', s.warranty_months,
      'aceita_troca', s.accepts_trade,
      'aceita_consignacao', s.offers_consignment,
      'trabalha_com_carro_de_leilao', s.works_with_auction,
      'laudo_cautelar', case when s.has_inspection then s.inspection_type else null end,
      'faz_test_drive', s.offers_test_drive,
      'faz_entrega', s.offers_delivery
    )
  )
  from public.stores s
  left join public.tenant_settings ts on ts.tenant_id = s.tenant_id
  where s.tenant_id = p_tenant
  limit 1
$fn$;

-- Remonta os prompts de todas as lojas com a linha nova.
update public.tenant_agents set system_prompt = system_prompt;

notify pgrst, 'reload schema';
