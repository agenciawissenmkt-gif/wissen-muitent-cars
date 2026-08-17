import { Router } from 'express'
import crypto from 'node:crypto'
import { db, HttpError } from '../lib/db.js'
import { requireTenant, route } from '../lib/auth.js'

const router = Router()

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

function config() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const appUrl = process.env.APP_URL || 'http://localhost:5173'
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${appUrl}/api/google/callback`

  if (!clientId || !clientSecret) {
    throw new HttpError(
      501,
      'Integração com o Google Agenda não configurada no servidor.',
      'Defina GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI em server/.env.',
    )
  }

  return { clientId, clientSecret, redirectUri, appUrl }
}

/** O state carrega o tenant assinado, para o callback não aceitar loja forjada. */
function signState(tenantId) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'wissen-dev-secret'
  const payload = Buffer.from(JSON.stringify({ tenant_id: tenantId, ts: Date.now() })).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function readState(state) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'wissen-dev-secret'
  const [payload, signature] = String(state || '').split('.')
  if (!payload || !signature) throw new HttpError(400, 'Parâmetro state ausente ou malformado.')

  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(400, 'Assinatura do state inválida.')
  }

  const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
  if (Date.now() - data.ts > 15 * 60 * 1000) throw new HttpError(400, 'Autorização expirada. Tente novamente.')
  return data
}

router.get(
  '/auth-url',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)
    const { clientId, redirectUri } = config()

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', SCOPES)
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    url.searchParams.set('include_granted_scopes', 'true')
    url.searchParams.set('state', signState(tenant.id))

    res.json({ url: url.toString() })
  }),
)

router.get('/callback', async (req, res) => {
  const appUrl = process.env.APP_URL || 'http://localhost:5173'

  const done = (ok, error) =>
    res
      .status(ok ? 200 : 400)
      .type('html')
      .send(`<!doctype html><meta charset="utf-8"><title>Wissen Cars</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#0F172A">
<div style="text-align:center">
  <h1 style="font-size:1.1rem">${ok ? 'Agenda conectada!' : 'Não foi possível conectar'}</h1>
  <p style="color:#64748B;font-size:.9rem">${ok ? 'Pode fechar esta janela.' : String(error || '')}</p>
</div>
<script>
  try {
    window.opener && window.opener.postMessage(
      { type: 'wissen:google', ok: ${ok ? 'true' : 'false'}, error: ${JSON.stringify(String(error || ''))} },
      ${JSON.stringify(appUrl)}
    );
  } catch (e) {}
  setTimeout(function () { window.close() }, ${ok ? 1200 : 4000});
</script>
</body>`)

  try {
    const { code, state, error: oauthError } = req.query
    if (oauthError) throw new HttpError(400, `Autorização negada (${oauthError}).`)
    if (!code) throw new HttpError(400, 'Código de autorização ausente.')

    const { tenant_id: tenantId } = readState(state)
    const { clientId, clientSecret, redirectUri } = config()

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    const tokens = await tokenRes.json()
    if (!tokenRes.ok) throw new HttpError(400, tokens.error_description || 'Falha ao trocar o código por tokens.')

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = profileRes.ok ? await profileRes.json() : {}

    await db.upsert(
      'tenant_google_credentials',
      [
        {
          tenant_id: tenantId,
          email: profile.email ?? null,
          calendar_id: 'primary',
          access_token: tokens.access_token ?? null,
          refresh_token: tokens.refresh_token ?? null,
          scope: tokens.scope ?? null,
          expires_at: tokens.expires_in
            ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        },
      ],
      'tenant_id',
    )

    await db.upsert(
      'tenant_settings',
      [{ tenant_id: tenantId, google_calendar_id: profile.email ?? 'primary' }],
      'tenant_id',
    )

    done(true)
  } catch (error) {
    done(false, error.message)
  }
})

router.post(
  '/disconnect',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)
    await db.delete('tenant_google_credentials', `tenant_id=eq.${tenant.id}`)
    await db.upsert('tenant_settings', [{ tenant_id: tenant.id, google_calendar_id: null }], 'tenant_id')
    res.json({ ok: true })
  }),
)

export default router
