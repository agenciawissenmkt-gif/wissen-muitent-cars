import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { webmotorsSincronizar } from './api'
import { isDemo } from '../demo/demo'

/**
 * Estado da Webmotors no painel.
 *
 * O login da loja (senha) e a sessao da Webmotors nunca chegam aqui: o
 * navegador so le as colunas liberadas de webmotors_conexoes (migracao 0058).
 * Por isso o select lista as colunas uma a uma -- `select('*')` seria negado.
 */

export interface WebmotorsConexao {
  tenant_id: string
  cnpj: string
  email: string
  modalidade_cod: number | null
  modalidade_nome: string | null
  publicar_tudo: boolean
  conectado_em: string
}

export type WebmotorsSituacao = 'pendente' | 'incompleto' | 'enviando_fotos' | 'publicado' | 'erro' | 'removido'

export interface WebmotorsAnuncio {
  car_id: string
  codigo_anuncio: number | null
  situacao: WebmotorsSituacao
  mensagem: string | null
  atualizado_em: string
}

export const WEBMOTORS_SITUACAO: Record<WebmotorsSituacao, { label: string; tom: string }> = {
  pendente: { label: 'Aguardando envio', tom: 'bg-ink-100 text-ink-600' },
  incompleto: { label: 'Falta informação', tom: 'bg-amber-50 text-amber-700' },
  enviando_fotos: { label: 'Enviando fotos', tom: 'bg-brand-50 text-brand-700' },
  publicado: { label: 'Publicado na Webmotors', tom: 'bg-emerald-50 text-emerald-700' },
  erro: { label: 'Erro na Webmotors', tom: 'bg-red-50 text-red-700' },
  removido: { label: 'Fora da Webmotors', tom: 'bg-ink-100 text-ink-600' },
}

const COLUNAS = 'tenant_id,cnpj,email,modalidade_cod,modalidade_nome,publicar_tudo,conectado_em'

// Cache curto: o estoque pergunta "a loja tem Webmotors?" a cada carro salvo.
const cache = new Map<string, { em: number; conexao: WebmotorsConexao | null }>()

export async function carregarConexaoWebmotors(tenantId: string, forcar = false): Promise<WebmotorsConexao | null> {
  if (isDemo()) return null
  const guardado = cache.get(tenantId)
  if (!forcar && guardado && Date.now() - guardado.em < 60_000) return guardado.conexao
  const { data, error } = await supabase.from('webmotors_conexoes').select(COLUNAS).eq('tenant_id', tenantId).maybeSingle()
  // Sem a tabela (migracao nao aplicada) ou sem permissao: trata como nao conectada.
  const conexao = error ? null : ((data as WebmotorsConexao | null) ?? null)
  cache.set(tenantId, { em: Date.now(), conexao })
  return conexao
}

export function esquecerConexaoWebmotors(tenantId: string) {
  cache.delete(tenantId)
}

/**
 * Depois de salvar, vender, dar sinal ou excluir um carro: deixa a Webmotors
 * igual ao painel. Roda em segundo plano e nunca derruba a tela -- se a loja nao
 * tem Webmotors, nem chama o servidor.
 */
export function webmotorsDepoisDeMudar(tenantId: string | undefined | null, carId: string) {
  if (!tenantId) return
  void (async () => {
    try {
      const conexao = await carregarConexaoWebmotors(tenantId)
      if (!conexao) return
      await webmotorsSincronizar(tenantId, carId)
    } catch (err) {
      console.warn('[webmotors] sincronizacao falhou', err)
    }
  })()
}

/** Conexao da loja + anuncios por carro, para as telas. */
export function useWebmotors(tenantId: string | null | undefined) {
  const [conexao, setConexao] = useState<WebmotorsConexao | null>(null)
  const [anuncios, setAnuncios] = useState<Record<string, WebmotorsAnuncio>>({})
  const [carregando, setCarregando] = useState(true)

  const recarregar = useCallback(async (): Promise<WebmotorsConexao | null> => {
    if (!tenantId) return null
    const atual = await carregarConexaoWebmotors(tenantId, true)
    setConexao(atual)
    if (atual) {
      const { data } = await supabase
        .from('webmotors_anuncios')
        .select('car_id,codigo_anuncio,situacao,mensagem,atualizado_em')
        .eq('tenant_id', tenantId)
      const mapa: Record<string, WebmotorsAnuncio> = {}
      for (const linha of (data as WebmotorsAnuncio[] | null) ?? []) mapa[linha.car_id] = linha
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
