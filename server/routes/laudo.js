// Le o PDF do laudo que a loja acabou de subir no cadastro do carro e devolve
// empresa, data, resultado e apontamentos para o formulario ja vir preenchido.
//
// A chave da OpenAI fica AQUI, no servidor. Ela nunca vai para o navegador.
//
// Regras deste arquivo (as mesmas da Julia):
// - So o que esta escrito no documento. Nada de chute.
// - Resultado so quando o documento traz o parecer (aprovado, aprovado com
//   apontamento, reprovado). Consulta veicular sem parecer volta sem resultado e
//   quem escolhe e a loja -- um "aprovado" inventado vira resposta errada no WhatsApp.
// - A loja sempre confere antes de salvar.

import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { db, HttpError } from '../lib/db.js'
import { requireTenant, route } from '../lib/auth.js'
import { MODELO as MODELO_FICHA } from './ficha.js'

const router = Router()

// Ordem de tentativa: o modelo escolhido na Vercel (OPENAI_LAUDO_MODEL), depois o
// mesmo da Julia e, por ultimo, o da ficha tecnica. Modelo que a conta nao tem
// devolve erro e o proximo da lista assume.
const MODELOS = [...new Set([process.env.OPENAI_LAUDO_MODEL, 'gpt-6-luna', MODELO_FICHA].filter(Boolean))]

// A funcao da Vercel vai ate 60 s.
const TIMEOUT_MS = Number(process.env.OPENAI_LAUDO_TIMEOUT_MS || 50000)

const RESULTADOS = ['aprovado', 'com_apontamento', 'reprovado']

const SCHEMA = {
  type: 'object',
  properties: {
    tipo_documento: {
      type: 'string',
      enum: ['laudo_cautelar', 'vistoria', 'consulta_veicular', 'outro'],
      description: 'Que documento e este.',
    },
    empresa: {
      type: ['string', 'null'],
      description: 'Nome da empresa que emitiu o laudo ou a consulta, como aparece no documento. Null se nao aparecer.',
    },
    data: {
      type: ['string', 'null'],
      description: 'Data de emissao do documento no formato AAAA-MM-DD. Null se nao aparecer.',
    },
    resultado: {
      type: ['string', 'null'],
      enum: [...RESULTADOS, null],
      description:
        'Parecer final ESCRITO no documento: aprovado; com_apontamento (aprovado com apontamento/ressalva); reprovado. Null se o documento nao traz parecer final.',
    },
    apontamentos: {
      type: ['string', 'null'],
      description:
        'O que o documento aponta de negativo ou de atencao, em ate 3 frases curtas (ex.: registro de leilao em 2014; indicio de sinistro; repintura no para-choque). Null se nao aponta nada.',
    },
  },
  required: ['tipo_documento', 'empresa', 'data', 'resultado', 'apontamentos'],
  additionalProperties: false,
}

const INSTRUCOES = [
  'Voce le o PDF anexado como laudo de um carro a venda numa loja brasileira: pode ser laudo cautelar,',
  'vistoria ou consulta veicular (historico, leilao, sinistro, gravame, roubo e furto, debitos).',
  'Preencha o JSON so com o que esta ESCRITO no documento. Nada de suposicao.',
  '- empresa: quem emitiu o documento (a empresa de vistoria ou de consulta), nao o nome da loja nem do dono.',
  '- data: a data de emissao do documento.',
  '- resultado: so se o documento disser o parecer final. Consulta veicular sem parecer: null.',
  '  "Conforme", "aprovado sem ressalvas" = aprovado. "Aprovado com apontamento/ressalva/observacao" = com_apontamento.',
  '  "Reprovado", "nao conforme", "nao recomendado" = reprovado.',
  '- apontamentos: o que pesa na compra (leilao, sinistro, remarcacao, estrutura, repintura, km que nao bate,',
  '  restricao, debito). Sem placa, chassi, renavam, CPF, CNPJ ou nome de dono.',
  'Responda SOMENTE o JSON do schema.',
].join('\n')

function prefixoDaLoja(tenantId) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '')
  return `${base}/storage/v1/object/public/car-laudos/${tenantId}/`
}

function dataValida(texto) {
  const m = String(texto || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (ano < 2000 || ano > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  if (d.getUTCMonth() !== mes - 1) return null
  // Laudo do futuro e erro de leitura.
  if (d.getTime() > Date.now() + 2 * 86400000) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

const curto = (texto, max) => {
  const t = String(texto || '').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

/** Confere a resposta da IA: so campo conhecido, data real, resultado da lista. */
export function limpaLeitura(bruto) {
  return {
    tipo_documento: ['laudo_cautelar', 'vistoria', 'consulta_veicular', 'outro'].includes(bruto?.tipo_documento)
      ? bruto.tipo_documento
      : 'outro',
    empresa: curto(bruto?.empresa, 80),
    data: dataValida(bruto?.data),
    resultado: RESULTADOS.includes(bruto?.resultado) ? bruto.resultado : null,
    apontamentos: curto(bruto?.apontamentos, 500),
  }
}

/** Texto final da Responses API (o campo output_text so existe nos SDKs). */
function textoDaResposta(corpo) {
  if (typeof corpo?.output_text === 'string') return corpo.output_text
  let texto = ''
  for (const item of corpo?.output || []) {
    for (const parte of item?.content || []) if (parte?.type === 'output_text') texto += parte.text || ''
  }
  return texto
}

async function registrarConsumo(tenantId, pedidoId, modelo, uso) {
  if (!uso) return
  try {
    await db.insert('ai_usage', [
      {
        tenant_id: tenantId,
        model: String(modelo).toLowerCase(),
        agent_type: 'leitura_laudo',
        prompt_tokens: Math.max(0, Number(uso.input_tokens) || 0),
        completion_tokens: Math.max(0, Number(uso.output_tokens) || 0),
        execution_id: `laudo:${pedidoId}`,
      },
    ])
  } catch (erro) {
    // Registro de custo nunca pode impedir a loja de receber a leitura.
    console.error('[laudo] nao consegui registrar o consumo:', erro?.message || erro)
  }
}

router.post(
  '/ler',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)

    const url = String(req.body?.pdf_url || '')
    if (!url) throw new HttpError(400, 'Informe o PDF do laudo.')
    // So PDF desta loja, no bucket dos laudos.
    if (!url.startsWith(prefixoDaLoja(tenant.id)) || !/\.pdf$/i.test(url)) {
      throw new HttpError(400, 'Esse PDF nao e do cadastro desta loja.')
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new HttpError(503, 'IA nao configurada.', 'Falta OPENAI_API_KEY nas variaveis de ambiente.')
    }

    const controle = new AbortController()
    const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS)
    const pedidoId = randomUUID()

    try {
      for (let i = 0; i < MODELOS.length; i++) {
        const modelo = MODELOS[i]
        const resposta = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          signal: controle.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          body: JSON.stringify({
            model: modelo,
            reasoning: { effort: 'low' },
            max_output_tokens: 3000,
            text: { format: { type: 'json_schema', name: 'leitura_laudo', strict: true, schema: SCHEMA } },
            input: [
              { role: 'system', content: INSTRUCOES },
              {
                role: 'user',
                content: [
                  { type: 'input_file', file_url: url },
                  { type: 'input_text', text: 'Leia este laudo e preencha o JSON.' },
                ],
              },
            ],
          }),
        })

        if (!resposta.ok) {
          const detalhe = await resposta.text()
          // Modelo que a conta nao tem (ou que nao aceita algum parametro): tenta o proximo.
          if ((resposta.status === 400 || resposta.status === 404) && i < MODELOS.length - 1 && /model|reasoning/i.test(detalhe)) {
            console.error(`[laudo] ${modelo} recusou, tentando o proximo:`, detalhe.slice(0, 200))
            continue
          }
          console.error('[laudo] openai respondeu', resposta.status, detalhe.slice(0, 300))
          throw new HttpError(502, 'Nao consegui ler o PDF agora. Preencha os campos a mao ou tente de novo.')
        }

        const corpo = await resposta.json()
        await registrarConsumo(tenant.id, pedidoId, modelo, corpo?.usage)
        const bruto = textoDaResposta(corpo)
        let json
        try {
          json = JSON.parse(bruto)
        } catch {
          console.error('[laudo] json invalido:', String(bruto).slice(0, 300))
          throw new HttpError(502, 'A leitura do PDF veio fora do formato. Tente de novo.')
        }
        res.json({ leitura: limpaLeitura(json), modelo_usado: modelo })
        return
      }
      throw new HttpError(502, 'Nao consegui ler o PDF agora.')
    } catch (erro) {
      if (erro instanceof HttpError) throw erro
      if (erro?.name === 'AbortError') throw new HttpError(504, 'A leitura do PDF demorou demais. Preencha a mao ou tente de novo.')
      throw new HttpError(502, 'Nao consegui falar com a IA agora.')
    } finally {
      clearTimeout(relogio)
    }
  }),
)

export default router
