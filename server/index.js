import 'dotenv/config'
import app from './app.js'
import { supabaseConfigured } from './lib/db.js'

/** Modo local: sobe o servidor de provisionamento na porta 8787. */

const port = Number(process.env.PORT || 8787)

app.listen(port, () => {
  console.log(`[wissen-cars] servidor de provisionamento em http://localhost:${port}`)
  if (!supabaseConfigured()) {
    console.warn('[wissen-cars] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes — as rotas responderão 501.')
  }
})
