-- 0040 — Consumo de IA lido das execuções do agente no n8n
--
-- O painel importa o tokenUsage de cada chamada ao modelo direto das execuções
-- do n8n (sem alterar o fluxo que atende os clientes). Cada chamada tem uma chave
-- única "<execução>:<nó>:<run>" em ai_usage.execution_id; este índice garante que
-- reimportar um trecho nunca conta a mesma chamada duas vezes.

create unique index if not exists ai_usage_execution_uidx
  on public.ai_usage (execution_id);
