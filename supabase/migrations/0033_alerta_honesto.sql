-- 0033_alerta_honesto.sql
--
-- A 0020 criou a situacao "provavel_banimento" com base no monitor de entao:
-- ele desistia de reconectar na oitava tentativa (~40 min), e uma hora de queda
-- ja significava "ninguem mais esta tentando". O texto no painel dizia
-- exatamente isso ao lojista.
--
-- O monitor mudou em set/2026. Tentar reconectar cedo demais era pior do que o
-- problema: o /instance/connect chegava em instancias que ainda tinham socket
-- vivo e o WhatsApp respondia com conflict/replaced, derrubando a sessao boa e
-- criando uma tempestade de reconexao. A regra passou a ser a 12a queda (~1 h)
-- e dai de hora em hora, sem nunca desistir.
--
-- Com isso os dois numeros ficaram errados ao mesmo tempo:
--   * as tentativas nunca param, entao o texto virou mentira;
--   * a escalada caia justamente na primeira tentativa, ou seja, o painel
--     falava em banimento antes de a reconexao automatica ter tentado UMA vez.
--
-- Para um lojista, ler "provavel banimento do numero" no painel e um susto
-- serio: numero banido nao volta, e a loja perde o WhatsApp de vendas. Dar esse
-- susto enquanto o celular so estava sem bateria e um custo alto demais.
--
-- A escala passa a ser:
--    3 quedas (~15 min) -> alerta               -> "fora_do_ar"
--   12 quedas (~1 hora) -> 1a reconexao automatica (e de hora em hora)
--   24 quedas (~2 horas) -> escalada             -> "provavel_banimento"
--
-- Ou seja: so escala depois que a reconexao automatica ja tentou pelo menos
-- uma vez e nao resolveu. O nome interno da situacao continua o mesmo para nao
-- quebrar o painel; o que o lojista le agora fala em "sem conexao ha mais de
-- duas horas" e coloca o banimento como uma das hipoteses, nao como o veredito.

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
    when m.estado in ('close', 'connecting') and coalesce(m.quedas_seguidas, 0) >= 24
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
