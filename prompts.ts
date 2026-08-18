import { supabase } from './supabase'
import type { AgentType, Store } from './types'

const AGENT_TYPES: AgentType[] = ['descoberta', 'encantamento', 'fechamento']

/**
 * Prompts sugeridos para as três fases do agente, montados a partir das regras
 * que o lojista marcou na etapa 1. São só um ponto de partida: o texto salvo em
 * `tenant_agents.system_prompt` é o que o fluxo do N8N lê.
 */
export function defaultPrompts(store: Partial<Store> & { name?: string }): Record<AgentType, string> {
  const nome = store.name?.trim() || 'loja'

  const banks = store.partner_banks?.length ? store.partner_banks.join(', ') : 'os bancos parceiros da loja'

  const laudo =
    store.inspection_type === 'completo'
      ? 'todos os veículos têm laudo cautelar completo aprovado'
      : store.inspection_type === 'pesquisa'
        ? 'todos os veículos passam por pesquisa veicular'
        : null

  const regras = [
    store.accepts_trade ? 'aceitamos o carro do cliente como parte do pagamento' : 'não trabalhamos com troca',
    store.offers_consignment ? 'aceitamos veículos em consignação' : null,
    store.works_with_auction ? 'trabalhamos também com veículos de leilão, sempre informado ao cliente' : null,
    store.offers_test_drive ? 'o cliente pode fazer test-drive' : null,
    store.offers_delivery ? 'entregamos o veículo na casa do cliente' : null,
    store.warranty_months ? `garantia de ${store.warranty_months} meses${store.warranty_details ? ` (${store.warranty_details.trim()})` : ''}` : null,
    laudo,
  ]
    .filter(Boolean)
    .join('; ')

  const endereco = [store.address_street, store.address_number, store.address_district, store.address_city]
    .filter(Boolean)
    .join(', ')

  return {
    descoberta: `Você é o consultor virtual da ${nome}. Nesta fase seu objetivo é entender o cliente, não vender.
Cumprimente pelo nome, seja cordial e objetivo, escreva como um brasileiro no WhatsApp (frases curtas, sem excesso de emoji).
Descubra: qual veículo despertou interesse, para que vai usar o carro, se tem carro na troca, se pretende financiar ou pagar à vista e qual o valor de entrada.
Faça uma pergunta por vez e confirme o que entendeu antes de seguir.`,

    encantamento: `Fase de encantamento da ${nome}. Use SEMPRE a ficha técnica real vinda do estoque (nunca invente dados, opcionais ou preço).
Apresente o veículo destacando quilometragem, ano, câmbio, combustível e os itens que conversem com o que o cliente contou.
Envie as fotos do veículo na ordem cadastrada. Regras da loja: ${regras || 'consultar o vendedor'}.
Se o cliente pedir algo que não temos em estoque, ofereça a alternativa mais próxima que exista na base.`,

    fechamento: `Fase de fechamento da ${nome}. Conduza para a visita presencial ou test-drive.
Ofereça dois horários concretos e agende na agenda da loja assim que o cliente escolher; confirme data, hora e endereço${endereco ? ` (${endereco})` : ''}.
Financiamento é feito com ${banks} — colete nome completo, CPF e valor de entrada para simulação e passe ao vendedor responsável.
Nunca prometa desconto, aprovação de crédito ou condição que não tenha sido autorizada pela loja: nesses casos, transfira para um vendedor humano.`,
  }
}

/**
 * Monta os prompts das três fases a partir do template-base gravado em
 * `prompt_templates` somado ao que o lojista preencheu no painel.
 *
 * A essência da Júlia mora no template e o painel nunca a reescreve: os dados
 * do painel só preenchem `{{LOJA}}`, `{{ENDERECO_SUFIXO}}` e o bloco
 * `{{DADOS_DA_LOJA}}`. Campo em branco não apaga nada — a linha correspondente
 * simplesmente não entra no bloco.
 *
 * Se o template ainda não existir no banco, cai no texto curto de
 * `defaultPrompts`, que é só um ponto de partida.
 */
export async function buildPrompts(
  tenantId: string,
  store: Partial<Store> & { name?: string },
): Promise<Record<AgentType, string>> {
  const out = defaultPrompts(store)

  await Promise.all(
    AGENT_TYPES.map(async (type) => {
      const { data, error } = await supabase.rpc('render_agent_prompt', {
        p_tenant: tenantId,
        p_agent_type: type,
      })
      if (!error && typeof data === 'string' && data.trim()) out[type] = data
    }),
  )

  return out
}
