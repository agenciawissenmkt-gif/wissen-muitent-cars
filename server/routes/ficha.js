// Gera a ficha tecnica de um veiculo a partir de marca, modelo e ano.
//
// A chave da OpenAI fica AQUI, no servidor. Ela nunca vai para o navegador.
//
// Regra de ouro deste arquivo: a IA so preenche o que e do MODELO.
// Quilometragem, cor e preco sao daquele carro especifico e ficam de fora --
// se a IA chutar, o chute entra no estoque que a Julia le e vira resposta
// errada para o cliente no WhatsApp.

import { Router } from 'express'
import { HttpError } from '../lib/db.js'
import { requireTenant, route } from '../lib/auth.js'

const router = Router()

const MODELO = process.env.OPENAI_FICHA_MODEL || 'gpt-5-nano'
const TIMEOUT_MS = Number(process.env.OPENAI_FICHA_TIMEOUT_MS || 55000)

// gpt-5-nano e um modelo que "pensa" antes de responder, e isso custa segundos.
// Ficha tecnica nao precisa de raciocinio longo: e consulta de especificacao.
// Com esforco minimo a resposta sai em poucos segundos em vez de dezenas.
// Se algum dia o modelo escolhido nao aceitar o parametro, o codigo repete a
// chamada sem ele em vez de quebrar.
const ESFORCO = process.env.OPENAI_FICHA_REASONING || 'minimal'

// Os campos que a IA pode devolver. Sao exatamente as colunas de `cars`
// que descrevem o modelo, nao a unidade.
const CAMPOS = {
  transmission: { type: ['string', 'null'], description: 'Use exatamente um destes: Manual, Automatico, Automatizado, CVT' },
  fuel: { type: ['string', 'null'], description: 'Use exatamente um destes: Flex, Gasolina, Etanol, Diesel, Hibrido, Eletrico, GNV' },
  body_type: { type: ['string', 'null'], description: 'Use exatamente um destes: Hatch, Seda, SUV, Picape, Utilitario, Coupe, Conversivel, Minivan' },
  doors: { type: ['integer', 'null'], description: 'Numero de portas' },
  engine: { type: ['string', 'null'], description: 'Motor, ex: 1.0 12V, 2.0 TFSI' },
  cylinders: { type: ['string', 'null'], description: 'Cilindros, ex: 3 cilindros, 4 cilindros' },
  horsepower: { type: ['string', 'null'], description: 'Potencia com unidade, ex: 80 cv' },
  torque: { type: ['string', 'null'], description: 'Torque com unidade, ex: 10,2 kgfm' },
  acceleration_0_100: { type: ['string', 'null'], description: '0 a 100 km/h em segundos, ex: 14,5' },
  aspiration: { type: ['string', 'null'], description: 'Aspirado ou Turbo' },
  traction: { type: ['string', 'null'], description: 'Use exatamente um destes: Dianteira, Traseira, 4x4, AWD' },
  air_conditioning: { type: ['string', 'null'], description: 'Manual, Digital, Dual zone ou Nao possui' },
  steering: { type: ['string', 'null'], description: 'Mecanica, Hidraulica, Eletro-hidraulica ou Eletrica' },
  electric_windows: { type: ['string', 'null'], description: 'Dianteiros, 4 portas, Nao possui' },
  sunroof: { type: ['string', 'null'], description: 'Teto solar: Nao possui, Solar, Panoramico' },
}

// O painel guarda esses campos como <select>. Se a IA devolver um texto que nao
// e identico a uma opcao, o campo aparece EM BRANCO no cadastro -- e some se a
// loja salvar o carro. Entao aqui o valor e encaixado na opcao certa, com acento
// e tudo, exatamente como o painel escreve.
const OPCOES = {
  transmission: ['Manual', 'Automático', 'Automatizado', 'CVT'],
  fuel: ['Flex', 'Gasolina', 'Etanol', 'Diesel', 'Híbrido', 'Elétrico', 'GNV'],
  body_type: ['Hatch', 'Sedã', 'SUV', 'Picape', 'Utilitário', 'Coupé', 'Conversível', 'Minivan'],
  traction: ['Dianteira', 'Traseira', '4x4', 'AWD'],
}

// Como a IA (ou o cadastro antigo) costuma escrever, e para onde isso vai.
const SINONIMOS = {
  body_type: { sedan: 'Sedã', cupe: 'Coupé', coupe: 'Coupé', perua: 'Utilitário', wagon: 'Utilitário', suv: 'SUV', pickup: 'Picape', hatchback: 'Hatch' },
  fuel: { eletrico: 'Elétrico', hibrido: 'Híbrido', alcool: 'Etanol', 'flex fuel': 'Flex' },
  transmission: { automatica: 'Automático', automatico: 'Automático', manual: 'Manual', cvt: 'CVT' },
  traction: { fwd: 'Dianteira', rwd: 'Traseira', awd: 'AWD', integral: 'AWD', quattro: 'AWD', '4motion': 'AWD', '4wd': '4x4' },
}

function semAcento(texto) {
  return String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function encaixaNaOpcao(campo, valor) {
  const lista = OPCOES[campo]
  if (!lista) return valor
  const alvo = semAcento(valor)

  // 1. igual a uma opcao, ignorando acento e caixa
  const exato = lista.find((o) => semAcento(o) === alvo)
  if (exato) return exato

  // 2. sinonimo conhecido
  const sin = (SINONIMOS[campo] || {})[alvo]
  if (sin) return sin

  // 3. "Dianteira (FWD)" -> "Dianteira", "4x4 (AWD)" -> "4x4"
  const semParenteses = alvo.replace(/\s*\(.*\)\s*/, '').trim()
  const porPrefixo = lista.find((o) => semAcento(o) === semParenteses)
  if (porPrefixo) return porPrefixo
  const sinPrefixo = (SINONIMOS[campo] || {})[semParenteses]
  if (sinPrefixo) return sinPrefixo

  // 4. ultima tentativa: alguma palavra conhecida dentro do texto
  for (const [chave, destino] of Object.entries(SINONIMOS[campo] || {})) {
    if (alvo.includes(chave)) return destino
  }
  for (const o of lista) {
    if (alvo.includes(semAcento(o))) return o
  }

  // fora da lista: melhor campo vazio do que lixo no estoque
  return null
}

const SCHEMA = {
  type: 'object',
  properties: CAMPOS,
  required: Object.keys(CAMPOS),
  additionalProperties: false,
}

const INSTRUCOES = [
  'Voce preenche fichas tecnicas de veiculos para uma loja brasileira.',
  'Receba marca, modelo e ano e devolva as especificacoes desse modelo no mercado brasileiro.',
  '',
  'Como decidir cada campo:',
  '- Preencha com a configuracao mais comum desse modelo naquele ano no Brasil.',
  '  A pessoa da loja confere tudo antes de salvar, entao um valor tipico ajuda;',
  '  campo vazio so da trabalho para ela.',
  '- Se o modelo teve varias versoes naquele ano, use a mais vendida.',
  '- Se o pedido trouxe a versao, decida por ela.',
  '- Deixe null so quando o item nao existe nesse modelo ou quando voce nao faz',
  '  ideia. Null e para desconhecimento, nao para duvida pequena.',
  '',
  'Formato:',
  '- Responda SOMENTE o JSON do schema. Nada de texto antes ou depois.',
  '- Padrao brasileiro: virgula decimal, cv para potencia, kgfm para torque.',
].join('\n')

router.post(
  '/',
  route(async (req, res) => {
    await requireTenant(req)

    const { brand, model, year, version } = req.body || {}
    if (!brand || !model) throw new HttpError(400, 'Informe ao menos marca e modelo.')
    if (!process.env.OPENAI_API_KEY) {
      throw new HttpError(503, 'IA nao configurada.', 'Falta OPENAI_API_KEY nas variaveis de ambiente.')
    }

    const carro = [brand, model, version, year].filter(Boolean).join(' ')
    const controle = new AbortController()
    const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS)

    function chamar(corpoPedido) {
      return fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controle.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(corpoPedido),
      })
    }

    const pedidoBase = {
      model: MODELO,
      messages: [
        { role: 'system', content: INSTRUCOES },
        { role: 'user', content: `Veiculo: ${carro}` },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'ficha_tecnica', strict: true, schema: SCHEMA },
      },
    }
    const pedido = ESFORCO === 'off' ? pedidoBase : { ...pedidoBase, reasoning_effort: ESFORCO }

    let resposta
    try {
      resposta = await chamar(pedido)

      // Modelo que nao conhece reasoning_effort devolve 400. Tenta sem ele.
      if (resposta.status === 400 && pedido.reasoning_effort) {
        const detalhe = await resposta.text()
        if (/reasoning_effort/i.test(detalhe)) {
          resposta = await chamar(pedidoBase)
        } else {
          console.error('[ficha] openai respondeu 400', detalhe.slice(0, 300))
          throw new HttpError(502, 'A IA recusou o pedido. Tente de novo.')
        }
      }
    } catch (erro) {
      if (erro instanceof HttpError) throw erro
      if (erro.name === 'AbortError') {
        throw new HttpError(504, 'A IA demorou demais. Tente de novo.')
      }
      throw new HttpError(502, 'Nao consegui falar com a IA agora.')
    } finally {
      clearTimeout(relogio)
    }

    if (!resposta.ok) {
      const detalhe = await resposta.text()
      console.error('[ficha] openai respondeu', resposta.status, detalhe.slice(0, 300))
      throw new HttpError(502, 'A IA nao respondeu agora. Tente de novo.')
    }

    const corpo = await resposta.json()
    const bruto = corpo?.choices?.[0]?.message?.content
    if (!bruto) throw new HttpError(502, 'A IA devolveu resposta vazia.')

    let ficha
    try {
      ficha = JSON.parse(bruto)
    } catch {
      console.error('[ficha] json invalido:', String(bruto).slice(0, 300))
      throw new HttpError(502, 'A IA devolveu algo fora do formato.')
    }

    // Cinto de seguranca: so passa chave que esta na lista, e nunca km, cor ou preco.
    const limpa = {}
    for (const campo of Object.keys(CAMPOS)) {
      const valor = ficha[campo]
      if (valor === null || valor === undefined || valor === '') continue
      if (campo === 'doors') { limpa[campo] = Number(valor); continue }
      const encaixado = encaixaNaOpcao(campo, String(valor).trim())
      if (encaixado === null) continue
      limpa[campo] = encaixado
    }

    res.json({
      ficha: limpa,
      preenchidos: Object.keys(limpa).length,
      total: Object.keys(CAMPOS).length,
      modelo_usado: MODELO,
    })
  }),
)

export default router
