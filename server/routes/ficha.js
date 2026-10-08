// Gera a ficha tecnica de um veiculo a partir de marca, modelo, versao e ano do modelo.
//
// A chave da OpenAI fica AQUI, no servidor. Ela nunca vai para o navegador.
//
// Regra de ouro deste arquivo: a IA so preenche o que e do MODELO/VERSAO.
// Quilometragem, cor e preco sao daquele carro especifico e ficam de fora --
// se a IA chutar, o chute entra no estoque que a Julia le e vira resposta
// errada para o cliente no WhatsApp.

import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { db, HttpError } from '../lib/db.js'
import { requireTenant, route } from '../lib/auth.js'

const router = Router()

// Modelo da ficha: GPT-5 nano. Pode ser trocado pela variavel OPENAI_FICHA_MODEL.
export const MODELO = process.env.OPENAI_FICHA_MODEL || 'gpt-5-nano'

// Tempo total para a ficha (as duas chamadas somadas). A funcao da Vercel vai ate 60 s.
const TIMEOUT_MS = Number(process.env.OPENAI_FICHA_TIMEOUT_MS || 55000)

// gpt-5-nano "pensa" antes de responder. Com 'minimal' ele respondia rapido mas
// errava e deixava numero em branco (0 a 100 vinha "0", tracao trocada). 'low'
// custa alguns segundos a mais e acerta a ficha. Se o modelo escolhido nao
// aceitar o parametro, o codigo repete a chamada sem ele em vez de quebrar.
const ESFORCO = process.env.OPENAI_FICHA_REASONING || 'low'

// Campos de lista: o painel mostra como <select>. O schema da OpenAI so aceita
// um destes valores (ou null), e o encaixe abaixo ainda confere de novo.
export const OPCOES = {
  transmission: ['Manual', 'Automático', 'Automatizado', 'CVT'],
  fuel: ['Flex', 'Gasolina', 'Etanol', 'Diesel', 'Híbrido', 'Elétrico', 'GNV'],
  body_type: ['Hatch', 'Sedã', 'SUV', 'Picape', 'Utilitário', 'Coupé', 'Conversível', 'Minivan'],
  traction: ['Dianteira', 'Traseira', '4x4', 'AWD'],
  aspiration: ['Aspirado', 'Turbo'],
  air_conditioning: ['Manual', 'Digital', 'Dual zone', 'Não possui'],
  steering: ['Mecânica', 'Hidráulica', 'Eletro-hidráulica', 'Elétrica'],
  electric_windows: ['4 portas', 'Dianteiros', 'Não possui'],
  sunroof: ['Não possui', 'Teto solar', 'Panorâmico'],
  carplay_android_auto: ['Sem fio', 'Com fio', 'Não possui'],
  leather_seats: ['Sim', 'Não'],
  keyless_entry: ['Sim', 'Não'],
  parking_sensor: ['Traseiro', 'Dianteiro e traseiro', 'Não possui'],
  rear_camera: ['Sim', 'Não'],
  nivel_consumo: ['Econômico', 'Médio', 'Alto'],
}

const lista = (campo, descricao) => ({ type: ['string', 'null'], enum: [...OPCOES[campo], null], description: descricao })

// Os campos que a IA pode devolver. Sao exatamente as colunas de `cars`
// que descrevem o modelo/versao, nao a unidade.
export const CAMPOS = {
  transmission: lista('transmission', 'Cambio'),
  fuel: lista('fuel', 'Combustivel'),
  body_type: lista('body_type', 'Carroceria'),
  doors: { type: ['integer', 'null'], description: 'Numero de portas (2 a 5)' },
  engine: { type: ['string', 'null'], description: 'Motor, ex: 1.0 12V, 2.0 TFSI, 2.0 TwinPower Turbo' },
  cylinders: { type: ['string', 'null'], description: 'Cilindros, ex: 3 cilindros, 4 cilindros' },
  horsepower: { type: ['string', 'null'], description: 'Potencia maxima com unidade, ex: 80 cv. Em hibrido, a potencia combinada.' },
  torque: { type: ['string', 'null'], description: 'Torque maximo com unidade, ex: 10,2 kgfm. Em hibrido, o torque combinado.' },
  acceleration_0_100: {
    type: ['number', 'null'],
    description:
      'Tempo de 0 a 100 km/h em segundos, numero maior que 2, ex: 9.8. Use o dado oficial do fabricante ou de testes da imprensa brasileira.',
  },
  aspiration: lista('aspiration', 'Aspirado ou Turbo'),
  traction: lista('traction', 'Tracao'),
  air_conditioning: lista('air_conditioning', 'Ar-condicionado'),
  steering: lista('steering', 'Direcao'),
  electric_windows: lista('electric_windows', 'Vidros eletricos'),
  sunroof: lista('sunroof', 'Teto solar'),
  carplay_android_auto: lista('carplay_android_auto', 'Multimidia com Apple CarPlay e Android Auto'),
  trunk_liters: { type: ['integer', 'null'], description: 'Capacidade do porta-malas em litros, ex: 470' },
  leather_seats: lista('leather_seats', 'Bancos revestidos de couro (couro natural ou sintetico conta como Sim)'),
  keyless_entry: lista('keyless_entry', 'Chave presencial (entrada e partida sem tirar a chave do bolso)'),
  parking_sensor: lista('parking_sensor', 'Sensor de estacionamento'),
  rear_camera: lista('rear_camera', 'Camera de re'),
  consumo_cidade: {
    type: ['number', 'null'],
    description:
      'Consumo na cidade em km/l, numero, ex: 11.8. Dado do Inmetro (PBEV) ou de testes da imprensa brasileira. Em carro flex, use o consumo com gasolina. Em eletrico, null.',
  },
  consumo_estrada: {
    type: ['number', 'null'],
    description:
      'Consumo na estrada em km/l, numero, ex: 14.2. Dado do Inmetro (PBEV) ou de testes da imprensa brasileira. Em carro flex, use o consumo com gasolina. Em eletrico, null.',
  },
  nivel_consumo: lista(
    'nivel_consumo',
    'Consumo comparado a carros da mesma categoria e porte: Econômico (gasta pouco), Médio ou Alto (carro gastao).',
  ),
}

// Os que o cliente mais pergunta. Se a primeira resposta vier sem algum deles,
// a IA recebe uma segunda pergunta so sobre o que faltou.
const ESSENCIAIS = [
  'engine',
  'horsepower',
  'torque',
  'acceleration_0_100',
  'trunk_liters',
  'transmission',
  'fuel',
  'traction',
  'consumo_cidade',
  'consumo_estrada',
  'nivel_consumo',
]

// Como a IA (ou o cadastro antigo) costuma escrever, e para onde isso vai.
const SINONIMOS = {
  body_type: { sedan: 'Sedã', cupe: 'Coupé', coupe: 'Coupé', perua: 'Utilitário', wagon: 'Utilitário', suv: 'SUV', pickup: 'Picape', hatchback: 'Hatch' },
  fuel: { eletrico: 'Elétrico', hibrido: 'Híbrido', phev: 'Híbrido', alcool: 'Etanol', 'flex fuel': 'Flex' },
  transmission: { automatica: 'Automático', automatico: 'Automático', manual: 'Manual', cvt: 'CVT' },
  traction: { fwd: 'Dianteira', rwd: 'Traseira', awd: 'AWD', integral: 'AWD', quattro: 'AWD', '4motion': 'AWD', xdrive: 'AWD', '4wd': '4x4' },
  sunroof: { solar: 'Teto solar', panoramico: 'Panorâmico', nao: 'Não possui' },
  electric_windows: { 'quatro portas': '4 portas', todos: '4 portas', 'dianteiros e traseiros': '4 portas' },
  air_conditioning: { 'digital dual zone': 'Dual zone', bizona: 'Dual zone', automatico: 'Digital' },
  carplay_android_auto: { wireless: 'Sem fio', sim: 'Com fio', nao: 'Não possui' },
  parking_sensor: { nao: 'Não possui' },
  nivel_consumo: { economico: 'Econômico', baixo: 'Econômico', medio: 'Médio', moderado: 'Médio', alto: 'Alto', gastao: 'Alto', elevado: 'Alto' },
}

function semAcento(texto) {
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export function encaixaNaOpcao(campo, valor) {
  const opcoes = OPCOES[campo]
  if (!opcoes) return valor
  const alvo = semAcento(valor)

  // 1. igual a uma opcao, ignorando acento e caixa
  const exato = opcoes.find((o) => semAcento(o) === alvo)
  if (exato) return exato

  // 2. sinonimo conhecido
  const sin = (SINONIMOS[campo] || {})[alvo]
  if (sin) return sin

  // 3. "Dianteira (FWD)" -> "Dianteira", "4x4 (AWD)" -> "4x4"
  const semParenteses = alvo.replace(/\s*\(.*\)\s*/, '').trim()
  const porPrefixo = opcoes.find((o) => semAcento(o) === semParenteses)
  if (porPrefixo) return porPrefixo
  const sinPrefixo = (SINONIMOS[campo] || {})[semParenteses]
  if (sinPrefixo) return sinPrefixo

  // 4. ultima tentativa: alguma opcao ou palavra conhecida dentro do texto,
  //    a mais longa primeiro ("dianteiro e traseiro" antes de "traseiro").
  for (const o of [...opcoes].sort((a, b) => b.length - a.length)) {
    if (alvo.includes(semAcento(o))) return o
  }
  const sinonimos = Object.entries(SINONIMOS[campo] || {}).sort((a, b) => b[0].length - a[0].length)
  for (const [chave, destino] of sinonimos) {
    if (alvo.includes(chave)) return destino
  }

  // fora da lista: melhor campo vazio do que lixo no estoque
  return null
}

/** Primeiro numero de um texto, aceitando virgula decimal e ponto de milhar. */
function numeroDe(valor) {
  const achado = String(valor)
    .replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2')
    .match(/\d+(?:[.,]\d+)?/)
  return achado ? Number(achado[0].replace(',', '.')) : NaN
}

const virgula = (n) => String(n).replace('.', ',')

/**
 * Confere e padroniza a resposta da IA. So passa chave conhecida, nunca km, cor
 * ou preco, e numero fora do razoavel vira campo vazio (0 a 100 em "0" era o caso).
 */
export function limpaFicha(ficha) {
  const limpa = {}
  for (const campo of Object.keys(CAMPOS)) {
    const valor = ficha?.[campo]
    if (valor === null || valor === undefined || valor === '') continue

    if (campo === 'doors') {
      const n = Math.round(numeroDe(valor))
      if (n >= 2 && n <= 5) limpa.doors = n
      continue
    }
    if (campo === 'trunk_liters') {
      const n = Math.round(numeroDe(valor))
      if (n >= 50 && n <= 3000) limpa.trunk_liters = n
      continue
    }
    if (campo === 'consumo_cidade' || campo === 'consumo_estrada') {
      const n = numeroDe(valor)
      if (n >= 2 && n <= 60) limpa[campo] = `${virgula(Math.round(n * 10) / 10)} km/l`
      continue
    }
    if (campo === 'acceleration_0_100') {
      const n = numeroDe(valor)
      if (n >= 2 && n <= 30) limpa.acceleration_0_100 = `${virgula(Math.round(n * 10) / 10)} s`
      continue
    }
    if (campo === 'horsepower') {
      const n = numeroDe(valor)
      if (n >= 30 && n <= 2000) limpa.horsepower = `${Math.round(n)} cv`
      continue
    }
    if (campo === 'torque') {
      const n = numeroDe(valor)
      if (!(n > 0)) continue
      // Veio em Nm (ex: 450 Nm)? Converte para kgfm, que e o padrao da loja.
      const kgfm = /nm/i.test(String(valor)) || n > 150 ? n / 9.80665 : n
      if (kgfm >= 3 && kgfm <= 200) limpa.torque = `${virgula(Math.round(kgfm * 10) / 10)} kgfm`
      continue
    }

    const encaixado = encaixaNaOpcao(campo, String(valor).trim())
    if (encaixado === null || encaixado === '') continue
    limpa[campo] = encaixado
  }
  return limpa
}

const INSTRUCOES = [
  'Voce preenche fichas tecnicas de veiculos para uma loja brasileira de seminovos.',
  'Receba marca, modelo, versao e ano do modelo e devolva as especificacoes desse carro no mercado brasileiro.',
  '',
  'Como decidir cada campo:',
  '- Decida pela VERSAO informada. Os opcionais (teto solar, CarPlay, couro, chave presencial,',
  '  sensor e camera de re) mudam de versao para versao: responda o que vem de serie nela.',
  '- Sem versao, use a versao mais vendida daquele ano no Brasil.',
  '- Preencha TODOS os campos. A pessoa da loja confere antes de salvar, entao o dado oficial',
  '  ou o valor tipico ajuda; campo vazio so da trabalho para ela.',
  '- Numeros (potencia, torque, 0 a 100, porta-malas) existem para qualquer carro: use o dado',
  '  oficial do fabricante ou de testes da imprensa. Nunca responda 0.',
  '- Hibrido e eletrico: potencia e torque combinados do sistema.',
  '- Consumo (cidade e estrada) em km/l: dado do Inmetro (PBEV) ou da imprensa. Em flex, com gasolina.',
  '  Nivel de consumo: compare com carros da mesma categoria e porte (Econômico, Médio ou Alto).',
  '- Null so quando voce realmente nao faz ideia. Null e para desconhecimento, nao para duvida pequena.',
  '',
  'Formato:',
  '- Responda SOMENTE o JSON do schema. Nada de texto antes ou depois.',
  '- Padrao brasileiro: cv para potencia, kgfm para torque.',
].join('\n')

/**
 * Consumo da ficha: uma linha em ai_usage por chamada a OpenAI, com
 * agent_type 'ficha_tecnica'. O Painel Empresarial soma isso por loja (tokens e
 * reais). A chave `ficha:<pedido>:<chamada>` conta cada ficha gerada uma vez,
 * mesmo quando ela precisou de uma segunda pergunta.
 */
async function registrarConsumo(tenantId, pedidoId, chamadas) {
  if (!chamadas.length) return
  const linhas = chamadas.map((uso, i) => ({
    tenant_id: tenantId,
    model: MODELO.toLowerCase(),
    agent_type: 'ficha_tecnica',
    prompt_tokens: Math.max(0, Number(uso?.prompt_tokens) || 0),
    completion_tokens: Math.max(0, Number(uso?.completion_tokens) || 0),
    execution_id: `ficha:${pedidoId}:${i + 1}`,
  }))
  try {
    await db.insert('ai_usage', linhas)
  } catch (erro) {
    // Registro de custo nunca pode impedir a loja de receber a ficha.
    console.error('[ficha] nao consegui registrar o consumo:', erro?.message || erro)
  }
}

function schemaDe(campos) {
  const properties = Object.fromEntries(campos.map((c) => [c, CAMPOS[c]]))
  return { type: 'object', properties, required: campos, additionalProperties: false }
}

router.post(
  '/',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)

    const { brand, model, version } = req.body || {}
    const ano = req.body?.model_year || req.body?.year
    if (!brand || !model) throw new HttpError(400, 'Informe ao menos marca e modelo.')
    if (!process.env.OPENAI_API_KEY) {
      throw new HttpError(503, 'IA nao configurada.', 'Falta OPENAI_API_KEY nas variaveis de ambiente.')
    }

    const carro = [brand, model, version, ano ? `ano modelo ${ano}` : null].filter(Boolean).join(' ')
    const controle = new AbortController()
    const inicio = Date.now()
    const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS)
    const pedidoId = randomUUID()
    const consumo = []

    async function perguntar(campos, pedidoExtra) {
      const corpoBase = {
        model: MODELO,
        messages: [
          { role: 'system', content: INSTRUCOES },
          { role: 'user', content: `Veiculo: ${carro}${pedidoExtra ? `\n\n${pedidoExtra}` : ''}` },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'ficha_tecnica', strict: true, schema: schemaDe(campos) },
        },
      }
      const chamar = (corpo) =>
        fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          signal: controle.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          body: JSON.stringify(corpo),
        })

      let resposta = await chamar(ESFORCO === 'off' ? corpoBase : { ...corpoBase, reasoning_effort: ESFORCO })

      // Modelo que nao conhece reasoning_effort devolve 400. Tenta sem ele.
      if (resposta.status === 400 && ESFORCO !== 'off') {
        const detalhe = await resposta.text()
        if (!/reasoning_effort/i.test(detalhe)) {
          console.error('[ficha] openai respondeu 400', detalhe.slice(0, 300))
          throw new HttpError(502, 'A IA recusou o pedido. Tente de novo.')
        }
        resposta = await chamar(corpoBase)
      }

      if (!resposta.ok) {
        const detalhe = await resposta.text()
        console.error('[ficha] openai respondeu', resposta.status, detalhe.slice(0, 300))
        throw new HttpError(502, 'A IA nao respondeu agora. Tente de novo.')
      }

      const corpo = await resposta.json()
      if (corpo?.usage) consumo.push(corpo.usage)
      const bruto = corpo?.choices?.[0]?.message?.content
      if (!bruto) throw new HttpError(502, 'A IA devolveu resposta vazia.')
      try {
        return JSON.parse(bruto)
      } catch {
        console.error('[ficha] json invalido:', String(bruto).slice(0, 300))
        throw new HttpError(502, 'A IA devolveu algo fora do formato.')
      }
    }

    let limpa
    try {
      limpa = limpaFicha(await perguntar(Object.keys(CAMPOS)))

      // Segunda volta, so para o que faltou dos essenciais -- se ainda houver tempo.
      const faltando = ESSENCIAIS.filter((c) => !(c in limpa))
      if (faltando.length && Date.now() - inicio < TIMEOUT_MS * 0.45) {
        try {
          const extra = limpaFicha(
            await perguntar(
              faltando,
              'Faltaram estes dados na ficha. Informe o valor oficial do fabricante ou de testes da imprensa para esta versao.',
            ),
          )
          for (const [campo, valor] of Object.entries(extra)) if (!(campo in limpa)) limpa[campo] = valor
        } catch (erro) {
          // A primeira resposta ja serve; a segunda volta e so um reforco.
          console.error('[ficha] segunda volta falhou:', erro?.message || erro)
        }
      }
    } catch (erro) {
      if (erro instanceof HttpError) throw erro
      if (erro.name === 'AbortError') throw new HttpError(504, 'A IA demorou demais. Tente de novo.')
      throw new HttpError(502, 'Nao consegui falar com a IA agora.')
    } finally {
      clearTimeout(relogio)
      await registrarConsumo(tenant.id, pedidoId, consumo)
    }

    res.json({
      ficha: limpa,
      preenchidos: Object.keys(limpa).length,
      total: Object.keys(CAMPOS).length,
      faltaram: Object.keys(CAMPOS).filter((c) => !(c in limpa)),
      modelo_usado: MODELO,
    })
  }),
)

export default router
