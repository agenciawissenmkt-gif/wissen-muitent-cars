/**
 * Integração com o Painel Empresarial Wissen Cars.
 *
 * Só entra no painel quem teve o e-mail Google liberado pela equipe Wissen Cars.
 * A trava fica no banco (trigger em auth.users, migração 0039): quando o e-mail
 * não está liberado, o Supabase recusa a criação da conta e devolve o usuário
 * para cá com `error_description=Database error saving new user` na URL.
 *
 * Este módulo lê esse erro ANTES do cliente do Supabase processar a URL (por isso
 * é importado primeiro em main.tsx) e limpa a URL para o erro não ficar preso.
 */

export type AccessError = 'nao_liberado' | 'falha'

function read(): AccessError | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const description = params.get('error_description') ?? hash.get('error_description')
  const code = params.get('error') ?? hash.get('error')
  if (!description && !code) return null

  const clean = new URL(window.location.href)
  for (const key of ['error', 'error_code', 'error_description']) clean.searchParams.delete(key)
  clean.hash = ''
  window.history.replaceState(null, '', clean.pathname + clean.search)

  return /database error saving new user|WISSEN_ACCESS_NOT_APPROVED/i.test(description ?? '') ? 'nao_liberado' : 'falha'
}

export const initialAccessError: AccessError | null = read()

export const ACCESS_ERROR_TEXT: Record<AccessError, string> = {
  nao_liberado:
    'Este e-mail ainda não foi liberado para usar o Wissen Cars. Fale com a equipe Wissen Cars para liberar o seu acesso e depois entre de novo com a mesma conta Google.',
  falha: 'Não foi possível concluir o login com o Google. Tente de novo.',
}
