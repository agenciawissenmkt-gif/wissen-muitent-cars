-- 0019_checklist_do_numero.sql
--
-- Um lojista implementou num WhatsApp comum, celular Android, e o numero foi
-- banido logo depois de conectar. Nao foi azar: o WhatsApp nao autoriza esse
-- tipo de automacao, e um numero recem-registrado que comeca a ser automatizado
-- e o perfil que mais leva ban.
--
-- O painel nao avisava nada disso. Mostrava o QR e pronto.
--
-- Agora a etapa do WhatsApp exige que o lojista confirme quatro coisas sobre o
-- numero antes de o QR aparecer. Esta coluna guarda quando ele confirmou --
-- serve de registro (ninguem pode dizer que nao foi avisado) e, mais util,
-- marca a data da conexao para a gente saber a idade daquele vinculo.

alter table public.stores
  add column if not exists whatsapp_checklist_em timestamptz;

comment on column public.stores.whatsapp_checklist_em is
  'Quando o lojista confirmou o checklist de risco do numero, na etapa do WhatsApp. Nulo = conectou antes do checklist existir.';

notify pgrst, 'reload schema';
