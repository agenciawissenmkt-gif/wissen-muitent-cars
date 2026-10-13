import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { olxSincronizar } from './api'
import { isDemo } from '../demo/demo'

/**
 * Estado da OLX no painel.
 *
 * A chave da OLX nunca chega aqui: o navegador so le as colunas liberadas de
 * olx_conexoes (migracao 0057). Por isso o select lista as colunas uma a uma --
 * `select('*')` seria negado pelo banco.
 */

export interface OlxConexao {
  tenant_id: string
  conta_nome: string | null
  conta_email: string | null
  telefone_anuncio: string | null
  publicar_tudo: boolean
  conectado_em: string
}

export type OlxSituacao =
  | 'pendente'
  | 'incompleto'
  | 'enviado'
  | 'em_analise'
  | 'publicado'
  | 'recusado'
  | 'erro'
  | 'removendo'
  | 'removido'

export interface OlxAnuncio {
  car_id: string
  situacao: OlxSituacao
  mensagem: string | null
  url: string | null
  atualizado_em: string
}

export const OLX_SITUACAO: Record<OlxSituacao, { label: string; tom: string }> = {
  pendente: { label: 'Aguardando envio', tom: 'bg-ink-100 text-ink-600' },
  incompleto: { label: 'Falta informação', tom: 'bg-amber-50 text-amber-700' },
  enviado: { label: 'Enviado à OLX', tom: 'bg-brand-50 text-brand-700' },
  em_analise: { label: 'Em análise na OLX', tom: 'bg-brand-50 text-brand-700' },
  publicado: { label: 'Publicado na OLX', tom: 'bg-emerald-50 text-emerald-700' },
  recusado: { label: 'Recusado pela OLX', tom: 'bg-red-50 text-red-700' },
  erro: { label: 'Erro no envio', tom: 'bg-red-50 text-red-700' },
  removendo: { label: 'Saindo da OLX', tom: 'bg-ink-100 text-ink-600' },
  removido: { label: 'Fora da OLX', tom: 'bg-ink-100 text-ink-600' },
}

const COLUNAS = 'tenant_id,conta_nome,conta_email,telefone_anuncio,publicar_tudo,conectado_em'

// Cache curto: o estoque pergunta "a loja tem OLX?" a cada carro salvo.
const cache = new Map<string, { em: number; conexao: OlxConexao | null }>()

export async function carregarConexaoOlx(tenantId: string, forcar = false): Promise<OlxConexao | null> {
  if (isDemo()) return null
  const guardado = cache.get(tenantId)
  if (!forcar && guardado && Date.now() - guardado.em < 60_000) return guardado.conexao
  const { data, error } = await supabase.from('olx_conexoes').select(COLUNAS).eq('tenant_id', tenantId).maybeSingle()
  // Sem a tabela (migracao nao aplicada) ou sem permissao: trata como nao conectada.
  const conexao = error ? null : ((data as OlxConexao | null) ?? null)
  cache.set(tenantId, { em: Date.now(), conexao })
  return conexao
}

export function esquecerConexaoOlx(tenantId: string) {
  cache.delete(tenantId)
}

/**
 * Depois de salvar, vender, dar sinal ou excluir um carro: deixa a OLX igual ao
 * painel. Roda em segundo plano e nunca derruba a tela -- se a loja nao tem OLX,
 * nem chama o servidor.
 */
export function olxDepoisDeMudar(tenantId: string | undefined | null, carId: string) {
  if (!tenantId) return
  void (async () => {
    try {
      const conexao = await carregarConexaoOlx(tenantId)
      if (!conexao) return
      await olxSincronizar(tenantId, carId)
    } catch (err) {
      console.warn('[olx] sincronizacao falhou', err)
    }
  })()
}

/** Conexao da loja + anuncios por carro, para as telas. */
export function useOlx(tenantId: string | null | undefined) {
  const [conexao, setConexao] = useState<OlxConexao | null>(null)
  const [anuncios, setAnuncios] = useState<Record<string, OlxAnuncio>>({})
  const [carregando, setCarregando] = useState(true)

  const recarregar = useCallback(async (): Promise<OlxConexao | null> => {
    if (!tenantId) return null
    const atual = await carregarConexaoOlx(tenantId, true)
    setConexao(atual)
    if (atual) {
      const { data } = await supabase
        .from('olx_anuncios')
        .select('car_id,situacao,mensagem,url,atualizado_em')
        .eq('tenant_id', tenantId)
      const mapa: Record<string, OlxAnuncio> = {}
      for (const linha of (data as OlxAnuncio[] | null) ?? []) mapa[linha.car_id] = linha
      setAnuncios(mapa)
    } else {
      setAnuncios({})
    }
    setCarregando(false)
    return atual
  }, [tenantId])

  useEffect(() => {
    void recarregar()
  }, [recarregar])

  return { conexao, anuncios, carregando, recarregar }
}
