import express from 'express'
import cors from 'cors'
import { supabaseConfigured } from './lib/db.js'
import googleRoutes from './routes/google.js'
import chatwootRoutes from './routes/chatwoot.js'
import evolutionRoutes from './routes/evolution.js'
import provisioningRoutes from './routes/provisioning.js'

/**
 * Back-end de provisionamento do Wissen Cars.
 *
 * O front fala direto com o Supabase para estoque e configurações; este servidor
 * existe apenas para as integrações que exigem chaves privilegiadas: Google OAuth,
 * Chatwoot (Platform App), Evolution API e o webhook do N8N.
 *
 * O app é exportado sem `listen()` para servir aos dois modos:
 *   - local:  server/index.js abre a porta 8787;
 *   - Vercel: api/index.js exporta este mesmo app como função serverless.
 */

const app = express()

// Na Vercel o front e a API vivem na mesma origem, então o CORS só importa em dev.
app.use(cors({ origin: process.env.APP_URL || true }))
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    integrations: {
      supabase: supabaseConfigured(),
      google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      chatwoot: Boolean(process.env.CHATWOOT_BASE_URL && process.env.CHATWOOT_PLATFORM_TOKEN),
      evolution: Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY),
      n8n: Boolean(process.env.N8N_PROVISIONING_WEBHOOK_URL),
      simulate: process.env.WISSEN_SIMULATE === 'true',
    },
  })
})

app.use('/api/google', googleRoutes)
app.use('/api/chatwoot', chatwootRoutes)
app.use('/api/evolution', evolutionRoutes)
app.use('/api/provisioning', provisioningRoutes)

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' })
})

export default app
