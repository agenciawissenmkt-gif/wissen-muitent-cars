// Rota interna: IA do relatório semanal do Painel Empresarial.
//
// A chave da OpenAI mora só aqui (a mesma da ficha técnica). O Painel Empresarial
// manda o pedido já montado, com o segredo compartilhado INTERNAL_API_SECRET no
// cabeçalho, e recebe a resposta da OpenAI. A chave nunca sai deste servidor.
//
// Travas: segredo em comparação de tempo constante, só os modelos permitidos,
// no máximo 2 mensagens e 60 mil caracteres, e resposta obrigatoriamente em JSON.

import crypto from 'node:crypto'
import { Router } from 'express'

const router = Router()

const MODELOS = new Set(
  String(process.env.INTERNAL_AI_MODELS || 'gpt-6-luna,gpt-5.6-luna,gpt-5-mini,gpt-5-nano')
    .split(',')
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean),
)

function autorizado(req) {
  const esperado = process.env.INTERNAL_API_SECRET || ''
  const recebido = String(req.headers['x-wissen-interno'] || '')
  if (esperado.length < 32 || recebido.length !== esperado.length) return false
  return crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado))
}

router.post('/ia-relatorio', async (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ error: 'Não autorizado.' })
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'IA não configurada.' })

  const { model, messages, response_format: formato, reasoning_effort: esforco } = req.body || {}
  const texto = JSON.stringify(messages || [])
  if (!MODELOS.has(String(model || '').toLowerCase())) return res.status(400).json({ error: 'Modelo não permitido.' })
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 2 || texto.length > 60000) {
    return res.status(400).json({ error: 'Pedido fora do limite.' })
  }
  if (formato?.type !== 'json_schema') return res.status(400).json({ error: 'Formato não permitido.' })

  const corpo = {
    model,
    messages: messages.map((m) => ({ role: m.role === 'system' ? 'system' : 'user', content: String(m.content ?? '') })),
    response_format: formato,
    ...(['minimal', 'low', 'medium'].includes(esforco) ? { reasoning_effort: esforco } : {}),
  }

  try {
    const resposta = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(30000),
    })
    const texto = await resposta.text()
    res.status(resposta.status).type('application/json').send(texto)
  } catch (erro) {
    res.status(504).json({ error: erro?.name === 'TimeoutError' ? 'A IA demorou demais.' : 'IA inacessível.' })
  }
})

export default router
