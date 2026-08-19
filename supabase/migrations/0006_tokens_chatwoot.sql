-- Separa os dois tokens do Chatwoot que viviam na mesma coluna.
--
-- `chatwoot_token` e o token de um usuario ADMINISTRADOR da conta: e com ele
-- que o painel cria a inbox e que a Evolution chama `chatwoot/set`.
-- O Agent Bot tem outro token, usado pelo n8n para responder e atribuir
-- conversas -- e o Chatwoot NAO deixa um bot usar a API de conta.
--
-- Enquanto os dois dividiam a mesma coluna, trocar o bot sobrescrevia o token
-- de admin e a etapa 4 quebrava com "Evolution API: Unauthorized" -- um 401 do
-- Chatwoot que a Evolution repassa como se fosse dela.

alter table public.tenant_settings
  add column if not exists chatwoot_bot_token text;

comment on column public.tenant_settings.chatwoot_token is
  'Token de um usuario ADMINISTRADOR da conta no Chatwoot. Usado pelo painel e pela Evolution (chatwoot/set). Nunca guardar token de Agent Bot aqui.';

comment on column public.tenant_settings.chatwoot_bot_token is
  'Token do Agent Bot da conta. Usado pelo n8n para responder e atribuir conversas.';
