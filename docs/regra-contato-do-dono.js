// Decide se a conversa que acabou de chegar ja era do dono da loja.
//
// corteMs  = quando a conversa NASCEU no Chatwoot (ms)
// msgs     = mensagens que a Evolution tem com este contato
// DIAS     = janela (15)
function decide(msgs, corteMs, DIAS) {
  const JANELA = DIAS * 24 * 60 * 60 * 1000
  const MARGEM = 60 * 1000 // 1 min: a propria mensagem que abriu a conversa

  const anteriores = (msgs || [])
    .map((m) => Number(m.messageTimestamp) * 1000)
    .filter((t) => Number.isFinite(t) && t > 0 && t < corteMs - MARGEM)

  if (!anteriores.length) return { doDono: false, motivo: 'sem conversa anterior' }

  const ultima = Math.max(...anteriores)
  const dias = Math.round((corteMs - ultima) / 86400000)

  if (corteMs - ultima <= JANELA) {
    return { doDono: true, motivo: 'falaram ha ' + dias + ' dia(s)', ultima, dias }
  }
  return { doDono: false, motivo: 'parado ha ' + dias + ' dias', dias }
}

const agora = Date.parse('2026-09-12T02:00:00Z')
const d = (n) => ({ messageTimestamp: Math.floor((agora - n * 86400000) / 1000) })

const casos = [
  ['lead novo, nunca falou',            [],                         false],
  ['cliente do dono, falou ontem',      [d(1), d(3), d(40)],        true ],
  ['cliente do dono, falou ha 14 dias', [d(14), d(60)],             true ],
  ['limite exato: 15 dias',             [d(15)],                    true ],
  ['parado ha 16 dias',                 [d(16), d(90)],             false],
  ['parado ha 2 anos',                  [d(700)],                   false],
  ['so a propria mensagem de agora',    [{messageTimestamp: Math.floor(agora/1000)}], false],
]

let falhas = 0
for (const [nome, msgs, esperado] of casos) {
  const r = decide(msgs, agora, 15)
  const ok = r.doDono === esperado
  if (!ok) falhas++
  console.log((ok ? '  ok  ' : 'FALHA ') + nome.padEnd(34) +
              ' -> ' + (r.doDono ? 'DONO' : 'JULIA').padEnd(6) + ' (' + r.motivo + ')')
}
console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTodos os 7 casos passaram.')
process.exit(falhas ? 1 : 0)
