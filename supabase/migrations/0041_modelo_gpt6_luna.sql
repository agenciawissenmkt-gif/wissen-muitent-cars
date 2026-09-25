-- 0041 — A Julia passa a usar o gpt-6-luna
--
-- Em 25/09/2026 os fluxos do n8n (agente, rodízio e visão) trocaram o
-- gpt-5.6-luna pelo gpt-6-luna. O painel importa o consumo de cada chamada com
-- o nome do modelo que o n8n usou, então o preço do modelo novo precisa estar
-- na tabela — senão o consumo aparece como "sem preço". O preço do 5.6 fica,
-- para o histórico continuar com custo.
--
-- Preço oficial da OpenAI (tarifa padrão, set/2026), por 1 milhão de tokens:
-- entrada US$ 0,10 e saída US$ 0,50 (entrada em cache US$ 0,01 — a tabela não
-- separa cache, então o custo mostrado fica um pouco acima do real).
--
-- tenant_agents.model é só um rótulo (os fluxos não leem essa coluna), mas
-- passa a mostrar o modelo certo — inclusive nas lojas novas, pelo default.
-- Atualizar a coluna não muda nenhum prompt: o gatilho trg_lock_prompt
-- re-renderiza o mesmo texto que já está lá (conferido antes de aplicar).

insert into public.ai_model_prices (model, input_usd_per_1m, output_usd_per_1m, updated_at, updated_by)
values ('gpt-6-luna', 0.10, 0.50, now(), 'Claude (preço oficial OpenAI, tarifa padrão, set/2026)')
on conflict (model) do update
  set input_usd_per_1m  = excluded.input_usd_per_1m,
      output_usd_per_1m = excluded.output_usd_per_1m,
      updated_at        = excluded.updated_at,
      updated_by        = excluded.updated_by;

alter table public.tenant_agents alter column model set default 'gpt-6-luna';

update public.tenant_agents
   set model = 'gpt-6-luna'
 where model is distinct from 'gpt-6-luna';

do $$
declare
  n_fora  int;
  n_preco int;
  v_def   text;
begin
  select count(*) into n_fora  from public.tenant_agents where model <> 'gpt-6-luna';
  select count(*) into n_preco from public.ai_model_prices where model = 'gpt-6-luna';
  select column_default into v_def
    from information_schema.columns
   where table_schema = 'public' and table_name = 'tenant_agents' and column_name = 'model';

  if n_fora > 0 or n_preco <> 1 or v_def not like '%gpt-6-luna%' then
    raise exception '0041: verificação falhou (agentes fora do 6-luna: %, preço: %, default: %)',
      n_fora, n_preco, v_def;
  end if;
end $$;
