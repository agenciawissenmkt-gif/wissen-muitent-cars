// Botao "Gerar ficha tecnica com IA".
//
// Feito para nao depender de nada do formulario: ele recebe marca, modelo,
// ano e versao, e devolve os campos prontos pelo onPreencher. Quem decide o
// que fazer com eles e o formulario.
//
// Nao preenche quilometragem, cor nem preco de proposito. Esses tres sao
// daquele carro especifico, nao do modelo -- se a IA chutar, o chute vira
// dado do estoque e a Julia repete para o cliente como se fosse verdade.

import { useState } from 'react'

export type FichaIA = {
  transmission?: string
  fuel?: string
  body_type?: string
  doors?: number
  engine?: string
  cylinders?: string
  horsepower?: string
  torque?: string
  acceleration_0_100?: string
  aspiration?: string
  traction?: string
  air_conditioning?: string
  steering?: string
  electric_windows?: string
  sunroof?: string
}

type Props = {
  brand?: string
  model?: string
  year?: number | string
  version?: string
  onPreencher: (ficha: FichaIA) => void
}

export function BotaoFichaIA({ brand, model, year, version, onPreencher }: Props) {
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const podeGerar = Boolean(brand && model) && !carregando

  async function gerar() {
    setErro(null)
    setAviso(null)
    setCarregando(true)
    try {
      const r = await fetch('/api/ficha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, model, year, version }),
      })
      const dados = await r.json()

      if (!r.ok) {
        setErro(dados?.error || 'nao consegui gerar agora')
        return
      }

      onPreencher(dados.ficha || {})

      const faltaram = (dados.total ?? 0) - (dados.preenchidos ?? 0)
      setAviso(
        faltaram > 0
          ? `${dados.preenchidos} campos preenchidos. ${faltaram} a IA nao soube e deixou em branco.`
          : `${dados.preenchidos} campos preenchidos. Confira antes de salvar.`,
      )
    } catch (e) {
      setErro('nao consegui falar com o servidor')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={gerar}
        disabled={!podeGerar}
        className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {carregando ? 'Gerando...' : 'Gerar ficha tecnica com IA'}
      </button>

      {!brand || !model ? (
        <p className="mt-2 text-xs text-ink-500">Preencha marca e modelo para liberar o botao.</p>
      ) : null}

      {aviso ? <p className="mt-2 text-xs text-ink-600">{aviso}</p> : null}
      {erro ? <p className="mt-2 text-xs text-red-600">{erro}</p> : null}

      <p className="mt-2 text-xs text-ink-500">
        A IA preenche so o que e do modelo. Quilometragem, cor e preco continuam com voce.
      </p>
    </div>
  )
}
