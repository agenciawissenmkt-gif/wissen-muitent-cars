#!/usr/bin/env node
/**
 * Confere se o projeto Supabase está pronto para o Wissen Cars.
 *
 *   npm run check
 *
 * Lê VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY do .env (ou do ambiente) e testa,
 * uma a uma, as peças que o app precisa: tabelas, funções, bucket de fotos e o
 * login com Google. Usa só a chave pública — nada aqui expõe segredo.
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

const env = { ...loadEnv('.env'), ...loadEnv('.env.local'), ...process.env }
const url = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const anonKey = env.VITE_SUPABASE_ANON_KEY || ''

const TABLES = [
  'stores', 'tenants', 'tenant_channels', 'tenant_settings', 'tenant_agents',
  'cars', 'car_photos', 'salespeople', 'tenant_google_credentials',
]
const FUNCTIONS = [
  { name: 'tenant_context', body: { p_account_id: 0, p_inbox_id: 0 } },
  { name: 'api_cars', body: { p_tenant: '00000000-0000-4000-8000-000000000000', p_model: null, p_status: 'ativo' } },
  { name: 'owns_tenant', body: { p_tenant: '00000000-0000-4000-8000-000000000000' } },
  { name: 'bootstrap_store', body: { p_nome: 'checagem' } },
]

const results = []
const record = (ok, label, detail) => results.push({ ok, label, detail })

if (!url || !anonKey) {
  console.error('\n  Faltam as chaves.\n')
  console.error('  Crie o arquivo .env na raiz (copie o .env.example) com:\n')
  console.error('    VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co')
  console.error('    VITE_SUPABASE_ANON_KEY=<anon key do projeto>\n')
  console.error('  As duas ficam em Project Settings › API, no painel do Supabase.\n')
  process.exit(1)
}

const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` }

// --- Conexão ----------------------------------------------------------------

try {
  // O endpoint raiz do PostgREST responde 401 para a anon key em projetos novos,
  // então a checagem de conexão usa uma tabela de verdade.
  const res = await fetch(`${url}/rest/v1/stores?select=id&limit=1`, { headers })
  if (res.status === 401) {
    record(false, 'Conexão com o projeto', 'a anon key foi recusada — confira se copiou a chave certa')
  } else {
    record(true, 'Conexão com o projeto', new URL(url).host)
  }
} catch (error) {
  record(false, 'Conexão com o projeto', `não consegui alcançar ${url} (${error.message})`)
}

// --- Tabelas ----------------------------------------------------------------

for (const table of TABLES) {
  try {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers })
    if (res.ok) {
      record(true, `Tabela ${table}`, 'existe e responde')
    } else {
      const body = (await res.json().catch(() => null)) ?? {}
      record(false, `Tabela ${table}`, body?.message || `HTTP ${res.status}`)
    }
  } catch (error) {
    record(false, `Tabela ${table}`, error.message)
  }
}

// --- Funções (RPC) ----------------------------------------------------------
// Com a anon key o acesso é negado de propósito (só service_role e usuário logado
// executam), então 401/403 também confirma que a função existe.

for (const fn of FUNCTIONS) {
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${fn.name}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(fn.body),
    })
    const body = (await res.json().catch(() => null)) ?? {}
    const missing =
      res.status === 404 || /could not find the function|does not exist/i.test(body?.message || '')

    if (missing) {
      record(false, `Função ${fn.name}()`, 'não encontrada — rode a migração')
    } else {
      record(true, `Função ${fn.name}()`, res.ok ? 'responde' : 'existe (acesso restrito, como esperado)')
    }
  } catch (error) {
    record(false, `Função ${fn.name}()`, error.message)
  }
}

// --- Bucket de fotos --------------------------------------------------------

try {
  const res = await fetch(`${url}/storage/v1/object/public/car-photos/checagem.png`)
  const body = await res.text()
  if (/bucket not found/i.test(body)) {
    record(false, 'Bucket car-photos', 'não existe — rode a migração')
  } else {
    record(true, 'Bucket car-photos', 'criado e público para leitura')
  }
} catch (error) {
  record(false, 'Bucket car-photos', error.message)
}

// --- Login com Google -------------------------------------------------------

try {
  const res = await fetch(`${url}/auth/v1/authorize?provider=google`, { redirect: 'manual', headers })
  const location = res.headers.get('location') || ''
  if (location.includes('accounts.google.com')) {
    record(true, 'Login com Google', 'provedor habilitado')
  } else {
    const body = await res.text()
    record(
      false,
      'Login com Google',
      /provider is not enabled|unsupported provider/i.test(body)
        ? 'desabilitado — ative em Authentication › Providers'
        : `resposta inesperada (HTTP ${res.status})`,
    )
  }
} catch (error) {
  record(false, 'Login com Google', error.message)
}

// --- Relatório --------------------------------------------------------------

const pending = results.filter((item) => !item.ok)

console.log(`\n  Wissen Cars — checagem do projeto Supabase\n  ${'─'.repeat(46)}\n`)
for (const item of results) {
  console.log(`  ${item.ok ? '✓' : '✗'}  ${item.label.padEnd(32)} ${item.detail}`)
}

if (pending.length === 0) {
  console.log('\n  Tudo pronto. Rode "npm run dev" e entre com sua conta Google.\n')
} else {
  console.log(`\n  ${pending.length} item(ns) pendente(s).`)
  console.log('  A migração do app fica em supabase/migrations/0002_app_layer.sql — cole no SQL Editor do projeto.\n')
  process.exit(1)
}
