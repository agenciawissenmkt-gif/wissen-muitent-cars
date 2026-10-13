import { useEffect, useRef, useState } from 'react'
import { Button } from '../../ui/Button'
import { Select, Toggle } from '../../ui/Field'
import { ApiError, olxCatalogo, olxSincronizar, olxSugerir, type OlxItem } from '../../core/api'
import { OLX_SITUACAO, type OlxAnuncio, type OlxConexao } from '../../core/olx'

/**
 * Parte do cadastro do carro que so aparece quando a loja conectou a OLX
 * (Integracoes). A loja digita marca/modelo/versao normalmente; aqui o painel
 * acha os mesmos no catalogo da OLX sozinho, e a loja so confere.
 */

export interface OlxCampos {
  olx_marca_id: number | null
  olx_marca: string | null
  olx_modelo_id: number | null
  olx_modelo: string | null
  olx_versao_id: number | null
  olx_versao: string | null
  olx_publicar: boolean
}

export const OLX_VAZIO: OlxCampos = {
  olx_marca_id: null,
  olx_marca: null,
  olx_modelo_id: null,
  olx_modelo: null,
  olx_versao_id: null,
  olx_versao: null,
  olx_publicar: true,
}

interface Props {
  tenantId: string
  carId: string | null
  conexao: OlxConexao
  anuncio: OlxAnuncio | null
  /** O que a loja digitou no cadastro (marca, modelo, versão, motor, câmbio, cor...). */
  carro: Record<string, string>
  valor: OlxCampos
  onChange: (valor: OlxCampos) => void
}

const resumo = (carro: Record<string, string>) =>
  [
    ['Cor', carro.color],
    ['Portas', carro.doors],
    ['Câmbio', carro.transmission],
    ['Combustível', carro.fuel],
    ['Carroceria', carro.body_type],
    ['Direção', carro.steering],
  ].filter(([, v]) => v && v.trim())

export function OlxSecao({ tenantId, carId, conexao, anuncio, carro, valor, onChange }: Props) {
  const [marcas, setMarcas] = useState<OlxItem[]>([])
  const [modelos, setModelos] = useState<OlxItem[]>([])
  const [versoes, setVersoes] = useState<OlxItem[]>([])
  const [buscando, setBuscando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [conferir, setConferir] = useState(false)
  const [publicando, setPublicando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)
  // Depois que a loja escolhe na mão, o painel para de sugerir sozinho.
  const escolheuNaMao = useRef(false)
  const valorRef = useRef(valor)
  valorRef.current = valor

  // Listas do que ja esta escolhido (cadastro salvo antes).
  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const [m, mo, v] = await Promise.all([
          olxCatalogo(tenantId),
          valor.olx_marca_id ? olxCatalogo(tenantId, valor.olx_marca_id) : Promise.resolve({ itens: [] }),
          valor.olx_marca_id && valor.olx_modelo_id
            ? olxCatalogo(tenantId, valor.olx_marca_id, valor.olx_modelo_id)
            : Promise.resolve({ itens: [] }),
        ])
        if (!vivo) return
        setMarcas(m.itens)
        setModelos(mo.itens)
        setVersoes(v.itens)
      } catch (err) {
        if (vivo) setAviso(err instanceof ApiError ? err.message : 'Não consegui abrir o catálogo da OLX agora.')
      }
    })()
    return () => {
      vivo = false
    }
    // So na abertura do cadastro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, carId])

  // Preenche sozinho a partir do que a loja digitou (marca, modelo e versão).
  const chave = `${carro.brand}|${carro.model}|${carro.version}`
  useEffect(() => {
    if (escolheuNaMao.current) return
    if (!carro.brand?.trim() || !carro.model?.trim()) return
    const atual = valorRef.current
    // Cadastro que ja tem os tres codigos: nao mexe.
    if (atual.olx_marca_id && atual.olx_modelo_id && atual.olx_versao_id && !conferir && carId) return

    const timer = setTimeout(async () => {
      setBuscando(true)
      setAviso(null)
      try {
        const s = await olxSugerir(tenantId, {
          brand: carro.brand,
          model: carro.model,
          version: carro.version ?? '',
          engine: carro.engine ?? '',
          transmission: carro.transmission ?? '',
        })
        if (escolheuNaMao.current) return
        setMarcas(s.marcas)
        setModelos(s.modelos)
        setVersoes(s.versoes)
        onChange({
          ...valorRef.current,
          olx_marca_id: s.marca?.id ?? null,
          olx_marca: s.marca?.nome ?? null,
          olx_modelo_id: s.modelo?.id ?? null,
          olx_modelo: s.modelo?.nome ?? null,
          olx_versao_id: s.versao?.id ?? null,
          olx_versao: s.versao?.nome ?? null,
        })
        const duvida = [s.marca, s.modelo, s.versao].some((i) => !i || i.certeza === 'conferir')
        setConferir(duvida)
        if (!s.marca) setAviso('Não achei esta marca no catálogo da OLX. Escolha abaixo.')
        else if (!s.modelo) setAviso('Não achei este modelo no catálogo da OLX. Escolha abaixo.')
        else if (!s.versao) setAviso('Escolha a versão na lista da OLX.')
      } catch (err) {
        setAviso(err instanceof ApiError ? err.message : 'Não consegui consultar o catálogo da OLX agora.')
      } finally {
        setBuscando(false)
      }
    }, 900)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, tenantId])

  async function escolheMarca(nome: string) {
    escolheuNaMao.current = true
    const item = marcas.find((m) => m.nome === nome) ?? null
    onChange({ ...valor, olx_marca_id: item?.id ?? null, olx_marca: item?.nome ?? null, olx_modelo_id: null, olx_modelo: null, olx_versao_id: null, olx_versao: null })
    setModelos([])
    setVersoes([])
    if (item) {
      try {
        setModelos((await olxCatalogo(tenantId, item.id)).itens)
      } catch {
        setAviso('Não consegui carregar os modelos da OLX agora.')
      }
    }
  }

  async function escolheModelo(nome: string) {
    escolheuNaMao.current = true
    const item = modelos.find((m) => m.nome === nome) ?? null
    onChange({ ...valor, olx_modelo_id: item?.id ?? null, olx_modelo: item?.nome ?? null, olx_versao_id: null, olx_versao: null })
    setVersoes([])
    if (item && valor.olx_marca_id) {
      try {
        setVersoes((await olxCatalogo(tenantId, valor.olx_marca_id, item.id)).itens)
      } catch {
        setAviso('Não consegui carregar as versões da OLX agora.')
      }
    }
  }

  function escolheVersao(nome: string) {
    escolheuNaMao.current = true
    const item = versoes.find((m) => m.nome === nome) ?? null
    onChange({ ...valor, olx_versao_id: item?.id ?? null, olx_versao: item?.nome ?? null })
    setConferir(false)
  }

  async function publicarAgora() {
    if (!carId) return
    setPublicando(true)
    setResultado(null)
    try {
      const r = await olxSincronizar(tenantId, carId, true)
      setResultado(
        r.situacao === 'enviado'
          ? 'Enviado para a OLX. A OLX analisa e publica em alguns minutos.'
          : r.mensagem || 'Pronto.',
      )
    } catch (err) {
      setResultado(err instanceof Error ? err.message : 'Não consegui enviar agora.')
    } finally {
      setPublicando(false)
    }
  }

  // Lista com o item escolhido mesmo antes do catálogo carregar.
  const opcoes = (lista: OlxItem[], nome: string | null) => {
    const nomes = lista.map((i) => i.nome)
    return nome && !nomes.includes(nome) ? [nome, ...nomes] : nomes
  }

  const situacao = anuncio ? OLX_SITUACAO[anuncio.situacao] : null
  const itensResumo = resumo(carro)

  return (
    <section className="rounded-3xl border border-[#6E0AD6]/20 bg-[#6E0AD6]/[0.03] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink-900">OLX</h3>
        {situacao && carId && (
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${situacao.tom}`}>{situacao.label}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-500">
        Marca, modelo e versão como a OLX chama. O painel acha sozinho pelo que você digitou acima: só confira.
      </p>

      {anuncio?.mensagem && carId && (
        <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800">{anuncio.mensagem}</p>
      )}
      {anuncio?.url && carId && (
        <a href={anuncio.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-brand-700 hover:underline">
          Ver anúncio na OLX
        </a>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Select
          label="Marca na OLX"
          options={opcoes(marcas, valor.olx_marca)}
          placeholder={buscando ? 'Procurando…' : 'Selecione'}
          value={valor.olx_marca ?? ''}
          onChange={(e) => void escolheMarca(e.target.value)}
        />
        <Select
          label="Modelo na OLX"
          options={opcoes(modelos, valor.olx_modelo)}
          placeholder={buscando ? 'Procurando…' : 'Selecione'}
          value={valor.olx_modelo ?? ''}
          disabled={!valor.olx_marca_id}
          onChange={(e) => void escolheModelo(e.target.value)}
        />
        <Select
          label="Versão na OLX"
          options={opcoes(versoes, valor.olx_versao)}
          placeholder={buscando ? 'Procurando…' : 'Selecione'}
          value={valor.olx_versao ?? ''}
          disabled={!valor.olx_modelo_id}
          onChange={(e) => escolheVersao(e.target.value)}
        />
      </div>

      {(aviso || (conferir && !buscando)) && (
        <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800">
          {aviso ?? 'Preenchi pelo mais parecido. Confira se marca, modelo e versão estão certos.'}
        </p>
      )}

      {itensResumo.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {itensResumo.map(([nome, v]) => (
            <span key={nome} className="rounded-full bg-white px-3 py-1 text-xs text-ink-600 ring-1 ring-ink-200">
              {nome}: <strong className="text-ink-900">{v}</strong>
            </span>
          ))}
          <span className="self-center text-xs text-ink-400">vão para a OLX do mesmo jeito</span>
        </div>
      )}

      {carId && (
        <div className="mt-4">
          <Toggle
            checked={valor.olx_publicar}
            onChange={(v) => onChange({ ...valor, olx_publicar: v })}
            label={valor.olx_publicar ? 'Este carro está liberado para a OLX' : 'Este carro está fora da OLX'}
            description={
              valor.olx_publicar
                ? 'Desligue e salve para tirar o anúncio da OLX. O carro continua no painel e com a Júlia.'
                : 'Ligue e salve para voltar a anunciar na OLX.'
            }
          />
        </div>
      )}

      {carId && !conexao.publicar_tudo && valor.olx_publicar && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" size="sm" loading={publicando} onClick={() => void publicarAgora()}>
            Publicar este carro na OLX agora
          </Button>
          <span className="text-xs text-ink-500">A publicação automática está desligada em Integrações. Salve antes de publicar.</span>
        </div>
      )}
      {resultado && <p className="mt-2 text-xs text-ink-600">{resultado}</p>}
    </section>
  )
}
