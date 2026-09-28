// Botao "Gerar ficha tecnica com IA".
//
// Feito para nao depender de nada do formulario: ele recebe marca, modelo,
// ano do modelo e versao, e devolve os campos prontos pelo onPreencher. Quem
// decide o que fazer com eles e o formulario.
//
// Nao preenche quilometragem, cor nem preco de proposito. Esses tres sao
// daquele carro especifico, nao do modelo -- se a IA chutar, o chute vira
// dado do estoque e a Julia repete para o cliente como se fosse verdade.

import { useState } from 'react'
import { gerarFichaTecnica } from '../../core/api'
import { useTenant } from '../../core/tenant'

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
  carplay_android_auto?: string
  trunk_liters?: number
  leather_seats?: string
  keyless_entry?: string
  parking_sensor?: string
  rear_camera?: string
}

// Nome de cada campo como aparece no formulario, para dizer o que ficou em branco.
const NOME_DO_CAMPO: Record<string, string> = {
  transmission: 'câmbio', fuel: 'combustível', body_type: 'carroceria', doors: 'portas', engine: 'motor',
  cylinders: 'cilindros', horsepower: 'potência', torque: 'torque', acceleration_0_100: '0 a 100',
  aspiration: 'aspiração', traction: 'tração', air_conditioning: 'ar-condicionado', steering: 'direção',
  electric_windows: 'vidros elétricos', sunroof: 'teto solar', carplay_android_auto: 'CarPlay/Android Auto',
  trunk_liters: 'porta-malas', leather_seats: 'banco de couro', keyless_entry: 'chave presencial',
  parking_sensor: 'sensor de estacionamento', rear_camera: 'câmera de ré',
}

type Props = {
  brand?: string
  model?: string
  modelYear?: number | string
  version?: string
  onPreencher: (ficha: FichaIA) => void
}

export function BotaoFichaIA({ brand, model, modelYear, version, onPreencher }: Props) {
  const { store } = useTenant()
  const tenantId = store?.tenant_id ?? null

  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const podeGerar = Boolean(brand && model && tenantId) && !carregando

  async function gerar() {
    if (!brand || !model || !tenantId) return
    setErro(null)
    setAviso(null)
    setCarregando(true)
    try {
      const dados = await gerarFichaTecnica({ tenant_id: tenantId, brand, model, model_year: modelYear, version })

      onPreencher((dados.ficha || {}) as FichaIA)

      const faltaram = (dados.faltaram ?? []).map((campo) => NOME_DO_CAMPO[campo] ?? campo)
      setAviso(
        faltaram.length > 0
          ? `${dados.preenchidos} de ${dados.total} campos preenchidos. Ficou em branco: ${faltaram.join(', ')}. Confira antes de salvar.`
          : `Todos os ${dados.preenchidos} campos preenchidos. Confira antes de salvar.`,
      )
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui gerar agora.')
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
        {carregando ? 'Gerando ficha...' : 'Gerar ficha técnica com IA'}
      </button>

      {!brand || !model ? (
        <p className="mt-2 text-xs text-ink-500">Preencha marca e modelo (e, de preferência, versão e ano do modelo) para liberar o botão.</p>
      ) : null}

      {aviso ? <p className="mt-2 text-xs text-ink-600">{aviso}</p> : null}
      {erro ? <p className="mt-2 text-xs text-red-600">{erro}</p> : null}

      <p className="mt-2 text-xs text-ink-500">
        A IA preenche a ficha técnica e os opcionais da versão. Ano, cor, quilometragem e preço continuam com você.
      </p>
    </div>
  )
}
