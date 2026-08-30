-- 0020_provavel_banimento.sql
--
-- Um lojista teve o numero banido logo depois de conectar. No painel, aquilo
-- apareceu como "fora do ar" -- a mesma coisa que aparece quando o celular
-- ficou sem bateria. Ele ficou tentando reconectar sem saber que nao ia voltar.
--
-- O monitor ja tem tudo que precisa: conta as quedas seguidas, guarda desde
-- quando caiu e para de tentar reconectar depois da oitava tentativa (~40 min).
-- O que faltava era dizer o nome da coisa.
--
-- A escala fica assim:
--   3 quedas  (~15 min) -> alerta        -> "fora_do_ar"
--   8 quedas  (~40 min) -> para de tentar reconectar
--  12 quedas  (~1 hora) -> "provavel_banimento"
--
-- Uma hora sem autenticar, com a instancia existindo e o Baileys em close ou
-- connecting, nao e mais uma queda passageira. Pode ser celular desligado a
-- noite inteira -- por isso a palavra e "provavel", e a mensagem no painel manda
-- o lojista conferir o WhatsApp no proprio celular, que e onde da para
-- distinguir uma coisa da outra.

create or replace view public.monitor_lojas as
select
  t.id                 as tenant_id,
  t.nome               as loja,
  m.instancia,
  m.estado,
  m.ok,
  m.quedas_seguidas,
  m.alerta,
  m.desde,
  m.checado_em,
  m.recuperacoes,
  m.ultima_recuperacao,
  case
    when m.tenant_id is null      then 'nunca_checado'
    when m.ok                     then 'conectado'
    when m.estado = 'inexistente' then 'sem_instancia'
    when m.estado in ('close', 'connecting') and coalesce(m.quedas_seguidas, 0) >= 12
                                  then 'provavel_banimento'
    when m.alerta                 then 'fora_do_ar'
    else 'instavel'
  end as situacao
from public.tenants t
left join public.monitor_conexao m on m.tenant_id = t.id;

-- security_invoker = true e obrigatorio: sem isso a view rodaria com os
-- privilegios do dono e furaria o RLS das tabelas de baixo, misturando lojas.
alter view public.monitor_lojas set (security_invoker = true);

grant select on public.monitor_lojas to authenticated;

notify pgrst, 'reload schema';
