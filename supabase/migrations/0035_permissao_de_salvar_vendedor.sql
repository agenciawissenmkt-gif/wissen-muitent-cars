-- O painel nao conseguia salvar o vendedor.
--
-- salespeople era a unica tabela do schema sem INSERT e UPDATE para o papel
-- authenticated -- que e como o painel fala com o banco depois do login. Todas
-- as outras (cars, leads, stores, tenant_settings...) ja tinham. Cadastrar e
-- salvar o WhatsApp voltavam com "permission denied for table salespeople".
--
-- Nao afrouxa nada: quem decide QUAIS linhas a pessoa alcanca continua sendo a
-- policy app_owner_all, criada em 0002, que exige owns_tenant(tenant_id). Este
-- grant so devolve a permissao de escrever, que a policy depois filtra.

grant insert, update on public.salespeople to authenticated;
