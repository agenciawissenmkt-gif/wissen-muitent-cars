/**
 * As chamadas de /api do painel, na demonstracao.
 *
 * - Ficha com IA e leitura do laudo funcionam de verdade, pelas rotas
 *   /api/demo/* (com o passe da demonstracao, sem gravar nada).
 * - Google Agenda, QR Code do WhatsApp, central de atendimento e envio para a
 *   automacao ficam desligados: devolvem um aviso explicando que no painel
 *   real aquele passo conecta a loja.
 */
import { arquivoDaDemo } from './fakeSupabase'
import { demoPasse, DEMO_TENANT, demoCliente } from './demo'

interface ErroDaDemo {
  message: string
  status: number
  hint?: string
}

const desligado = (message: string, hint: string): ErroDaDemo => ({ message, status: 403, hint })

async function chamar<T>(caminho: string, corpo: unknown): Promise<T> {
  const res = await fetch(`/api/demo${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-demo-passe': demoPasse() ?? '' },
    body: JSON.stringify(corpo),
  })
  const texto = await res.text()
  let dados: { error?: string; hint?: string } | null = null
  try {
    dados = texto ? JSON.parse(texto) : null
  } catch {
    dados = null
  }
  if (!res.ok) {
    throw { message: dados?.error || `Falha na demonstração (${res.status})`, status: res.status, hint: dados?.hint } satisfies ErroDaDemo
  }
  return dados as T
}

function paraBase64(arquivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(String(leitor.result || '').replace(/^data:[^,]*,/, ''))
    leitor.onerror = () => reject(new Error('Não consegui ler o PDF.'))
    leitor.readAsDataURL(arquivo)
  })
}

/** Lista da equipe cadastrada na demonstracao (para a etapa 3 parecer real). */
async function equipe(): Promise<{ email: string; name: string; role: string }[]> {
  const cliente = demoCliente()
  if (!cliente) return []
  const { data } = await cliente.from('salespeople').select('*').eq('tenant_id', DEMO_TENANT)
  return ((data as { email: string; name: string; role: string }[] | null) ?? []).filter((p) => p.email)
}

/**
 * Responde no lugar do servidor. Lanca { message, status, hint } quando o passo
 * e desligado na demonstracao -- o src/core/api.ts transforma isso em ApiError.
 */
export async function demoRequest<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const corpo = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
  const rota = caminho.split('?')[0]

  if (rota === '/ficha') {
    return chamar<T>('/ficha', {
      brand: corpo.brand,
      model: corpo.model,
      version: corpo.version,
      model_year: corpo.model_year,
    })
  }

  if (rota === '/laudo/ler') {
    const arquivo = arquivoDaDemo(String(corpo.pdf_url || ''))
    if (!arquivo) throw desligado('Escolha o PDF do laudo de novo.', 'Na demonstração o arquivo fica só nesta aba.')
    if (arquivo.size > 3 * 1024 * 1024) {
      throw desligado('Na demonstração o PDF pode ter até 3 MB.', 'No painel real o limite é 10 MB.')
    }
    return chamar<T>('/laudo', { pdf_base64: await paraBase64(arquivo) })
  }

  if (rota === '/chatwoot/team') return { agents: [] } as T

  if (rota === '/chatwoot/provision') {
    const pessoas = await equipe()
    return {
      account_id: 0,
      users: pessoas.map((p) => ({ email: p.email, chatwoot_user_id: null, role: p.role, invited: false })),
      // Sem e-mail e sem aviso: a etapa segue para o WhatsApp como no painel real.
      convites: [],
    } as T
  }

  if (rota === '/chatwoot/sso') {
    throw desligado(
      'Na demonstração a central de atendimento não abre.',
      'No painel real, este botão entra direto na central da loja, já logado.',
    )
  }

  if (rota.startsWith('/google/')) {
    throw desligado(
      'Na demonstração não dá para conectar o Google Agenda.',
      'No painel real, este botão conecta a agenda da loja e a Julia passa a marcar as visitas sozinha. Use "Pular por enquanto" para seguir.',
    )
  }

  if (rota === '/evolution/state') return { instance: 'demonstracao', status: 'desconectado', qrcode: null } as T
  if (rota === '/evolution/disconnect') return { ok: true } as T
  if (rota.startsWith('/evolution/')) {
    throw desligado(
      'Na demonstração não dá para gerar o QR Code do WhatsApp.',
      'No painel real, aqui aparece o QR Code: a loja lê com o celular e a Julia começa a atender no número dela.',
    )
  }

  if (rota === '/provisioning/complete') {
    throw desligado(
      'Na demonstração a loja não é ativada.',
      'No painel real, este passo liga a Julia no WhatsApp da loja.',
    )
  }

  throw desligado('Indisponível na demonstração.', 'Esta função só existe no painel real.')
}
