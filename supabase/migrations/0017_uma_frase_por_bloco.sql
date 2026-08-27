-- 0017_uma_frase_por_bloco.sql
--
-- A 0016 mandou separar os blocos com linha em branco e falou em "cerca de 75
-- caracteres". Nao bastou, e o lojista mandou o print de novo:
--
--   "Claro, Tiago! Pode me dizer qual modelo ou categoria te interessa agora?"
--
-- Sao 71 caracteres, e no celular dele isso ocupou TRES linhas -- cabem cerca de
-- 32 por linha, nao 37. Duas correcoes, entao:
--
--   1. O numero. Duas linhas de verdade sao ~60 caracteres, nao 75.
--
--   2. A regra que faltava: uma frase por bloco. As duas frases acima eram
--      "Claro, Tiago!" e "Pode me dizer...". Juntas passavam de duas linhas;
--      separadas, cada uma cabia. Agora so ficam juntas se as duas somadas
--      couberem em UMA linha (~32 caracteres) -- que e o caso de "Bom dia! Tudo
--      bem?", e nesse caso separar ficaria artificial.
--
-- E troquei o exemplo pelo proprio caso que falhou, que ensina melhor do que o
-- do agendamento: mostra a frase curta sozinha e a pergunta em seguida.
--
-- Do lado do n8n o divisor tambem foi apertado (LINHA = 32, LIM = 62) e passou a
-- proteger parenteses e reticencias: "(SUV, sedan, esportivo...)" estava sendo
-- cortado no meio e o ")" sobrava sozinho na mensagem seguinte. Detalhes em
-- docs/MENSAGENS-CURTAS.md.

update public.prompt_templates
   set template = replace(
     template,
     'Cada bloco tem no maximo duas linhas (cerca de 75 caracteres) e uma ideia so.',
     'Cada bloco tem no maximo duas linhas -- cerca de 60 caracteres -- e uma ideia so. Uma frase por bloco: se voce escreveu duas frases, sao dois blocos. So deixe duas frases no mesmo bloco quando as duas juntas couberem em uma linha, como "Bom dia! Tudo bem?". Frase que passa de 60 caracteres, quebre voce mesma em duas -- nao deixe o sistema quebrar, porque ele corta onde der. Evite parenteses longos e enumeracoes dentro da frase.')
 where template like '%cerca de 75 caracteres%';

update public.prompt_templates
   set template = replace(
     template,
     'Prontinho!

Sua visita para ver o Audi Q5 ficou agendada para sabado, as 14h.',
     'Claro!

Voce prefere SUV, seda ou esportivo?

Me diz o tipo que eu ja procuro pra voce.')
 where template like '%Sua visita para ver o Audi Q5%';

do $do$
declare
  v_velho int;
  v_novo  int;
  v_ex    int;
begin
  select count(*) into v_velho from public.prompt_templates where template like '%cerca de 75 caracteres%';
  select count(*) into v_novo  from public.prompt_templates where template like '%Uma frase por bloco%';
  select count(*) into v_ex    from public.prompt_templates where template like '%Voce prefere SUV, seda ou esportivo?%';
  if v_velho > 0 then
    raise exception 'Sobrou a regra dos 75 caracteres em % template(s)', v_velho;
  end if;
  if v_novo <> 3 then
    raise exception 'Esperava 3 templates com "Uma frase por bloco", achei %', v_novo;
  end if;
  if v_ex <> 3 then
    raise exception 'Esperava 3 templates com o exemplo novo, achei %', v_ex;
  end if;
end
$do$;

update public.tenant_agents set system_prompt = system_prompt;
