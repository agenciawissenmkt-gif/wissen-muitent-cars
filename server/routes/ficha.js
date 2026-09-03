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
const TIMEOUT_MS = Number(process.env.OPENAI_FICHA_TIMEOUT_MS || 20000)

// Os campos que a IA pode devolver. Sao exatamente as colunas de `cars`
// que descrevem o modelo, nao a unidade.
const CAMPOS = {
  transmission: { type: ['string', 'null'], description: 'Cambio: Manual, Automatico, CVT, Automatizado' },
  fuel: { type: ['string', 'null'], description: 'Combustivel: Gasolina, Flex, Diesel, Eletrico, Hibrido' },
  body_type: { type: ['string', 'null'], description: 'Carroceria: Hatch, Sedan, SUV, Picape, Perua, Cupe' },
  doors: { type: ['integer', 'null'], description: 'Numero de portas' },
  engine: { type: ['string', 'null'], description: 'Motor, ex: 1.0 12V, 2.0 TFSI' },
  cylinders: { type: ['string', 'null'], description: 'Cilindros, ex: 3 cilindros, 4 cilindros' },
  horsepower: { type: ['string', 'null'], description: 'Potencia com unidade, ex: 80 cv' },
  torque: { type: ['string', 'null'], description: 'Torque com unidade, ex: 10,2 kgfm' },
  acceleration_0_100: { type: ['string', 'null'], description: '0 a 100 km/h em segundos, ex: 14,5' },
  aspiration: { type: ['string', 'null'], description: 'Aspirado ou Turbo' },
  traction: { type: ['string', 'null'], description: 'Dianteira (FWD), Traseira (RWD), Integral (AWD)' },
  air_conditioning: { type: ['string', 'null'], description: 'Manual, Digital, Dual zone ou Nao possui' },
  steering: { type: ['string', 'null'], description: 'Mecanica, Hidraulica, Eletro-hidraulica ou Eletrica' },
  electric_windows: { type: ['string', 'null'], description: 'Dianteiros, 4 portas, Nao possui' },
  sunroof: { type: ['string', 'null'], description: 'Teto solar: Nao possui, Solar, Panoramico' },
}

const SCHEMA = {
  type: 'object',
  properties: CAMPOS,
  required: Object.keys(CAMPOS),
  additionalProperties: false,
}

const INSTRUCOES = [
  'Voce preenche fichas tecnicas de veiculos para uma loja brasileira.',
  'Receba marca, modelo e ano e devolva as especificacoes de fabrica desse modelo no mercado brasileiro.',
  '',
  'Regras:',
  '- Responda SOMENTE o JSON do schema. Nada de texto antes ou depois.',
  '- Campo que voce nao tem certeza vai como null. Null e melhor que chute:',
  '  esse dado vai para o estoque da loja e sera dito ao cliente como verdade.',
  '- Nao invente equipamento opcional. Se o item varia por versao e voce nao',
  '  sabe qual versao e, devolva null.',
  '- Use o padrao brasileiro: virgula decimal, cv para potencia, kgfm para torque.',
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

    let resposta
    try {
      resposta = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controle.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODELO,
          messages: [
            { role: 'system', content: INSTRUCOES },
            { role: 'user', content: `Veiculo: ${carro}` },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'ficha_tecnica', strict: true, schema: SCHEMA },
          },
        }),
      })
    } catch (erro) {
      if (erro.name === 'AbortError') throw new HttpError(504, 'A IA demorou demais. Tente de novo.')
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
      limpa[campo] = campo === 'doors' ? Number(valor) : String(valor).trim()
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
