import crypto from 'node:crypto'
import { db, HttpError } from './db.js'

/**
 * Integracao do estoque com a OLX (Autoupload).
 *
 * Tudo aqui so roda quando a loja conectou a OLX no painel (tabela
 * olx_conexoes). Sem conexao, nenhuma funcao fala com a OLX -- o cadastro do
 * carro e a Julia seguem exatamente como antes.
 *
 * Documentacao: https://developers.olx.com.br/anuncio/api/home.html
 */

export const OLX_AUTH_URL = 'https://auth.olx.com.br/oauth'
export const OLX_TOKEN_URL = 'https://auth.olx.com.br/oauth/token'
const OLX_APPS = 'https://apps.olx.com.br'

export function olxConfig() {
  const clientId = process.env.OLX_CLIENT_ID
  const clientSecret = process.env.OLX_CLIENT_SECRET
  const appUrl = process.env.APP_URL || 'http://localhost:5173'
  const redirectUri = process.env.OLX_REDIRECT_URI || `${appUrl}/api/olx/callback`

  if (!clientId || !clientSecret) {
    // Variaveis que faltam: OLX_CLIENT_ID, OLX_CLIENT_SECRET e OLX_REDIRECT_URI.
    throw new HttpError(501, 'A conexão com a OLX está sendo liberada. Em breve você poderá conectar por aqui.')
  }
  return { clientId, clientSecret, redirectUri, appUrl }
}

export function olxConfigurada() {
  return Boolean(process.env.OLX_CLIENT_ID && process.env.OLX_CLIENT_SECRET)
}

async function olxPost(path, body, method = 'POST') {
  const res = await fetch(`${OLX_APPS}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text.slice(0, 300) }
  }
  if (!res.ok && !data) throw new HttpError(502, `A OLX respondeu com erro (${res.status}).`)
  return { status: res.status, data: data ?? {} }
}

/** Conexao da loja (com a chave). Null quando a loja nao conectou. */
export async function conexaoDaLoja(tenantId) {
  return db.selectOne('olx_conexoes', `tenant_id=eq.${tenantId}&select=*`)
}

export async function dadosDaConta(accessToken) {
  try {
    const { data } = await olxPost('/oauth_api/basic_user_info', { access_token: accessToken })
    return { nome: data?.user_name ?? data?.name ?? null, email: data?.user_email ?? data?.email ?? null }
  } catch {
    return { nome: null, email: null }
  }
}

// --- Catalogo (marca, modelo e versao por codigo) ------------------------------

/** Lista do catalogo: [{ id, nome }]. marca/modelo sao codigos da OLX. */
export async function catalogo(accessToken, marca, modelo) {
  const path = ['/autoupload/car_info', marca, modelo].filter((p) => p !== undefined && p !== null && p !== '').join('/')
  const { data } = await olxPost(path, { access_token: accessToken })
  if (data?.status && data.status !== 'ok') {
    throw new HttpError(502, 'A OLX não devolveu o catálogo agora. Tente de novo em instantes.')
  }
  const lista = data?.data && typeof data.data === 'object' ? data.data : {}
  return Object.entries(lista)
    .map(([nome, id]) => ({ id: Number(id), nome: String(nome) }))
    .filter((item) => Number.isFinite(item.id))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

export const normaliza = (texto) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim()

const tokens = (texto) => normaliza(texto).split(' ').filter(Boolean)

/** Melhor item da lista para o texto que a loja digitou. Null se nada parecido. */
function melhor(lista, texto, extra = '') {
  const alvo = normaliza(texto)
  if (!alvo || !lista.length) return null

  const exato = lista.find((item) => normaliza(item.nome) === alvo)
  if (exato) return { ...exato, certeza: 'alta' }

  const palavrasAlvo = new Set([...tokens(texto), ...tokens(extra)])
  let vencedor = null
  let nota = 0
  for (const item of lista) {
    const nomeN = normaliza(item.nome)
    const palavras = tokens(item.nome)
    if (!palavras.length) continue
    const comuns = palavras.filter((p) => palavrasAlvo.has(p)).length
    let pontos = comuns / palavras.length + comuns * 0.05
    // "Corolla" dentro de "corolla cross xre": o nome inteiro aparece no texto da loja.
    if (` ${alvo} `.includes(` ${nomeN} `)) pontos += 0.5 + nomeN.length / 100
    if (pontos > nota) {
      nota = pontos
      vencedor = item
    }
  }
  if (!vencedor || nota < 0.34) return null
  return { ...vencedor, certeza: nota >= 0.9 ? 'alta' : 'conferir' }
}

/**
 * Sugere marca, modelo e versao da OLX a partir do que a loja digitou.
 * Devolve tambem as listas, para a loja trocar se a sugestao nao for a certa.
 */
export async function sugerirCatalogo(accessToken, { brand, model, version, engine, transmission }) {
  const marcas = await catalogo(accessToken)
  const marca = melhor(marcas, brand)
  if (!marca) return { marca: null, modelo: null, versao: null, marcas, modelos: [], versoes: [] }

  const modelos = await catalogo(accessToken, marca.id)
  const modelo = melhor(modelos, `${model ?? ''}`, `${version ?? ''}`)
  if (!modelo) return { marca, modelo: null, versao: null, marcas, modelos, versoes: [] }

  const versoes = await catalogo(accessToken, marca.id, modelo.id)
  const versao = melhor(versoes, `${version ?? ''}`, `${engine ?? ''} ${transmission ?? ''}`)
  return { marca, modelo, versao, marcas, modelos, versoes }
}

// --- Do cadastro do carro para o anuncio da OLX ---------------------------------

const so = (valor) => normaliza(valor)

function cambio(transmission) {
  const t = so(transmission)
  if (!t) return undefined
  if (t.startsWith('manual')) return '1'
  if (t.startsWith('semi')) return '3'
  if (t.startsWith('automatizado')) return '4'
  if (t.startsWith('automatico') || t === 'cvt') return '2'
  return undefined
}

function combustivel(fuel) {
  const f = so(fuel)
  if (!f) return undefined
  if (f.startsWith('gasolina')) return '1'
  if (f.startsWith('etanol') || f.startsWith('alcool')) return '2'
  if (f.startsWith('flex')) return '3'
  if (f.startsWith('diesel')) return '5'
  if (f.startsWith('hibrido')) return '6'
  if (f.startsWith('eletrico')) return '7'
  return undefined
}

function portas(doors) {
  const d = Number(doors)
  if (d === 2) return '1'
  if (d === 3) return '3'
  if (d === 4 || d === 5) return '2'
  return undefined
}

function cor(color) {
  const c = so(color)
  if (!c) return undefined
  const tabela = [
    ['pret', '1'],
    ['branc', '2'],
    ['prat', '3'],
    ['vermelh', '4'],
    ['cinz', '5'],
    ['grafit', '5'],
    ['azul', '6'],
    ['amarel', '7'],
    ['verde', '8'],
    ['laranj', '9'],
  ]
  return tabela.find(([inicio]) => c.startsWith(inicio))?.[1] ?? '10'
}

function carroceria(bodyType) {
  const b = so(bodyType)
  if (!b) return undefined
  const tabela = {
    conversivel: '2',
    picape: '3',
    'pick up': '3',
    suv: '5',
    minivan: '7',
    utilitario: '7',
    van: '7',
    seda: '8',
    sedan: '8',
    hatch: '9',
    coupe: '11',
    perua: '12',
  }
  return tabela[b]
}

function direcao(steering) {
  const s = so(steering)
  if (!s) return undefined
  if (s.startsWith('eletro')) return '5'
  if (s.startsWith('hidraul')) return '1'
  if (s.startsWith('eletric')) return '2'
  if (s.startsWith('mecanic')) return '3'
  if (s.startsWith('assist')) return '4'
  return undefined
}

const temItem = (valor) => {
  const v = so(valor)
  return Boolean(v) && !v.startsWith('nao') && v !== 'sem'
}

function opcionais(car) {
  const lista = []
  if (temItem(car.air_conditioning)) lista.push('1')
  if (temItem(car.electric_windows)) lista.push('3')
  if (temItem(car.carplay_android_auto)) lista.push('7')
  if (temItem(car.parking_sensor)) lista.push('8')
  if (temItem(car.rear_camera)) lista.push('9')
  if (car.blindado) lista.push('10')
  if (temItem(car.leather_seats)) lista.push('11')
  if (temItem(car.sunroof)) lista.push('19')
  if (['4x4', 'awd'].includes(so(car.traction))) lista.push('20')
  return lista
}

/** Id do anuncio na OLX: curto, fixo por carro (a OLX aceita ate 19 caracteres). */
export function idDoAnuncio(carId) {
  return String(carId).replace(/-/g, '').slice(0, 19)
}

export const soDigitos = (valor) => String(valor ?? '').replace(/\D/g, '')

/** Placa no formato que a OLX valida: ABC1234 ou ABC1D23. */
export function placaValida(placa) {
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(String(placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
}

/**
 * Monta o anuncio da OLX. Quando falta algo obrigatorio, devolve a lista do que
 * falta em vez do anuncio -- o painel mostra para a loja completar.
 */
export function montarAnuncio({ car, fotos, store, conexao }) {
  const faltando = []
  const zeroKm = Number(car.mileage_km) === 0
  const placa = String(car.placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const telefone = soDigitos(conexao?.telefone_anuncio).replace(/^55(?=\d{10,11}$)/, '')
  const cep = soDigitos(store?.address_zip)
  const ano = Number(car.model_year || car.year)
  const preco = Math.round(Number(car.price_brl))
  const imagens = (fotos ?? []).map((f) => f.url).filter(Boolean).slice(0, 20)

  if (!car.olx_marca_id || !car.olx_modelo_id || !car.olx_versao_id) faltando.push('marca, modelo e versão da OLX')
  if (!zeroKm && !placaValida(placa)) faltando.push('placa')
  if (!ano) faltando.push('ano do modelo')
  if (car.mileage_km === null || car.mileage_km === undefined) faltando.push('quilometragem')
  if (!preco || preco <= 0) faltando.push('preço')
  if (!imagens.length) faltando.push('fotos')
  if (cep.length !== 8) faltando.push('CEP da loja (cadastro da loja)')
  if (telefone.length < 10 || telefone.length > 11) faltando.push('telefone do anúncio (Integrações)')

  if (faltando.length) return { faltando }

  const titulo = [car.brand, car.model, car.version, ano].filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 90)
  const descricao =
    String(car.description ?? '').trim() ||
    [titulo, car.engine, car.transmission, car.fuel, car.color].filter(Boolean).join(' - ')

  const financeiro = []
  if (car.ipva_paid) financeiro.push('2')
  if (car.com_multas) financeiro.push('3')
  if (car.de_leilao) financeiro.push('4')

  const params = {
    regdate: String(ano),
    mileage: String(Math.max(0, Math.round(Number(car.mileage_km)))),
    vehicle_brand: String(car.olx_marca_id),
    vehicle_model: String(car.olx_modelo_id),
    vehicle_version: String(car.olx_versao_id),
    ...(placa ? { vehicle_tag: placa } : {}),
    gearbox: cambio(car.transmission),
    fuel: combustivel(car.fuel),
    doors: portas(car.doors),
    carcolor: cor(car.color),
    cartype: carroceria(car.body_type),
    car_steering: direcao(car.steering),
    car_features: opcionais(car),
    exchange: car.accepts_trade ? '1' : '2',
    financial: financeiro,
    financial_status:
      car.situacao_financeira === 'quitado' ? '1' : car.situacao_financeira === 'financiado' ? '2' : undefined,
    owner: car.single_owner ? '1' : undefined,
    owner_manual: car.manual_proprietario ? '1' : undefined,
    extra_key: car.chave_reserva ? '1' : undefined,
    dealership_review: car.dealer_revisions ? '1' : undefined,
    zero_km: zeroKm ? '1' : undefined,
  }

  // A OLX recusa opcional vazio: so vai o que tem valor.
  for (const [chave, valor] of Object.entries(params)) {
    if (valor === undefined || valor === null || valor === '' || (Array.isArray(valor) && !valor.length)) delete params[chave]
  }

  const anuncio = {
    id: idDoAnuncio(car.id),
    operation: 'insert',
    category: 2020,
    subject: titulo,
    body: descricao.slice(0, 6000),
    phone: Number(telefone),
    type: 's',
    price: preco,
    zipcode: cep,
    images: imagens,
    params,
  }
  return { anuncio }
}

export function hashDoAnuncio(anuncio) {
  return crypto.createHash('sha256').update(JSON.stringify(anuncio)).digest('hex').slice(0, 32)
}

// --- Envio e acompanhamento ----------------------------------------------------

/** Mensagem que a loja entende para cada retorno do envio. */
function explicaRetorno(data) {
  const codigo = Number(data?.statusCode)
  if (codigo === -6) return 'A conta da OLX não tem permissão para publicar por integração (precisa do plano profissional da OLX).'
  if (codigo === -1 || codigo === -2 || codigo === -3) return 'A OLX não aceitou a conexão. Conecte a conta de novo em Integrações.'
  const erros = Array.isArray(data?.errors) ? data.errors : []
  const textos = erros
    .flatMap((erro) => [erro?.message, ...(Array.isArray(erro?.messages) ? erro.messages.map((m) => m?.message ?? m) : [])])
    .filter(Boolean)
    .map(String)
  return textos.length ? textos.join(' | ').slice(0, 900) : data?.statusMessage || 'A OLX recusou o envio.'
}

/** Envia ate 50 anuncios por vez. Devolve { ok, token, mensagem }. */
export async function enviarParaOlx(accessToken, anuncios) {
  const { data } = await olxPost('/autoupload/import', { access_token: accessToken, ad_list: anuncios }, 'PUT')
  const ok = Number(data?.statusCode) === 0
  return { ok, token: data?.token ?? null, mensagem: ok ? null : explicaRetorno(data), codigo: data?.statusCode }
}

const SITUACAO_OLX = {
  pending: 'em_analise',
  queued: 'em_analise',
  accepted: 'publicado',
  refused: 'recusado',
  error: 'erro',
}

/** Situacao de um envio: { [olx_id]: { situacao, mensagem, list_id, url } }. */
export async function situacaoDoEnvio(accessToken, token) {
  const { data } = await olxPost(`/autoupload/import/${encodeURIComponent(token)}`, { access_token: accessToken })
  const bruto = data?.ads ?? data?.ad_list ?? {}
  const lista = Array.isArray(bruto) ? bruto : Object.entries(bruto).map(([id, info]) => ({ id, ...(info ?? {}) }))
  const saida = {}
  for (const item of lista) {
    if (!item?.id) continue
    const mensagens = Array.isArray(item.messages ?? item.message)
      ? (item.messages ?? item.message).map((m) => m?.message ?? m).filter(Boolean).join(' | ')
      : (item.message ?? null)
    saida[item.id] = {
      situacao: SITUACAO_OLX[String(item.status ?? '').toLowerCase()] ?? 'em_analise',
      operacao: item.operation ?? null,
      mensagem: mensagens ? String(mensagens).slice(0, 900) : null,
      list_id: item.list_id ? String(item.list_id) : null,
      url: item.url ?? null,
    }
  }
  return saida
}
