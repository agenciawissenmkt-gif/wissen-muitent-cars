-- O WhatsApp de quem atende.
--
-- Quando a Julia transfere uma conversa, ou quando o rodizio passa ela para o
-- proximo, o vendedor precisa ser avisado no celular. O app do Chatwoot nao
-- toca no self-hosted, entao o aviso sai pelo WhatsApp da propria loja -- e
-- para isso o numero da pessoa tem que estar no cadastro.
--
-- Guardado como texto solto de proposito: o painel aceita (41) 99999-9999,
-- 41 99999-9999 ou 5541999999999, e quem envia limpa e completa o 55.

alter table salespeople
  add column if not exists telefone text;

comment on column salespeople.telefone is
  'WhatsApp do vendedor. Recebe o aviso quando uma conversa e atribuida a ele.';
