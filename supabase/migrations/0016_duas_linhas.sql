-- 0016_duas_linhas.sql
--
-- O lojista mandou um print: quer que a Julia converse em bolhas curtas, do jeito
-- que uma pessoa digita no WhatsApp, e nao em um paragrafo unico. Limite pedido:
-- no maximo duas linhas por mensagem.
--
-- Sao duas metades, e as duas precisam existir:
--
--   1. Aqui, no prompt: a Julia passa a escrever ja separado por linha em branco.
--      O fluxo do n8n sempre cortou a resposta na linha em branco -- cada bloco
--      vira uma mensagem. So que a regra antiga dizia "ate cerca de 120
--      caracteres" e nao pedia a separacao, entao ela mandava tudo junto.
--
--   2. No n8n, no no "Set response": um divisor que garante o limite mesmo se ela
--      escrever um paragrafo longo. Corta em fim de frase, depois em virgula, e so
--      em ultimo caso entre palavras. Nunca corta uma URL, os marcadores
--      [CAPA: / [FOTOS: nem a ficha tecnica -- essas vao inteiras.
--
-- O prompt e a intencao (o corte cai onde faz sentido); o n8n e a garantia.
-- Sem a parte 1 a conversa fica com cortes secos no meio da frase.

update public.prompt_templates
   set template = replace(
     template,
     'ESTILO: frases curtas (ate cerca de 120 caracteres); uma ideia por mensagem; emojis com moderacao (carro, sorriso, joinha, brilho, fogo). Nunca use markdown: nada de asterisco, # ou lista com traco -- o WhatsApp mostra o simbolo como texto. Para mandar um site, escreva a URL sozinha e completa, comecando com https:// e sem pontuacao colada no fim. A unica excecao a estas regras e a ficha tecnica, que tem formato proprio descrito abaixo.',
     'ESTILO: voce digita como gente digita no WhatsApp -- em blocos curtos, um atras do outro, nunca em paragrafo longo. Cada bloco separado por uma linha em branco vira uma mensagem propria no celular do cliente, entao SEMPRE separe os blocos com uma linha em branco. Cada bloco tem no maximo duas linhas (cerca de 75 caracteres) e uma ideia so.

Exemplo de resposta certa, reparando na linha em branco entre os blocos:

Prontinho!

Sua visita para ver o Audi Q5 ficou agendada para sabado, as 14h.

Emojis com moderacao (carro, sorriso, joinha, brilho, fogo). Nunca use markdown: nada de asterisco, # ou lista com traco -- o WhatsApp mostra o simbolo como texto. Para mandar um site, escreva a URL sozinha, completa e em um bloco so dela, comecando com https:// e sem pontuacao colada no fim. A unica excecao a regra das duas linhas e a ficha tecnica, que tem formato proprio descrito abaixo e sai inteira em um bloco.')
 where template like '%ate cerca de 120 caracteres%';

-- Confere: ninguem pode ter ficado para tras nem sobrado com a regra antiga.
do $do$
declare
  v_velho int;
  v_novo  int;
begin
  select count(*) into v_velho from public.prompt_templates where template like '%120 caracteres%';
  select count(*) into v_novo  from public.prompt_templates where template like '%no maximo duas linhas%';
  if v_velho > 0 then
    raise exception 'Sobrou a regra antiga em % template(s)', v_velho;
  end if;
  if v_novo <> 3 then
    raise exception 'Esperava 3 templates com a regra nova, achei %', v_novo;
  end if;
end
$do$;

-- Remonta os prompts dos tenants a partir do template novo.
update public.tenant_agents set system_prompt = system_prompt;
