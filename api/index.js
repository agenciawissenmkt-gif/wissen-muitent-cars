import app from '../server/app.js'

/**
 * Entrada serverless da Vercel.
 *
 * O vercel.json manda todo `/api/*` para cá, e o Express continua enxergando o
 * caminho completo (`/api/google/auth-url`, `/api/evolution/state`...), então as
 * rotas são exatamente as mesmas do servidor local.
 *
 * As variáveis de ambiente vêm do painel da Vercel (Settings › Environment
 * Variables) — o mesmo conteúdo do server/.env.
 */
export default app
