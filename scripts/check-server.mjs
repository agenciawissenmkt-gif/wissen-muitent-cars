#!/usr/bin/env node
/**
 * Confere as chaves das integrações do servidor de provisionamento.
 *
 *   npm run check:server
 *
 * Lê server/.env e testa cada chave contra a API de verdade: Supabase, Chatwoot,
 * Evolution, Google e o webhook do N8N. Nenhum segredo é impresso na tela.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

function loadEnv(file) {
  const path = resolve(ROOT, file)
  if (!existsSync(path)) return {}

  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        const key = line.slice(0, index).trim()
        let value = line.slice(index + 1).trim()

        // Comentário no fim da linha, como o dotenv faz: só fora de aspas.
        if (!/^["']/.test(value)) value = value.split(/\s+#/)[0].trim()
        return [key, value.replace(/^["']|["']$/g, '')]
      }),
  )
}

const env = { ...loadEnv('server/.env'), ...process.env }
const results = []
const record = (status, label, detail) => results.push({ status, label, detail })
const trim = (url) => (url || '').replace(/\/$/, '')

if (!existsSync(resolve(ROOT, 'server/.env'))) {
  console.error('\n  server/.env não existe. Crie com:\n\n    cp server/.env.example server/.env\n')
  process.exit(1)
}

// --- Supabase (service role) -------------------------------------------------

{
  const url = trim(env.SUPABASE_URL)
  const key = env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    record('faltando', 'Supabase (service role)', 'defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY')
  } else {
    try {
      const res = await fetch(`${url}/rest/v1/stores?select=id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      })
      if (res.ok) record('ok', 'Supabase (service role)', new URL(url).host)
      else if (res.status === 401) record('erro', 'Supabase (service role)', 'chave recusada (401) — confira a service_role key')
      else record('erro', 'Supabase (service role)', `HTTP ${res.status}`)
    } catch (error) {
      record('erro', 'Supabase (service role)', error.message)
    }
  }
}

// --- Chatwoot (Platform App / Super Admin) -----------------------------------

{
  const url = trim(env.CHATWOOT_BASE_URL)
  const token = env.CHATWOOT_PLATFORM_TOKEN

  if (!url || !token) {
    record('faltando', 'Chatwoot (Platform App)', 'defina CHATWOOT_BASE_URL e CHATWOOT_PLATFORM_TOKEN')
  } else if (/^http:\/\/[a-z_]+:\d+/i.test(url)) {
    record('erro', 'Chatwoot (Platform App)', `${url} é endereço interno do Docker — use a URL pública aqui`)
  } else {
    // Um Platform App só enxerga o que ele mesmo criou, então ler uma conta
    // existente devolve 401 mesmo com token bom. O teste que distingue é um POST
    // com corpo inválido: token válido chega na validação (422), token ruim para
    // na autenticação (401). Nada é criado.
    try {
      const res = await fetch(`${url}/platform/api/v1/accounts`, {
        method: 'POST',
        headers: { api_access_token: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (res.status === 422) record('ok', 'Chatwoot (Platform App)', `${new URL(url).host} — token válido`)
      else if (res.status === 401 || res.status === 403)
        record('erro', 'Chatwoot (Platform App)', 'token recusado — precisa ser de um Platform App (/super_admin › Platform Apps)')
      else if (res.ok) {
        record('aviso', 'Chatwoot (Platform App)', 'token válido, mas a checagem criou uma conta sem nome — apague no Chatwoot')
      } else record('erro', 'Chatwoot (Platform App)', `HTTP ${res.status}`)
    } catch (error) {
      record('erro', 'Chatwoot (Platform App)', error.message)
    }
  }
}

// --- Evolution API -----------------------------------------------------------

{
  const url = trim(env.EVOLUTION_API_URL)
  const key = env.EVOLUTION_API_KEY

  if (!key) {
    record('faltando', 'Evolution API', 'defina EVOLUTION_API_KEY (a URL pode vir de tenant_settings)')
  } else if (!url) {
    record('aviso', 'Evolution API', 'sem EVOLUTION_API_URL — o servidor vai usar tenant_settings.evolution_base_url')
  } else {
    try {
      const res = await fetch(`${url}/instance/fetchInstances`, { headers: { apikey: key } })
      if (res.ok) {
        const data = await res.json().catch(() => [])
        const total = Array.isArray(data) ? data.length : 0
        record('ok', 'Evolution API', `${new URL(url).host} — ${total} instância(s)`)
      } else if (res.status === 401 || res.status === 403) {
        record('erro', 'Evolution API', 'apikey recusada — use a AUTHENTICATION_API_KEY global')
      } else {
        record('erro', 'Evolution API', `HTTP ${res.status}`)
      }
    } catch (error) {
      record('erro', 'Evolution API', error.message)
    }
  }
}

// --- Google OAuth ------------------------------------------------------------

{
  const id = env.GOOGLE_CLIENT_ID
  const secret = env.GOOGLE_CLIENT_SECRET
  const appUrl = trim(env.APP_URL) || 'http://localhost:5173'
  const redirect = env.GOOGLE_REDIRECT_URI || `${appUrl}/api/google/callback`

  if (!id || !secret) {
    record('faltando', 'Google OAuth', 'defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET')
  } else if (!id.endsWith('.apps.googleusercontent.com')) {
    record('erro', 'Google OAuth', 'o client ID deveria terminar em .apps.googleusercontent.com')
  } else {
    // Troca de código inválido: o Google responde 400 "invalid_grant" quando o par
    // client_id/secret é válido, e "invalid_client" quando não é.
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: 'checagem-wissen-cars',
          client_id: id,
          client_secret: secret,
          redirect_uri: redirect,
          grant_type: 'authorization_code',
        }),
      })
      const body = await res.json().catch(() => ({}))

      if (body.error === 'invalid_client') {
        record('erro', 'Google OAuth', 'client_id/secret recusados pelo Google')
      } else if (body.error === 'invalid_grant' || res.ok) {
        record('ok', 'Google OAuth', 'credenciais aceitas pelo Google')
      } else {
        record('aviso', 'Google OAuth', `resposta inesperada: ${body.error ?? res.status}`)
      }
    } catch (error) {
      record('erro', 'Google OAuth', error.message)
    }

    record(
      'info',
      'Google — redirect URI',
      `cadastre exatamente: ${redirect}`,
    )
  }
}

// --- N8N ---------------------------------------------------------------------

{
  const webhook = env.N8N_PROVISIONING_WEBHOOK_URL

  if (!webhook) {
    record('faltando', 'N8N (provisionamento)', 'defina N8N_PROVISIONING_WEBHOOK_URL')
  } else {
    try {
      // POST sem tenant: o fluxo responde 400 de propósito, o que prova que está ativo.
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ping: 'check-server' }),
      })
      if (res.status === 400) record('ok', 'N8N (provisionamento)', 'webhook ativo e respondendo')
      else if (res.status === 404)
        record('erro', 'N8N (provisionamento)', 'webhook não registrado — o workflow está ativo no n8n?')
      else record('aviso', 'N8N (provisionamento)', `HTTP ${res.status}`)
    } catch (error) {
      record('erro', 'N8N (provisionamento)', error.message)
    }
  }
}

// --- Relatório ---------------------------------------------------------------

const ICON = { ok: '✓', erro: '✗', faltando: '·', aviso: '!', info: 'i' }

console.log(`\n  Wissen Cars — checagem das integrações do servidor\n  ${'─'.repeat(52)}\n`)
for (const item of results) {
  console.log(`  ${ICON[item.status]}  ${item.label.padEnd(26)} ${item.detail}`)
}

const broken = results.filter((item) => item.status === 'erro')
const missing = results.filter((item) => item.status === 'faltando')

console.log('')
if (!broken.length && !missing.length) {
  console.log('  Tudo configurado. Rode "npm run server" e faça a implementação pelo painel.\n')
} else {
  if (missing.length) console.log(`  ${missing.length} integração(ões) ainda sem chave — a etapa correspondente fica indisponível.`)
  if (broken.length) console.log(`  ${broken.length} com chave inválida — veja docs/CHAVES.md.`)
  console.log('')
  if (broken.length) process.exit(1)
}
