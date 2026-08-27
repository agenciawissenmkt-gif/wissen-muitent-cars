# Mensagens curtas: no máximo duas linhas por bolha

O lojista pediu que a Júlia converse como gente digita no WhatsApp — várias bolhas
curtas, uma ideia em cada — e não um parágrafo único de cinco linhas.

Isso é feito em duas metades. As duas precisam existir: uma sozinha não resolve.

## 1. O prompt (migration `0016_duas_linhas.sql`)

O bloco `ESTILO` passa a mandar a Júlia **escrever já separada**, com uma linha em
branco entre os blocos, cada bloco com no máximo duas linhas (~75 caracteres).

O fluxo do n8n sempre cortou a resposta na linha em branco — cada bloco vira uma
mensagem. O que faltava era pedir a separação: a regra antiga só dizia "até cerca
de 120 caracteres", então ela mandava tudo junto e saía uma bolha só.

Essa metade é a **intenção**: é ela que faz o corte cair onde a frase termina.

## 2. O nó `Set response` no n8n (workflow `cars Multi Tenant (Supabase)`)

Um divisor que **garante** o limite mesmo quando a Júlia escreve um parágrafo
longo. Ele corta nesta ordem:

1. linha em branco (os blocos que ela já separou);
2. fim de frase — `.`, `!`, `?`, `…` e também `:`;
3. fim de oração — vírgula, ponto e vírgula, travessão;
4. entre palavras, só em último caso.

Nunca corta ao meio:

- **URLs** (`https://...`) — antes da correção o divisor tratava o ponto de
  `wissencars.com.br` como fim de frase e devolvia `wissencars. com. br`;
- os **marcadores de foto** `[CAPA: ...]` e `[FOTOS: ...]`, que os nós seguintes
  procuram inteiros (`É foto?`);
- a **ficha técnica** e qualquer lista — vão inteiras, em uma mensagem só.

O marcador `[TRANSFERIR:...]` continua sendo removido antes de tudo.

Essa metade é a **garantia**.

### A expressão, como está no nó

Campo `output` (tipo *array*) do nó `Set response`:

```js
={{ (function () { const LIM = 75; const ATOMICO = /https?:\/\/\S+|\[(?:CAPA|FOTOS)\s*:[^\]]*\]|\S*\/api\/public\/n8n\/photos\/\S*/gi; const bruto = String($json.output).replace(/\[TRANSFERIR:[^\]]*\]/gi, ''); const pecas = []; const guardado = bruto.replace(ATOMICO, function (m) { pecas.push(m.replace(/[.,;:!?)]+$/, '')); return '@@P' + (pecas.length - 1) + '@@'; }); const abrir = function (t) { return t.replace(/@@P(\d+)@@/g, function (_, i) { return pecas[+i]; }); }; const tam = function (t) { return abrir(t).length; }; const ehLista = function (t) { return /\n\s*(🔹|[-•*]\s)/.test(t); }; const empacotar = function (partes) { const saida = []; let atual = ''; for (const parte of partes) { const p = (parte || '').trim(); if (!p) continue; if (!atual) { atual = p; } else if (tam(atual + ' ' + p) <= LIM) { atual += ' ' + p; } else { saida.push(atual); atual = p; } } if (atual) saida.push(atual); return saida; }; const porFrase = function (t) { return empacotar(t.match(/[^.!?:…]+[.!?:…]+\s*|[^.!?:…]+$/g) || [t]); }; const porOracao = function (t) { return empacotar(t.split(/(?<=[,;])\s+|\s+--?\s+/)); }; const porPalavra = function (t) { return empacotar(t.split(/\s+/)); }; const cortar = function (p) { if (tam(p) <= LIM || ehLista(p)) return [p]; return porFrase(p).flatMap(function (s) { return tam(s) <= LIM ? [s] : porOracao(s); }).flatMap(function (s) { return tam(s) <= LIM ? [s] : porPalavra(s); }); }; return guardado.split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(function (p) { return p !== ''; }).flatMap(cortar).map(function (m) { return { json: { message: abrir(m) } }; }); })() }}
```

O formato de saída (`{ json: { message } }`) tem que ser mantido: os nós seguintes
leem `$json.json.message`.

## Como ficou, na prática

Resposta da Júlia:

> Prontinho, Tiago! Sua visita para ver o Audi Q5 ficou agendada para sábado, às 14h.

Chega no cliente como duas mensagens:

```
Prontinho, Tiago!
Sua visita para ver o Audi Q5 ficou agendada para sábado, às 14h.
```

## Se precisar afrouxar ou apertar

`LIM = 75` é o único número a mexer. 75 caracteres ≈ duas linhas no celular.
Aumentar dá bolhas maiores e menos mensagens; diminuir fragmenta mais.

O `Wait1` depois do envio já espera proporcional ao tamanho de cada mensagem
(`content.length / 1000 * 60` segundos), então dividir mais não aumenta o tempo
total da resposta — só distribui.
