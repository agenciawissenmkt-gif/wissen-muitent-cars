-- 0008_estoque_e_base_da_loja.sql
--
-- Duas coisas que faziam a Julia mentir ou emudecer sobre a propria loja.
--
-- 1. api_cars so procurava em marca, modelo e versao. Quando o cliente pergunta
--    "tem SUV?", o agente chama a ferramenta com o termo "SUV" — que e uma
--    carroceria, nao um modelo. A busca voltava vazia e a Julia respondia que a
--    loja nao tinha SUV nenhum, com quatro deles no patio. Mentir sobre o
--    estoque e o pior erro possivel para esse agente.
--
-- 2. Os nos base_de_conhecimento do fluxo do n8n estavam vazios — so a
--    descricao, sem codigo. O prompt manda a Julia consultar essa ferramenta
--    para duvidas sobre a loja, entao perguntas como "quais bancos voces
--    trabalham" caiam num buraco e ficavam sem resposta. api_loja da corpo
--    aquela ferramenta, no mesmo padrao do api_cars.

-- 1. Busca do estoque tambem por carroceria -----------------------------------
-- Feito por patch da definicao viva para nao reescrever a funcao inteira e
-- arriscar perder algum campo do select. E idempotente.

do $do$
declare
  src text;
  de  text := 'áàâãäéèêëíìîïóòôõöúùûüç';
  para text := 'aaaaaeeeeiiiiooooouuuuc';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'api_cars';

  if src is null then raise exception 'api_cars nao encontrada'; end if;
  if position('body_type' in src) > 0 and position('translate(lower(c.body_type)' in src) > 0 then
    return; -- ja aplicado
  end if;

  -- translate() nos dois lados para que "sedã" e "seda" batam.
  src := replace(
    src,
    'or c.model ilike ''%'' || p_model || ''%''',
    'or c.model ilike ''%'' || p_model || ''%''' || chr(10) ||
    '        or translate(lower(c.body_type), ''' || de || ''', ''' || para || ''')' || chr(10) ||
    '             ilike ''%'' || translate(lower(p_model), ''' || de || ''', ''' || para || ''') || ''%'''
  );

  execute src;
end
$do$;

-- 2. Dados oficiais da loja para a ferramenta base_de_conhecimento ------------
-- Sem SECURITY DEFINER de proposito: assim o RLS de stores continua valendo
-- para quem chama com a chave publica, e o n8n (service_role) enxerga o que
-- precisa. Quem pedir o tenant de outra loja recebe nulo.

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

notify pgrst, 'reload schema';
