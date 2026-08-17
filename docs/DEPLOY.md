# Publicando na Vercel

O painel e o servidor de provisionamento vão **no mesmo projeto** da Vercel:

- o front (`npm run build` → `dist/`) é servido como estático;
- o Express vira uma função serverless em `api/index.js`, e o `vercel.json` manda
  todo `/api/*` para ela.

Uma origem só: sem CORS, e o callback do Google fica no mesmo domínio do app.

---

## 1. Criar o projeto

Vercel → **Add New › Project** → importe `agenciawissenmkt-gif/muscleform`.

A Vercel detecta Vite sozinha; o `vercel.json` já fixa build (`npm run build`),
saída (`dist`) e as rotas. Não precisa mexer em nada nessa tela.

> **Branch de produção.** O trabalho está em `claude/wissen-cars-saas-bxs31g`. Ou você
> mescla essa branch na `main`, ou aponta a produção para ela em
> **Settings › Git › Production Branch**. Sem isso a Vercel publica a `main`, que
> ainda tem o app antigo.

## 2. Variáveis de ambiente

**Settings › Environment Variables** — marque *Production* e *Preview* em todas.
São as mesmas do seu `server/.env`, mais as duas do front:

| Variável | Valor |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://bhffexojdowetruhbpxs.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | a anon key do projeto |
| `SUPABASE_URL` | `https://bhffexojdowetruhbpxs.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | a service_role key |
| `APP_URL` | `https://SEU-DOMINIO.vercel.app` |
| `GOOGLE_CLIENT_ID` | o client OAuth da agenda |
| `GOOGLE_CLIENT_SECRET` | idem |
| `GOOGLE_REDIRECT_URI` | `https://SEU-DOMINIO.vercel.app/api/google/callback` |
| `CHATWOOT_BASE_URL` | `https://wissen-chatwoot.2kk4lp.easypanel.host` |
| `CHATWOOT_PLATFORM_TOKEN` | token do Platform App |
| `EVOLUTION_API_URL` | `https://wissen-evolution-api.2kk4lp.easypanel.host` |
| `EVOLUTION_API_KEY` | a `AUTHENTICATION_API_KEY` |
| `N8N_PROVISIONING_WEBHOOK_URL` | `https://wissen-n8n.2kk4lp.easypanel.host/webhook/wissen-cars/provisionamento` |

As `VITE_*` são lidas **no build** — depois de alterá-las é preciso um novo deploy
(*Redeploy*), não basta reiniciar.

## 3. Ajustar os dois logins ao domínio novo

Depois do primeiro deploy você sabe o domínio. Cadastre-o em dois lugares, senão o
login e a agenda quebram:

**Google Cloud Console** › Credenciais › o client da agenda (`676914520995-…`) ›
*URIs de redirecionamento autorizados* → **adicione** (sem remover o de localhost):

```
https://SEU-DOMINIO.vercel.app/api/google/callback
```

**Supabase** › Authentication › URL Configuration:

- *Site URL*: `https://SEU-DOMINIO.vercel.app`
- *Redirect URLs*: acrescente `https://SEU-DOMINIO.vercel.app/**`

## 4. Conferir

```
https://SEU-DOMINIO.vercel.app/api/health
```

Deve responder com as cinco integrações em `true`:

```json
{"ok":true,"integrations":{"supabase":true,"google":true,"chatwoot":true,"evolution":true,"n8n":true,"simulate":false}}
```

Depois entre no app com a conta Google e confira estoque, dashboard e as 4 etapas.

---

## Detalhes que evitam dor de cabeça

- **Rotas do app** (`/estoque`, `/visao-geral`, `/implementacao`) funcionam ao recarregar
  a página por causa do rewrite de SPA no `vercel.json` — sem ele, F5 daria 404.
- **Tempo de execução**: a função tem 30s (`maxDuration`). O provisionamento do Chatwoot,
  que é o passo mais lento, roda bem dentro disso; o QR da Evolution é consultado pelo
  navegador a cada 3s, então cada chamada é curta.
- **Segredos**: `.vercelignore` bloqueia `.env` e `server/.env`. As chaves de servidor
  (service_role, Chatwoot, Evolution) nunca chegam ao navegador — só as `VITE_*`,
  que são públicas por natureza.
- **Rodar local continua igual**: `npm run dev` + `npm run server` usam o mesmo Express,
  via `server/index.js`.
