# Mensagens curtas: no máximo duas linhas por bolha

O lojista pediu que a Júlia converse como gente digita no WhatsApp — várias bolhas
curtas, uma ideia em cada — e não um parágrafo único de cinco linhas.

Isso é feito em duas metades. As duas precisam existir: uma sozinha não resolve.

## As duas medidas

| | valor | o que é |
|---|---|---|
| `LINHA` | 32 | quanto cabe em **uma** linha no celular |
| `LIM` | 62 | o teto: **duas** linhas. Nenhuma mensagem passa disso |

O 32 não é chute: veio de um print do lojista onde
`Claro, Tiago! Pode me dizer qual modelo ou categoria te interessa agora?`
(71 caracteres) ocupou **três** linhas — cabiam 32 por linha, não 37.

## 1. O prompt (migrations `0016` e `0017`)

O bloco `ESTILO` manda a Júlia **escrever já separada**, com uma linha em branco
entre os blocos. O fluxo do n8n sempre cortou na linha em branco — cada bloco vira
uma mensagem. O que faltava era pedir a separação.

Duas regras, e a segunda é a que estava faltando na `0016`:

1. cada bloco no máximo duas linhas (~60 caracteres);
2. **uma frase por bloco.** Duas frases só ficam juntas se as duas somadas
   couberem em uma linha (`Bom dia! Tudo bem?`). Foi isso que quebrou no print:
   `Claro, Tiago!` e `Pode me dizer...` cabiam separadas, juntas não.

Essa metade é a **intenção** — é ela que faz o corte cair onde a frase termina.

## 2. O nó `Set response` no n8n (workflow `cars Multi Tenant (Supabase)`)

O divisor que **garante** o limite quando ela escreve um parágrafo longo mesmo
assim. Ordem dos cortes:

1. linha em branco (os blocos que ela já separou);
2. fim de frase — `.` `!` `?` `:` **seguidos de espaço**, juntando frases só até
   `LINHA`;
3. se a frase ainda passa de `LIM`: vírgula, ponto e vírgula, ou antes de
   *ou / e / mas / porém / então*;
4. se ainda passa: corte equilibrado entre palavras — em pedaços de tamanho
   parecido, para não sobrar um toco de três palavras no fim.

### O que nunca é cortado

- **URLs**. Sem essa proteção o ponto de `wissencars.com.br` contava como fim de
  frase e saía `wissencars. com. br`.
- **Parênteses**. `(SUV, sedan, esportivo...)` estava sendo partido no meio e o
  `)` sobrava sozinho na mensagem seguinte.
- **Reticências**, pelo mesmo motivo: `esportivo...` virava fim de frase.
- **Números**: `R$ 89.900` e `2.0 Turbo` sobrevivem porque o corte de frase exige
  espaço depois do ponto.
- Os **marcadores de foto** `[CAPA: ...]` e `[FOTOS: ...]`, que o nó `É foto?`
  procura inteiros.
- A **ficha técnica** e qualquer lista — vão inteiras, em uma mensagem só.

O marcador `[TRANSFERIR:...]` continua sendo removido antes de tudo.

Essa metade é a **garantia**.

### A expressão, como está no nó

Campo `output` (tipo *array*) do nó `Set response`:

```js
={{ (function () { const LINHA = 32; const LIM = 62; const ATOMICO = /https?:\/\/\S+|\[(?:CAPA|FOTOS)\s*:[^\]]*\]|\S*\/api\/public\/n8n\/photos\/\S*|\([^)]{0,120}\)|\.{2,}|…/gi; const bruto = String($json.output).replace(/\[TRANSFERIR:[^\]]*\]/gi, ''); const pecas = []; const guardado = bruto.replace(ATOMICO, function (m) { pecas.push(m); return '@@P' + (pecas.length - 1) + '@@'; }); const abrir = function (t) { return t.replace(/@@P(\d+)@@/g, function (_, i) { return pecas[+i]; }); }; const tam = function (t) { return abrir(t).length; }; const ehLista = function (t) { return /\n\s*(🔹|[-•*]\s)/.test(t); }; const empacotar = function (partes, teto) { const saida = []; let atual = ''; for (const bruta of partes) { const p = (bruta || '').trim(); if (!p) continue; if (!atual) { atual = p; } else if (tam(atual + ' ' + p) <= teto) { atual += ' ' + p; } else { saida.push(atual); atual = p; } } if (atual) saida.push(atual); return saida; }; const equilibrar = function (t) { const palavras = t.split(/\s+/); const n = Math.ceil(tam(t) / LIM); const alvo = Math.ceil(tam(t) / n); const saida = []; let atual = ''; for (const pal of palavras) { if (!atual) { atual = pal; } else if (tam(atual) >= alvo || tam(atual + ' ' + pal) > LIM) { saida.push(atual); atual = pal; } else { atual += ' ' + pal; } } if (atual) saida.push(atual); return saida; }; const frases = function (t) { return t.split(/(?<=[.!?:])\s+/); }; const oracoes = function (t) { return t.split(/(?<=[,;])\s+|\s+(?=(?:ou|e|mas|porem|entao)\s)/i); }; const abrirFrase = function (s) { if (tam(s) <= LIM) return [s]; const porVirgula = empacotar(oracoes(s), LIM); const menor = Math.min.apply(null, porVirgula.map(tam)); const usa = menor < 14 ? equilibrar(s) : porVirgula; return usa.flatMap(function (x) { return tam(x) <= LIM ? [x] : equilibrar(x); }); }; const cortar = function (p) { if (ehLista(p)) return [p]; return empacotar(frases(p), LINHA).flatMap(abrirFrase); }; return guardado.split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(function (p) { return p !== ''; }).flatMap(cortar).map(function (m) { return { json: { message: abrir(m) } }; }); })() }}
```

O formato de saída (`{ json: { message } }`) tem que ser mantido: os nós seguintes
leem `$json.json.message`.

## O caso que motivou a correção

Resposta da Júlia:

> Claro, Tiago! Pode me dizer qual modelo ou categoria te interessa agora? Se
> quiser, pode falar o tipo (SUV, sedan, esportivo...) ou um modelo específico que
> eu vejo pra você.

Antes (3 linhas na primeira bolha, e o parêntese partido):

```
Claro, Tiago! Pode me dizer qual modelo ou categoria te interessa agora?
Se quiser, pode falar o tipo (SUV, sedan, esportivo...
) ou um modelo específico que eu vejo pra você.
```

Depois:

```
Claro, Tiago!
Pode me dizer qual modelo ou categoria te interessa agora?
Se quiser, pode falar o tipo (SUV, sedan, esportivo...)
ou um modelo específico que eu vejo pra você.
```

## Se precisar afrouxar ou apertar

Só os dois números do topo. Aumentar dá bolhas maiores e menos mensagens;
diminuir fragmenta mais. `LIM` deve ficar em torno de `2 × LINHA`.

O `Wait1` depois do envio já espera proporcional ao tamanho de cada mensagem
(`content.length / 1000 * 60` segundos), então dividir mais não aumenta o tempo
total da resposta — só distribui.
