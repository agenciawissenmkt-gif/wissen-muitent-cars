import { useEffect, useState } from 'react'
import { Button } from '../../ui/Button'

/**
 * Janela que aparece ao salvar o carro quando a loja tem plataforma de anuncio
 * conectada (OLX, Webmotors...). A loja escolhe onde o carro vai: todas, algumas
 * ou so o estoque da IA. O carro sempre fica no painel e com a Julia.
 *
 * Para entrar uma plataforma nova, basta somar um item em `plataformas`.
 */

export type PlataformaId = 'olx' | 'webmotors'

export interface Plataforma {
  id: PlataformaId
  nome: string
}

export type Destinos = Record<PlataformaId, boolean>

function Marca({ id }: { id: PlataformaId }) {
  if (id === 'olx') {
    return (
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#6E0AD6] text-xs font-black tracking-tight text-white">
        OLX
      </span>
    )
  }
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#E1251B] text-[8px] font-black leading-tight tracking-tight text-white">
      WEB
      <br />
      MOTORS
    </span>
  )
}

interface Props {
  open: boolean
  plataformas: Plataforma[]
  inicial: Destinos
  salvando: boolean
  onCancelar: () => void
  onConfirmar: (destinos: Destinos) => void
}

export function DestinosDialog({ open, plataformas, inicial, salvando, onCancelar, onConfirmar }: Props) {
  const [escolha, setEscolha] = useState<Destinos>(inicial)

  useEffect(() => {
    if (open) setEscolha(inicial)
    // So ao abrir: depois a loja mexe a vontade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const todas = plataformas.every((p) => escolha[p.id])
  const nenhuma = plataformas.every((p) => !escolha[p.id])
  const marcarTodas = (valor: boolean) =>
    setEscolha((atual) => ({ ...atual, ...Object.fromEntries(plataformas.map((p) => [p.id, valor])) }) as Destinos)

  const opcao = (ativa: boolean) =>
    `flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${
      ativa ? 'border-brand-600 bg-brand-50' : 'border-ink-200 bg-white hover:border-brand-300'
    }`
  const caixa = (ativa: boolean) =>
    `grid size-5 shrink-0 place-items-center rounded-md border text-[11px] font-bold ${
      ativa ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 bg-white text-transparent'
    }`

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink-900/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl sm:p-6">
        <h2 className="text-lg font-bold text-ink-900">Onde anunciar este carro?</h2>
        <p className="mt-1 text-sm text-ink-500">
          O carro sempre fica no estoque do painel e com a Júlia. Escolha em quais sites ele também vai aparecer.
        </p>

        <div className="mt-5 space-y-2">
          <button type="button" className={opcao(todas)} onClick={() => marcarTodas(!todas)}>
            <span className={caixa(todas)}>✓</span>
            <span className="text-sm font-semibold text-ink-900">Todas as plataformas</span>
          </button>

          {plataformas.map((p) => (
            <button
              key={p.id}
              type="button"
              className={opcao(escolha[p.id])}
              onClick={() => setEscolha((atual) => ({ ...atual, [p.id]: !atual[p.id] }))}
            >
              <span className={caixa(escolha[p.id])}>✓</span>
              <Marca id={p.id} />
              <span className="text-sm font-semibold text-ink-900">{p.nome}</span>
            </button>
          ))}

          <button type="button" className={opcao(nenhuma)} onClick={() => marcarTodas(false)}>
            <span className={caixa(nenhuma)}>✓</span>
            <span className="text-sm font-semibold text-ink-900">Somente o estoque da IA</span>
          </button>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancelar} disabled={salvando}>
            Voltar
          </Button>
          <Button type="button" loading={salvando} onClick={() => onConfirmar(escolha)}>
            Salvar
          </Button>
        </div>
      </div>
    </div>
  )
}
