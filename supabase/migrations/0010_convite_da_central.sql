-- 0010_convite_da_central.sql
--
-- "fiz o cadastro do vendedor mas o gmail de confirmacao da conta parece que
-- nao foi disparado e eu nao recebi."
--
-- Estava certo. O painel cria a pessoa no Chatwoot pela Platform API com
-- `confirmed: true` e uma senha aleatoria que ninguem ve -- de proposito, para
-- que o acesso direto (SSO) da Visao Geral funcione sem senha. So que usuario
-- ja confirmado nao recebe e-mail nenhum do Chatwoot: o convite do Devise so
-- sai para quem ainda precisa confirmar. Resultado: a conta existia, o botao
-- redondo abria, e a pessoa nunca recebia nada no e-mail dela.
--
-- Nas centrais criadas fora do painel o caminho e outro (API da conta, que
-- convida de verdade), mas quem ja tinha conta no Chatwoot tambem nao recebia
-- nada -- o Chatwoot so convida quem e novo.
--
-- Agora o painel manda o e-mail ele mesmo, para todo mundo da equipe, quando a
-- etapa 3 e concluida. Esta coluna existe para isso nao virar spam: guardamos
-- quando o convite saiu e so mandamos de novo se a pessoa pedir.

alter table public.salespeople
  add column if not exists convite_enviado_em timestamptz;

comment on column public.salespeople.convite_enviado_em is
  'Quando o painel disparou o e-mail de acesso a central para esta pessoa. Nulo = ainda nao recebeu.';

notify pgrst, 'reload schema';
