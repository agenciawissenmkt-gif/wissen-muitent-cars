/**
 * Agenda propria por loja.
 *
 * A regra do produto e que cada loja tenha o seu proprio Google Agenda, para as
 * visitas de um cliente nao aparecerem misturadas com as de outro. Ate aqui o
 * passo do Google so guardava `profile.email` -- ou seja, apontava a loja para a
 * agenda PRINCIPAL da conta conectada. Quem quisesse uma agenda separada
 * precisava criar na mao no Google e depois trocar o `google_calendar_id` no
 * banco, tambem na mao. Em 13/09/2026 a conta de producao tinha duas
 * "JC CAR VEICULOS" e duas "w Multimarcas": o mesmo trabalho manual feito duas
 * vezes.
 *
 * Daqui em diante o proprio painel resolve, e a ordem importa: primeiro procura
 * uma agenda que a conta ja tenha com o nome da loja e REAPROVEITA; so cria
 * quando nao existe nenhuma. E esse reaproveitamento que impede a duplicata
 * quando o lojista refaz a etapa 5 -- reconectar duas vezes nao pode render
 * duas agendas.
 *
 * Nada aqui pode derrubar a conexao: se a API do Google falhar, devolvemos null
 * e quem chamou segue com a agenda principal, como era antes. Perder a agenda
 * separada e chato; travar a implantacao da loja e pior.
 */

const API = 'https://www.googleapis.com/calendar/v3'

function normaliza(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

async function googleApi(caminho, accessToken, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}/${caminho}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const texto = await res.text()
  let dados = null
  try {
    dados = texto ? JSON.parse(texto) : null
  } catch {
    dados = null
  }

  if (!res.ok) {
    const msg = dados?.error?.message || `Google Agenda respondeu ${res.status}`
    throw new Error(msg)
  }

  return dados
}

/**
 * Devolve o id da agenda da loja, criando-a se preciso. Devolve null quando nao
 * deu para garantir -- nesse caso o chamador decide o que usar no lugar.
 */
export async function ensureCalendarioDaLoja({ accessToken, nomeDaLoja, timezone }) {
  const nome = String(nomeDaLoja ?? '').trim()
  if (!accessToken || !nome) return null

  try {
    // A conta pode ter muitas agendas (feriados, aniversarios, as de outras
    // lojas do mesmo dono). 250 e o maximo por pagina e da folga de sobra.
    const lista = await googleApi('users/me/calendarList?maxResults=250', accessToken)

    // So reaproveitamos agenda que a conta possui: numa agenda apenas
    // compartilhada o painel nao consegue criar nem remarcar visita, e o erro
    // so apareceria mais tarde, na primeira visita marcada pela Julia.
    const existente = (lista?.items ?? []).find(
      (item) => normaliza(item?.summary) === normaliza(nome) && item?.accessRole === 'owner',
    )
    if (existente?.id) return existente.id

    const nova = await googleApi('calendars', accessToken, {
      method: 'POST',
      body: {
        summary: nome,
        description: 'Visitas e test-drives agendados pela Julia. Criada pelo painel Wissen Cars.',
        timeZone: timezone || 'America/Sao_Paulo',
      },
    })

    return nova?.id ?? null
  } catch {
    return null
  }
}
