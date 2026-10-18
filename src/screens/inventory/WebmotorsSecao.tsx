import { useEffect, useRef, useState } from 'react'
import { Button } from '../../ui/Button'
import { CheckPill, Select, Toggle } from '../../ui/Field'
import { ApiError, webmotorsCatalogo, webmotorsSincronizar, webmotorsSugerir, type WebmotorsItem } from '../../core/api'
import { WEBMOTORS_SITUACAO, type WebmotorsAnuncio, type WebmotorsConexao } from '../../core/webmotors'

/**
 * Parte do cadastro do carro que so aparece quando a loja conectou a Webmotors
 * (Integracoes). Mesmo jeito da OLX: a loja digita marca/modelo/versao
 * normalmente, o painel acha os mesmos no catalogo da Webmotors e a loja so
 * confere. Cor, cambio, combustivel e opcionais vao sozinhos.
 */

export interface WebmotorsCampos {
  wm_marca_cod: number | null
  wm_marca: string | null
  wm_modelo_cod: number | null
  wm_modelo: string | null
  wm_versao_cod: number | null
  wm_versao: string | null
  wm_publicar: boolean
  wm_garantia_fabrica: boolean
  wm_adaptado_pcd: boolean
}

export const WEBMOTORS_VAZIO: WebmotorsCampos = {
  wm_marca_cod: null,
  wm_marca: null,
  wm_modelo_cod: null,
  wm_modelo: null,
  wm_versao_cod: null,
  wm_versao: null,
  wm_publicar: true,
  wm_garantia_fabrica: false,
  wm_adaptado_pcd: false,
}

interface Props {
  tenantId: string
  carId: string | null
  conexao: WebmotorsConexao
  anuncio: WebmotorsAnuncio | null
  /** O que a loja digitou no cadastro (marca, modelo, versão, ano, motor, câmbio...). */
  carro: Record<string, string>
  valor: WebmotorsCampos
  onChange: (valor: WebmotorsCampos) => void
}

export function WebmotorsSecao({ tenantId, carId, conexao, anuncio, carro, valor, onChange }: Props) {
  const [marcas, setMarcas] = useState<WebmotorsItem[]>([])
  const [modelos, setModelos] = useState<WebmotorsItem[]>([])
  const [versoes, setVersoes] = useState<WebmotorsItem[]>([])
  const [buscando, setBuscando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [conferir, setConferir] = useState(false)
  const [publicando, setPublicando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)
  // Depois que a loja escolhe na mão, o painel para de sugerir sozinho.
  const escolheuNaMao = useRef(false)
  const valorRef = useRef(valor)
  valorRef.current = valor
  const ano = carro.model_year?.trim() || null

  // Listas do que ja esta escolhido (cadastro salvo antes).
  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const [m, mo, v] = await Promise.all([
          webmotorsCatalogo(tenantId),
          valor.wm_marca_cod ? webmotorsCatalogo(tenantId, valor.wm_marca_cod) : Promise.resolve({ itens: [] }),
          valor.wm_marca_cod && valor.wm_modelo_cod
            ? webmotorsCatalogo(tenantId, valor.wm_marca_cod, valor.wm_modelo_cod, ano)
            : Promise.resolve({ itens: [] }),
        ])
        if (!vivo) return
        setMarcas(m.itens)
        setModelos(mo.itens)
        setVersoes(v.itens)
      } catch (err) {
        if (vivo) setAviso(err instanceof ApiError ? err.message : 'Não consegui abrir o catálogo da Webmotors agora.')
      }
    })()
    return () => {
      vivo = false
    }
    // So na abertura do cadastro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, carId])

  // Preenche sozinho a partir do que a loja digitou (marca, modelo, versão e ano).
  const chave = `${carro.brand}|${carro.model}|${carro.version}|${carro.model_year}`
  useEffect(() => {
    if (escolheuNaMao.current) return
    if (!carro.brand?.trim() || !carro.model?.trim()) return
    const atual = valorRef.current
    // Cadastro que ja tem os tres codigos: nao mexe.
    if (atual.wm_marca_cod && atual.wm_modelo_cod && atual.wm_versao_cod && !conferir && carId) return

    const timer = setTimeout(async () => {
      setBuscando(true)
      setAviso(null)
      try {
        const s = await webmotorsSugerir(tenantId, {
          brand: carro.brand,
          model: carro.model,
          version: carro.version ?? '',
          engine: carro.engine ?? '',
          transmission: carro.transmission ?? '',
          model_year: carro.model_year ?? '',
        })
        if (escolheuNaMao.current) return
        setMarcas(s.marcas)
        setModelos(s.modelos)
        setVersoes(s.versoes)
        onChange({
          ...valorRef.current,
          wm_marca_cod: s.marca?.id ?? null,
          wm_marca: s.marca?.nome ?? null,
          wm_modelo_cod: s.modelo?.id ?? null,
          wm_modelo: s.modelo?.nome ?? null,
          wm_versao_cod: s.versao?.id ?? null,
          wm_versao: s.versao?.nome ?? null,
        })
        const duvida = [s.marca, s.modelo, s.versao].some((i) => !i || i.certeza === 'conferir')
        setConferir(duvida)
        if (!s.marca) setAviso('Não achei esta marca no catálogo da Webmotors. Escolha abaixo.')
        else if (!s.modelo) setAviso('Não achei este modelo no catálogo da Webmotors. Escolha abaixo.')
        else if (!s.versao) setAviso('Escolha a versão na lista da Webmotors.')
      } catch (err) {
        setAviso(err instanceof ApiError ? err.message : 'Não consegui consultar o catálogo da Webmotors agora.')
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
    onChange({
      ...valor,
      wm_marca_cod: item?.id ?? null,
      wm_marca: item?.nome ?? null,
      wm_modelo_cod: null,
      wm_modelo: null,
      wm_versao_cod: null,
      wm_versao: null,
    })
    setModelos([])
    setVersoes([])
    if (item) {
      try {
        setModelos((await webmotorsCatalogo(tenantId, item.id)).itens)
      } catch {
        setAviso('Não consegui carregar os modelos da Webmotors agora.')
      }
    }
  }

  async function escolheModelo(nome: string) {
    escolheuNaMao.current = true
    const item = modelos.find((m) => m.nome === nome) ?? null
    onChange({ ...valor, wm_modelo_cod: item?.id ?? null, wm_modelo: item?.nome ?? null, wm_versao_cod: null, wm_versao: null })
    setVersoes([])
    if (item && valor.wm_marca_cod) {
      try {
        setVersoes((await webmotorsCatalogo(tenantId, valor.wm_marca_cod, item.id, ano)).itens)
      } catch {
        setAviso('Não consegui carregar as versões da Webmotors agora.')
      }
    }
  }

  function escolheVersao(nome: string) {
    escolheuNaMao.current = true
    const item = versoes.find((m) => m.nome === nome) ?? null
    onChange({ ...valor, wm_versao_cod: item?.id ?? null, wm_versao: item?.nome ?? null })
    setConferir(false)
  }

  async function publicarAgora() {
    if (!carId) return
    setPublicando(true)
    setResultado(null)
    try {
      const r = await webmotorsSincronizar(tenantId, carId, true)
      setResultado(
        r.situacao === 'publicado'
          ? 'Publicado na Webmotors.'
          : r.situacao === 'enviando_fotos'
            ? 'Anúncio criado. As fotos continuam sendo enviadas.'
            : r.mensagem || 'Pronto.',
      )
    } catch (err) {
      setResultado(err instanceof Error ? err.message : 'Não consegui enviar agora.')
    } finally {
      setPublicando(false)
    }
  }

  // Lista com o item escolhido mesmo antes do catálogo carregar.
  const opcoes = (lista: WebmotorsItem[], nome: string | null) => {
    const nomes = lista.map((i) => i.nome)
    return nome && !nomes.includes(nome) ? [nome, ...nomes] : nomes
  }

  const situacao = anuncio ? WEBMOTORS_SITUACAO[anuncio.situacao] : null

  return (
    <section className="rounded-3xl border border-[#E1251B]/20 bg-[#E1251B]/[0.03] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink-900">Webmotors</h3>
        {situacao && carId && (
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${situacao.tom}`}>{situacao.label}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-500">
        Marca, modelo e versão como a Webmotors chama. O painel acha sozinho pelo que você digitou acima: só confira.
      </p>

      {anuncio?.mensagem && carId && (
        <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800">{anuncio.mensagem}</p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Select
          label="Marca na Webmotors"
          options={opcoes(marcas, valor.wm_marca)}
          placeholder={buscando ? 'Procurando…' : 'Selecione'}
          value={valor.wm_marca ?? ''}
          onChange={(e) => void escolheMarca(e.target.value)}
        />
        <Select
          label="Modelo na Webmotors"
          options={opcoes(modelos, valor.wm_modelo)}
          placeholder={buscando ? 'Procurando…' : 'Selecione'}
          value={valor.wm_modelo ?? ''}
          disabled={!valor.wm_marca_cod}
          onChange={(e) => void escolheModelo(e.target.value)}
        />
        <Select
          label="Versão na Webmotors"
          options={opcoes(versoes, valor.wm_versao)}
          placeholder={buscando ? 'Procurando…' : 'Selecione'}
          value={valor.wm_versao ?? ''}
          disabled={!valor.wm_modelo_cod}
          onChange={(e) => escolheVersao(e.target.value)}
        />
      </div>

      {(aviso || (conferir && !buscando)) && (
        <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800">
          {aviso ?? 'Preenchi pelo mais parecido. Confira se marca, modelo e versão estão certos.'}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <CheckPill checked={valor.wm_garantia_fabrica} onChange={(v) => onChange({ ...valor, wm_garantia_fabrica: v })}>
          Garantia de fábrica
        </CheckPill>
        <CheckPill checked={valor.wm_adaptado_pcd} onChange={(v) => onChange({ ...valor, wm_adaptado_pcd: v })}>
          Adaptado para PcD
        </CheckPill>
      </div>
      <p className="mt-2 text-xs text-ink-400">
        Cor, câmbio, combustível, opcionais e o restante do cadastro vão para a Webmotors do mesmo jeito. As fotos vão como
        arquivo, até 500 KB cada (limite da Webmotors).
      </p>

      {carId && (
        <div className="mt-4">
          <Toggle
            checked={valor.wm_publicar}
            onChange={(v) => onChange({ ...valor, wm_publicar: v })}
            label={valor.wm_publicar ? 'Este carro está liberado para a Webmotors' : 'Este carro está fora da Webmotors'}
            description={
              valor.wm_publicar
                ? 'Desligue e salve para tirar o anúncio da Webmotors. O carro continua no painel e com a Júlia.'
                : 'Ligue e salve para voltar a anunciar na Webmotors.'
            }
          />
        </div>
      )}

      {carId && !conexao.publicar_tudo && valor.wm_publicar && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" size="sm" loading={publicando} onClick={() => void publicarAgora()}>
            Publicar este carro na Webmotors agora
          </Button>
          <span className="text-xs text-ink-500">A publicação automática está desligada em Integrações. Salve antes de publicar.</span>
        </div>
      )}
      {resultado && <p className="mt-2 text-xs text-ink-600">{resultado}</p>}
    </section>
  )
}
