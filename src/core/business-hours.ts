/**
 * Horário de funcionamento da loja — os dias e as horas em que a porta está
 * aberta de verdade.
 *
 * Não confundir com `tenant_settings.horario_atendimento`: aquele é o horário
 * da Júlia, e diz quando ela avisa que um vendedor humano só retorna no
 * próximo expediente. Este aqui é o que o cliente pergunta ("que horas vocês
 * abrem?", "vocês abrem sábado?") e a IA precisa responder sem inventar.
 *
 * Guardamos a semana em `stores.business_hours` (a coluna já existia no schema
 * desde a 0001, sem nunca ter sido usada) e, ao lado, a frase pronta em
 * `stores.business_hours_text`. A frase é o que entra no prompt e na base de
 * conhecimento: gerar português legível a partir do JSON dentro do Postgres
 * daria um plpgsql grande e frágil, e aqui sai de graça.
 */

/** 0 = segunda ... 6 = domingo. A semana brasileira começa na segunda. */
export interface DiaDeFuncionamento {
  dia: number
  aberto: boolean
  abre: string
  fecha: string
}

export const DIAS_DA_SEMANA = [
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
  'Domingo',
] as const

/** Como o dia aparece dentro da frase, em minúscula e sem o "-feira". */
const NOME_NA_FRASE = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'] as const

/** O padrão de quase toda concessionária — ponto de partida, não regra. */
export const HORARIO_PADRAO: DiaDeFuncionamento[] = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({
  dia,
  aberto: dia <= 5,
  abre: '09:00',
  fecha: dia === 5 ? '13:00' : '18:00',
}))

function horaValida(valor: unknown, padrao: string) {
  return typeof valor === 'string' && /^\d{2}:\d{2}$/.test(valor) ? valor : padrao
}

/** A loja já tem horário escolhido, ou o que está na tela é só o padrão? */
export function temHorarioEscolhido(valor: unknown): boolean {
  return Array.isArray(valor) && valor.length > 0
}

/**
 * Confere a semana antes de salvar.
 *
 * A frase gerada aqui é repetida literalmente pela Júlia para todo cliente que
 * pergunta que horas a loja abre, e é ela que decide se uma visita pode ser
 * marcada num horário. Salvar "das 18h às 9h" ou um campo em branco não é um
 * detalhe de formulário: vira informação errada na frente do cliente.
 *
 * Um campo de hora apagado devolve string vazia, que `normalizaHorario` troca
 * pelo padrão 09:00 — ou seja, sem esta checagem o texto salvo afirmaria um
 * horário que o lojista nunca digitou.
 */
export function validaHorario(semana: DiaDeFuncionamento[]): string | null {
  const abertos = semana.filter((d) => d.aberto)

  if (!abertos.length) {
    return 'Marque pelo menos um dia em que a loja abre.'
  }

  for (const dia of abertos) {
    const nome = DIAS_DA_SEMANA[dia.dia]

    if (!/^\d{2}:\d{2}$/.test(dia.abre) || !/^\d{2}:\d{2}$/.test(dia.fecha)) {
      return `Preencha o horário de abertura e de fechamento de ${nome.toLowerCase()}.`
    }

    if (dia.abre >= dia.fecha) {
      return `Em ${nome.toLowerCase()}, o horário de fechar (${dia.fecha}) precisa ser depois do de abrir (${dia.abre}).`
    }
  }

  return null
}

/**
 * O que vem do banco pode ser o `[]` do default, um array antigo com outro
 * formato, ou já a semana certa. Em qualquer caso sai uma semana de sete dias
 * na ordem — a tela nunca precisa desconfiar do que recebeu.
 */
export function normalizaHorario(valor: unknown): DiaDeFuncionamento[] {
  const lista = Array.isArray(valor) ? valor : []

  return HORARIO_PADRAO.map((padrao) => {
    const bruto = lista.find(
      (item) => item && typeof item === 'object' && Number((item as DiaDeFuncionamento).dia) === padrao.dia,
    ) as Partial<DiaDeFuncionamento> | undefined

    if (!bruto) return { ...padrao }

    return {
      dia: padrao.dia,
      aberto: Boolean(bruto.aberto),
      abre: horaValida(bruto.abre, padrao.abre),
      fecha: horaValida(bruto.fecha, padrao.fecha),
    }
  })
}

/** 09:00 vira "9h", 09:30 vira "9h30" — é assim que se fala num WhatsApp. */
function hora(valor: string) {
  const [h, m] = valor.split(':')
  const numero = String(Number(h))
  return m === '00' ? `${numero}h` : `${numero}h${m}`
}

function nomeDoIntervalo(inicio: number, fim: number) {
  if (inicio === fim) return NOME_NA_FRASE[inicio]
  if (fim - inicio === 1) return `${NOME_NA_FRASE[inicio]} e ${NOME_NA_FRASE[fim]}`
  return `${NOME_NA_FRASE[inicio]} a ${NOME_NA_FRASE[fim]}`
}

/**
 * Transforma a semana na frase que a IA vai repetir para o cliente:
 * "Segunda a sexta das 9h às 18h, sábado das 9h às 13h e domingo fechado".
 *
 * Dias seguidos com o mesmo horário viram um intervalo só — ninguém fala
 * "segunda das 9h às 18h, terça das 9h às 18h, quarta...".
 */
export function descreveHorario(semana: DiaDeFuncionamento[]): string {
  const dias = normalizaHorario(semana)
  if (dias.every((d) => !d.aberto)) return 'A loja não abre em nenhum dia da semana'

  const partes: string[] = []
  let inicio = 0

  const chave = (d: DiaDeFuncionamento) => (d.aberto ? `${d.abre}-${d.fecha}` : 'fechado')

  for (let i = 1; i <= dias.length; i += 1) {
    if (i < dias.length && chave(dias[i]) === chave(dias[inicio])) continue

    const fim = i - 1
    const atual = dias[inicio]
    const nome = nomeDoIntervalo(inicio, fim)

    partes.push(
      atual.aberto
        ? `${nome} das ${hora(atual.abre)} às ${hora(atual.fecha)}`
        : `${nome} ${fim > inicio ? 'fechados' : 'fechado'}`,
    )
    inicio = i
  }

  const frase =
    partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}` : partes[0]

  return frase.charAt(0).toUpperCase() + frase.slice(1)
}
