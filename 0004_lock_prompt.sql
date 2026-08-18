-- 0004 — O prompt raiz vira imutável
--
-- A 0003 criou o template e a função que o preenche, mas `tenant_agents.system_prompt`
-- continuava sendo texto livre: qualquer escrita do painel passava direto e apagava a
-- essência da Júlia (papel, regras das três fases, marcador [FOTOS:]).
--
-- A partir daqui a coluna deixa de ser editável na prática. Todo INSERT/UPDATE é
-- reescrito pelo resultado de render_agent_prompt(): template + variáveis da loja.
-- O lojista personaliza marcando as opções do onboarding, nunca reescrevendo o texto.
--
-- Para mudar o texto raiz (só a agência faz isso): edite `prompt_templates`.

create or replace function public.tenant_agents_lock_prompt()
returns trigger
language plpgsql
security definer
set search_path = public
as $t$
declare
  v text;
begin
  v := public.render_agent_prompt(new.tenant_id, new.agent_type);
  -- Sem template para a fase, deixa passar: nunca apagamos o que já existe.
  if v is not null then
    new.system_prompt := v;
  end if;
  return new;
end;
$t$;

drop trigger if exists trg_lock_prompt on public.tenant_agents;
create trigger trg_lock_prompt
  before insert or update on public.tenant_agents
  for each row execute function public.tenant_agents_lock_prompt();

-- Mudou dado da loja no painel? Os três prompts se remontam sozinhos.
-- O update abaixo é no-op de propósito: quem reescreve o texto é o trigger acima.
create or replace function public.rerender_tenant_prompts()
returns trigger
language plpgsql
security definer
set search_path = public
as $r$
begin
  if new.tenant_id is not null then
    update public.tenant_agents a
       set system_prompt = a.system_prompt
     where a.tenant_id = new.tenant_id;
  end if;
  return new;
end;
$r$;

drop trigger if exists trg_stores_rerender on public.stores;
create trigger trg_stores_rerender
  after insert or update on public.stores
  for each row execute function public.rerender_tenant_prompts();

drop trigger if exists trg_settings_rerender on public.tenant_settings;
create trigger trg_settings_rerender
  after insert or update on public.tenant_settings
  for each row execute function public.rerender_tenant_prompts();

-- Reconstrói todas as lojas que já existem, inclusive as que foram destruídas
-- pelo botão "Gerar sugestão" antes desta trava.
update public.tenant_agents set system_prompt = system_prompt;

select t.nome, a.agent_type, length(a.system_prompt) as chars
  from public.tenant_agents a
  join public.tenants t on t.id = a.tenant_id
 order by t.nome, a.agent_type;
