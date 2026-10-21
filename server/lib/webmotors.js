import crypto from 'node:crypto'
import { db, HttpError } from './db.js'
import { normaliza } from './olx.js'

/**
 * Integracao do estoque com a Webmotors (Integracao Revendedor, SOAP/.NET).
 *
 * Tudo aqui so roda quando a loja conectou a Webmotors no painel (tabela
 * webmotors_conexoes). Sem conexao, nenhuma funcao fala com a Webmotors -- o
 * cadastro do carro, a OLX e a Julia seguem exatamente como antes.
 *
 * A Webmotors so aceita chamadas de IP liberado. Por isso nada sai da Vercel
 * direto: o XML vai para o integrador no Easypanel (IP fixo 187.127.22.205), que
 * repassa para a Webmotors e devolve a resposta.
 *
 * Manual: https://integracao.webmotors.com.br/manualintegracao/index.html
 */

const NS_ESTOQUE = 'www.webmotors.com.br/wsEstoqueRevendedorWebMotors'
const NS_LOGIN = 'www.webmotors.com.br/wsLoginSistemaRevendedor'

const ENDERECOS = {
  homologacao: {
    estoque: 'https://hportal.webmotors.com.br/IntegracaoRevendedor/wsEstoqueRevendedorWebMotors.asmx',
    login: 'https://hportal.webmotors.com.br/IntegracaoRevendedor/wsLoginSistemaRevendedor.asmx',
  },
  producao: {
    estoque: 'https://integracao.webmotors.com.br/wsEstoqueRevendedorWebMotors.asmx',
    login: 'https://integracao.webmotors.com.br/wsLoginSistemaRevendedor.asmx',
  },
}

/** Sessao da Webmotors dura ~1000 min; renovamos antes, com folga. */
const SESSAO_MS = 14 * 60 * 60 * 1000

/** Foto acima disso a Webmotors recusa (codigo 21|9). */
export const FOTO_MAX_BYTES = 500 * 1024

export function webmotorsConfig() {
  const relayUrl = String(process.env.WEBMOTORS_RELAY_URL || '').replace(/\/+$/, '')
  const relaySecret = process.env.WEBMOTORS_RELAY_SECRET || ''
  const ambiente = process.env.WEBMOTORS_AMBIENTE === 'producao' ? 'producao' : 'homologacao'
  if (!relayUrl || relaySecret.length < 32) {
    // Variaveis que faltam: WEBMOTORS_RELAY_URL e WEBMOTORS_RELAY_SECRET.
    throw new HttpError(501, 'A conexão com a Webmotors está sendo liberada. Em breve você poderá conectar por aqui.')
  }
  return { relayUrl, relaySecret, ambiente, enderecos: ENDERECOS[ambiente] }
}

export function webmotorsConfigurada() {
  return Boolean(process.env.WEBMOTORS_RELAY_URL && String(process.env.WEBMOTORS_RELAY_SECRET || '').length >= 32)
}

// --- Senha da loja (cifrada no banco) ---------------------------------------------

function chave() {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY || 'wissen-dev-secret'
  return crypto.createHash('sha256').update(`webmotors:${base}`).digest()
}

export function cifra(texto) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', chave(), iv)
  const dados = Buffer.concat([c.update(String(texto), 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), dados.toString('base64')].join('.')
}

export function decifra(valor) {
  const [versao, iv, tag, dados] = String(valor || '').split('.')
  if (versao !== 'v1' || !iv || !tag || !dados) throw new HttpError(500, 'Login da Webmotors ilegível. Conecte a loja de novo.')
  const d = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8')
}

// --- XML ------------------------------------------------------------------------

export function xmlEscapa(valor) {
  return String(valor ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
  )
}

function xmlDesescapa(valor) {
  return String(valor ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
}

/** Conteudo de cada <tag>...</tag> (com ou sem prefixo de namespace). */
export function blocos(xml, tag) {
  const re = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'g')
  return [...String(xml ?? '').matchAll(re)].map((m) => m[1])
}

/** Texto do primeiro <tag>. Null se nao existe ou e vazio. */
export function campo(xml, tag) {
  const [primeiro] = blocos(xml, tag)
  if (primeiro === undefined) return null
  const texto = xmlDesescapa(primeiro).trim()
  return texto === '' ? null : texto
}

/** Monta os elementos na ordem dada. Valor null/undefined fica de fora. */
function elementos(pares) {
  return pares
    .filter(([, valor]) => valor !== null && valor !== undefined && valor !== '')
    .map(([nome, valor]) => (typeof valor === 'object' && valor.xml !== undefined ? `<${nome}>${valor.xml}</${nome}>` : `<${nome}>${xmlEscapa(valor)}</${nome}>`))
    .join('')
}

function envelope(ns, operacao, corpo) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soap:Body><${operacao} xmlns="${ns}">${corpo}</${operacao}></soap:Body></soap:Envelope>`
  )
}

/** Chama a Webmotors pelo integrador (IP fixo). Devolve o XML da resposta. */
async function soap(servico, operacao, corpo) {
  const { relayUrl, relaySecret, enderecos } = webmotorsConfig()
  const ns = servico === 'login' ? NS_LOGIN : NS_ESTOQUE
  const url = enderecos[servico]

  let res
  try {
    res = await fetch(`${relayUrl}/soap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-relay-secret': relaySecret },
      body: JSON.stringify({ url, soapAction: `${ns}/${operacao}`, xml: envelope(ns, operacao, corpo) }),
      signal: AbortSignal.timeout(58_000),
    })
  } catch {
    throw new HttpError(502, 'Não consegui falar com a Webmotors agora. Tente de novo em instantes.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new HttpError(502, data?.erro ? `Integrador: ${data.erro}` : 'O integrador da Webmotors não respondeu.')

  const xml = String(data.xml ?? '')
  if (Number(data.status) === 403) {
    throw new HttpError(502, 'A Webmotors recusou o acesso deste servidor. O IP do integrador precisa estar liberado por ela.')
  }
  const falha = campo(xml, 'faultstring')
  if (falha) throw new HttpError(502, `A Webmotors respondeu com erro: ${falha.slice(0, 300)}`)
  if (Number(data.status) >= 400) throw new HttpError(502, `A Webmotors respondeu com erro (${data.status}).`)
  return xml
}

// --- Codigos de retorno -------------------------------------------------------------

const OK = '500'
const SESSAO_INVALIDA = new Set(['401', '402', '31'])

const RETORNOS = {
  400: 'Falha inesperada na Webmotors. Tente de novo; se continuar, fale com o suporte da Webmotors.',
  401: 'Sessão da Webmotors inválida.',
  402: 'Sessão da Webmotors expirou.',
  403: 'O usuário de integração da loja não tem permissão para esta operação na Webmotors.',
  31: 'Sessão da Webmotors inválida.',
  '21|9': 'A foto passa de 500 KB, o limite da Webmotors.',
  '21|10': 'Formato da foto não aceito pela Webmotors.',
  '42|1': 'A Webmotors pediu um campo que não foi preenchido.',
  '42|2': 'Limite de fotos do plano da Webmotors atingido.',
  '42|3': 'O plano (modalidade) escolhido na Webmotors não aceita fotos.',
  '42|4': 'A Webmotors não conseguiu gravar a foto.',
  '22|78': 'A Webmotors recusou o preço do anúncio.',
  '28|2': 'Preço de venda inválido para a Webmotors.',
  '43|32': 'O plano da loja na Webmotors não tem mais anúncios disponíveis.',
}

export function explicaRetorno(codigo) {
  const c = String(codigo ?? '').trim()
  return RETORNOS[c] ?? `A Webmotors recusou (código ${c || 'sem código'}).`
}

const sucesso = (codigo) => String(codigo ?? '').trim() === OK

// --- Sessao da loja -----------------------------------------------------------------

export async function conexaoDaLoja(tenantId) {
  return db.selectOne('webmotors_conexoes', `tenant_id=eq.${tenantId}&select=*`)
}

/** Login do usuario "Integrador de API" da loja. Devolve a chave de sessao. */
export async function autenticar({ cnpj, email, senha }) {
  const xml = await soap(
    'login',
    'autenticar',
    elementos([
      ['cnpj', String(cnpj).replace(/\D/g, '')],
      ['email', String(email).trim()],
      ['senha', String(senha)],
    ]),
  )
  const hash = campo(xml, 'HashAutenticacao')
  const codigo = campo(xml, 'CodigoRetorno')
  // Login errado tambem devolve HashAutenticacao (com o texto do erro): so vale com codigo 500.
  if (!hash || !sucesso(codigo)) {
    throw new HttpError(
      400,
      'A Webmotors não aceitou o login.',
      `Confira o CNPJ, o e-mail e a senha do usuário "Integrador de API" da loja no Cockpit${codigo ? ` (código ${codigo})` : ''}.`,
    )
  }
  return hash
}

/** Chave de sessao valida para a loja (renova quando precisa). */
export async function sessao(conexao, { renovar = false } = {}) {
  const valida = conexao.hash_sessao && conexao.hash_expira_em && new Date(conexao.hash_expira_em).getTime() > Date.now()
  if (valida && !renovar) return conexao.hash_sessao

  const hash = await autenticar({ cnpj: conexao.cnpj, email: conexao.email, senha: decifra(conexao.senha_cifrada) })
  const expira = new Date(Date.now() + SESSAO_MS).toISOString()
  await db.update('webmotors_conexoes', `tenant_id=eq.${conexao.tenant_id}`, {
    hash_sessao: hash,
    hash_expira_em: expira,
    atualizado_em: new Date().toISOString(),
  })
  conexao.hash_sessao = hash
  conexao.hash_expira_em = expira
  return hash
}

/**
 * Executa uma operacao de estoque com a sessao da loja. Se a Webmotors disser
 * que a sessao caiu, faz login de novo e tenta mais uma vez.
 */
async function comSessao(conexao, operacao, corpo, codigoDe) {
  let hash = await sessao(conexao)
  let xml = await soap('estoque', operacao, elementos([['pHashAutenticacao', hash], ...corpo]))
  if (SESSAO_INVALIDA.has(String(codigoDe(xml) ?? '').trim())) {
    hash = await sessao(conexao, { renovar: true })
    xml = await soap('estoque', operacao, elementos([['pHashAutenticacao', hash], ...corpo]))
  }
  return xml
}

const primeiroCodigo = (xml) => campo(xml, 'CodigoRetorno')

// --- Catalogo e tabelas da Webmotors ----------------------------------------------

// As tabelas (cores, cambios...) sao iguais para todas as lojas: guardo um pouco.
const cache = new Map()
async function guardado(chaveCache, ms, buscar) {
  const item = cache.get(chaveCache)
  if (item && Date.now() - item.em < ms) return item.valor
  const valor = await buscar()
  if (Array.isArray(valor) && valor.length) cache.set(chaveCache, { em: Date.now(), valor })
  return valor
}
const SEIS_HORAS = 6 * 60 * 60 * 1000

const ordena = (lista) => lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

export async function marcas(conexao) {
  return guardado('marcas', SEIS_HORAS, async () => {
    const xml = await comSessao(conexao, 'ObterMarca', [], primeiroCodigo)
    return ordena(
      blocos(xml, 'MarcaWM')
        .map((b) => ({ id: Number(campo(b, 'CodigoMarca')), nome: campo(b, 'NomeMarca') ?? '' }))
        .filter((i) => Number.isFinite(i.id) && i.nome),
    )
  })
}

export async function modelos(conexao, codigoMarca) {
  return guardado(`modelos:${codigoMarca}`, SEIS_HORAS, async () => {
    const xml = await comSessao(conexao, 'ObterModelo', [['pCodigoMarca', String(Number(codigoMarca))]], primeiroCodigo)
    return ordena(
      blocos(xml, 'ModeloWM')
        .map((b) => ({ id: Number(campo(b, 'CodigoModelo')), nome: campo(b, 'NomeModelo') ?? '' }))
        .filter((i) => Number.isFinite(i.id) && i.nome),
    )
  })
}

/** Versoes do modelo. Com `ano`, so as que existem naquele ano-modelo (quando a Webmotors informa). */
export async function versoes(conexao, codigoModelo, ano) {
  const todas = await guardado(`versoes:${codigoModelo}`, SEIS_HORAS, async () => {
    const xml = await comSessao(
      conexao,
      'ObterVersao',
      [
        ['pCodigoModelo', String(Number(codigoModelo))],
        ['pDataInicioAtualizacao', '1990-01-01T00:00:00'],
        ['pDataFimAtualizacao', new Date().toISOString().slice(0, 19)],
      ],
      primeiroCodigo,
    )
    return ordena(
      blocos(xml, 'Versao')
        .map((b) => ({
          id: Number(campo(b, 'CodigoVersao')),
          nome: campo(b, 'NomeVersao') ?? '',
          anos: blocos(b, 'AnoModeloWM').map((a) => Number(campo(a, 'AnoModelo'))).filter(Number.isFinite),
        }))
        .filter((i) => Number.isFinite(i.id) && i.nome),
    )
  })
  const n = Number(ano)
  if (!n) return todas
  const doAno = todas.filter((v) => !v.anos.length || v.anos.includes(n))
  return doAno.length ? doAno : todas
}

async function tabela(conexao, operacao, bloco, codigoTag) {
  return guardado(`tabela:${operacao}`, SEIS_HORAS, async () => {
    const xml = await comSessao(conexao, operacao, [], primeiroCodigo)
    return blocos(xml, bloco)
      .map((b) => ({ id: Number(campo(b, codigoTag)), nome: campo(b, 'Descricao') ?? '' }))
      .filter((i) => Number.isFinite(i.id) && i.nome)
  })
}

export const cores = (conexao) => tabela(conexao, 'ObterCores', 'CorWM', 'CodigoCor')
export const combustiveis = (conexao) => tabela(conexao, 'ObterCombustivel', 'CombustivelWM', 'CodigoCombustivel')
export const cambios = (conexao) => tabela(conexao, 'ObterCambio', 'TipoCambioWM', 'CodigoCambio')
export const opcionais = (conexao) => tabela(conexao, 'ObterOpcionais', 'OpcionalWM', 'CodigoOpcional')

/** Modalidades do plano da loja (nao vai para o cache: muda de loja para loja). */
export async function modalidades(conexao) {
  const xml = await comSessao(conexao, 'ObterModalidade', [], primeiroCodigo)
  return blocos(xml, 'ModalidadeWM')
    .map((b) => ({
      id: Number(campo(b, 'CodigoModalidade')),
      nome: campo(b, 'Descricao') ?? '',
      tipo: campo(b, 'TipoAnuncio'),
      total: Number(campo(b, 'QuantidadeAnunciosTotal') ?? 0),
      usados: Number(campo(b, 'QuantidadeAnuncios') ?? 0),
      permiteFoto: campo(b, 'PermiteFoto') !== 'N',
    }))
    .filter((m) => Number.isFinite(m.id) && m.id > 0)
}

// --- Achar no catalogo o que a loja digitou -----------------------------------------

const tokens = (texto) => normaliza(texto).split(' ').filter(Boolean)

/** Mesmo criterio da OLX: igual, ou o mais parecido (marcado para conferir). */
export function melhor(lista, texto, extra = '') {
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
    if (` ${alvo} `.includes(` ${nomeN} `)) pontos += 0.5 + nomeN.length / 100
    if (pontos > nota) {
      nota = pontos
      vencedor = item
    }
  }
  if (!vencedor || nota < 0.34) return null
  return { ...vencedor, certeza: nota >= 0.9 ? 'alta' : 'conferir' }
}

export async function sugerirCatalogo(conexao, { brand, model, version, engine, transmission, model_year }) {
  const listaMarcas = await marcas(conexao)
  const marca = melhor(listaMarcas, brand)
  if (!marca) return { marca: null, modelo: null, versao: null, marcas: listaMarcas, modelos: [], versoes: [] }

  const listaModelos = await modelos(conexao, marca.id)
  const modelo = melhor(listaModelos, `${model ?? ''}`, `${version ?? ''}`)
  if (!modelo) return { marca, modelo: null, versao: null, marcas: listaMarcas, modelos: listaModelos, versoes: [] }

  const listaVersoes = (await versoes(conexao, modelo.id, model_year)).map(({ id, nome }) => ({ id, nome }))
  const versao = melhor(listaVersoes, `${version ?? ''}`, `${engine ?? ''} ${transmission ?? ''}`)
  return { marca, modelo, versao, marcas: listaMarcas, modelos: listaModelos, versoes: listaVersoes }
}

// --- Do cadastro do carro para o anuncio da Webmotors -------------------------------

/** Nome da tabela da Webmotors sem acento e sem o/a final (automatico = automatica). */
const raiz = (texto) => normaliza(texto).replace(/[oa]\b/g, '')

/** Primeiro item da tabela cujo nome (sem acento/genero) e um dos nomes dados. */
function pelaRaiz(lista, ...nomes) {
  const alvos = nomes.map(raiz)
  return lista?.find((i) => alvos.includes(raiz(i.nome))) ?? null
}

/** Cambio do cadastro -> tabela da Webmotors (Manual, Automatica, CVT, Automatizada...). */
function cambioDaTabela(lista, transmission) {
  const t = normaliza(transmission)
  if (!t) return null
  if (t.startsWith('manual')) return pelaRaiz(lista, 'manual')
  if (t.includes('cvt')) return pelaRaiz(lista, 'cvt', 'automatica')
  if (t.startsWith('semi')) return pelaRaiz(lista, 'semi automatica')
  if (t.startsWith('automatizad')) return t.includes('dct') || t.includes('dupla') ? pelaRaiz(lista, 'automatizada dct', 'automatizada') : pelaRaiz(lista, 'automatizada')
  if (t.startsWith('automat') || t === 'at') return pelaRaiz(lista, 'automatica')
  return pelaRaiz(lista, t)
}

/** Combustivel do cadastro -> tabela (Flex = "Gasolina e alcool"). */
function combustivelDaTabela(lista, fuel) {
  const f = normaliza(fuel)
  if (!f) return null
  if (f.startsWith('flex')) return pelaRaiz(lista, 'gasolina e alcool')
  if (f.startsWith('etanol') || f.startsWith('alcool')) return pelaRaiz(lista, 'alcool')
  if (f.startsWith('gasolina')) return pelaRaiz(lista, 'gasolina')
  if (f.startsWith('diesel')) return pelaRaiz(lista, 'diesel')
  if (f.startsWith('hibrido')) return pelaRaiz(lista, 'gasolina e eletrico')
  if (f.startsWith('eletric')) return pelaRaiz(lista, 'eletrico')
  if (f.startsWith('gnv') || f.includes('gas natural')) return pelaRaiz(lista, 'gasolina e gas natural')
  return pelaRaiz(lista, f)
}

/** Cor do cadastro -> tabela. Sem cor parecida, vai como "Indefinida". */
function corDaTabela(lista, color) {
  const c = normaliza(color)
  if (!c || !lista?.length) return null
  const primeira = c.split(' ')[0]
  const sinonimos = { grafite: 'cinza', chumbo: 'cinza', champagne: 'bege', creme: 'bege', bordo: 'vinho', grena: 'vinho' }
  return (
    pelaRaiz(lista, sinonimos[primeira] ?? primeira) ??
    lista.find((i) => c.includes(normaliza(i.nome))) ??
    lista.find((i) => /^indefinid|^outr/.test(normaliza(i.nome))) ??
    null
  )
}

const temItem = (valor) => {
  const v = normaliza(valor)
  return Boolean(v) && !v.startsWith('nao') && v !== 'sem'
}

/** Opcionais do cadastro que a Webmotors entende, pela descricao da tabela dela. */
function opcionaisDoCarro(car, lista) {
  const procura = (...termos) =>
    lista.find((item) => {
      const n = normaliza(item.nome)
      return termos.some((t) => n.includes(t))
    })
  const escolhidos = [
    temItem(car.air_conditioning) && procura('ar condicionado'),
    temItem(car.electric_windows) && procura('vidros eletricos', 'vidro eletrico'),
    temItem(car.carplay_android_auto) && procura('multimidia', 'central multimidia', 'android auto', 'carplay'),
    temItem(car.parking_sensor) && procura('sensor de estacionamento', 'sensor de re', 'sensor de manobra'),
    temItem(car.rear_camera) && procura('camera de re', 'camera traseira'),
    temItem(car.leather_seats) && procura('bancos em couro', 'bancos de couro', 'couro'),
    normaliza(car.steering).startsWith('hidraul') && procura('direcao hidraulica'),
    normaliza(car.steering).startsWith('eletr') && procura('direcao eletrica', 'direcao hidraulica'),
    temItem(car.sunroof) && procura('teto solar', 'teto panoramico'),
    temItem(car.keyless_entry) && procura('chave presencial', 'partida sem chave', 'keyless'),
    ['4x4', 'awd'].includes(normaliza(car.traction)) && procura('tracao 4x4', '4x4'),
    car.blindado && procura('blindado', 'blindagem'),
  ].filter(Boolean)
  const vistos = new Set()
  return escolhidos.filter((item) => (vistos.has(item.id) ? false : vistos.add(item.id)))
}

const sn = (valor) => (valor ? 'S' : 'N')
const dinheiro = (valor) => (Math.round(Number(valor) * 100) / 100).toFixed(2)

/** Placa no formato ABC1234 ou ABC1D23. */
const placaLimpa = (placa) => String(placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const placaValida = (placa) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placaLimpa(placa))

/**
 * Monta o anuncio (XML do AnuncioWM) na ordem do WSDL. Quando falta algo
 * obrigatorio, devolve a lista do que falta -- o painel mostra para a loja.
 */
export async function montarAnuncio({ car, conexao, codigoAnuncio = 0 }) {
  const faltando = []
  const zeroKm = Number(car.mileage_km) === 0
  const anoModelo = Number(car.model_year || car.year)
  const anoFabricacao = Number(car.year || car.model_year)
  const preco = Number(car.price_brl)
  const portas = Number(car.doors)

  const [listaCores, listaCombustiveis, listaCambios, listaOpcionais] = await Promise.all([
    cores(conexao),
    combustiveis(conexao),
    cambios(conexao),
    opcionais(conexao).catch(() => []),
  ])
  const cor = corDaTabela(listaCores, car.color)
  const combustivel = combustivelDaTabela(listaCombustiveis, car.fuel)
  const cambio = cambioDaTabela(listaCambios, car.transmission)

  if (!conexao.modalidade_cod) faltando.push('plano (modalidade) da Webmotors em Integrações')
  if (!car.wm_marca_cod || !car.wm_modelo_cod || !car.wm_versao_cod) faltando.push('marca, modelo e versão da Webmotors')
  if (!anoModelo) faltando.push('ano do modelo')
  if (!zeroKm && !placaValida(car.placa)) faltando.push('placa')
  if (car.mileage_km === null || car.mileage_km === undefined) faltando.push('quilometragem')
  if (!preco || preco <= 0) faltando.push('preço')
  if (![2, 3, 4, 5].includes(portas)) faltando.push('portas')
  if (!cor) faltando.push('cor (como a Webmotors chama)')
  if (!combustivel) faltando.push('combustível (como a Webmotors chama)')
  if (!cambio) faltando.push('câmbio (como a Webmotors chama)')
  if (faltando.length) return { faltando }

  const observacao = String(car.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
  const lista = opcionaisDoCarro(car, listaOpcionais)

  const xml = elementos([
    ['CodigoAnuncio', String(Number(codigoAnuncio) || 0)],
    ['CodigoModalidade', String(conexao.modalidade_cod)],
    ['TipoAnuncio', zeroKm ? 'N' : 'U'],
    ['CodigoMarca', String(car.wm_marca_cod)],
    ['CodigoModelo', String(car.wm_modelo_cod)],
    ['CodigoVersao', String(car.wm_versao_cod)],
    ['AnoDoModelo', String(anoModelo)],
    ['AnoFabricacao', String(anoFabricacao || anoModelo)],
    ['Km', String(Math.max(0, Math.round(Number(car.mileage_km))))],
    ['Placa', zeroKm ? null : placaLimpa(car.placa)],
    ['CodigoCambio', String(cambio.id)],
    ['DescricaoCambio', cambio.nome],
    ['NrPortas', String(portas)],
    ['CodigoCor', String(cor.id)],
    ['DescricaoCor', cor.nome],
    ['CodigoCombustivel', String(combustivel.id)],
    ['DescricaoCombustivel', combustivel.nome],
    ['Blindado', sn(car.blindado)],
    ['AdaptadoDeficientesFisicos', sn(car.wm_adaptado_pcd)],
    ['UnicoDono', sn(car.single_owner)],
    ['Alienado', sn(car.situacao_financeira === 'financiado')],
    ['IpvaPago', sn(car.ipva_paid)],
    ['NaoAceitaTroca', sn(car.accepts_trade === false)],
    ['RevisadoOficinaAgendaDoCarro', 'N'],
    ['RevisoesEmConcessionaria', sn(car.dealer_revisions)],
    ['GarantiaDeFabrica', sn(car.wm_garantia_fabrica)],
    ['Licenciado', sn(car.licensed)],
    ['Leilao', sn(car.de_leilao)],
    // PrecoReal vai 0: com valor, a homologacao recusa (codigo 22|78). O preco do anuncio e o PrecoVenda.
    ['PrecoReal', '0'],
    ['PrecoVenda', dinheiro(preco)],
    ['Observacao', observacao || null],
    [
      'Opcional',
      lista.length
        ? {
            xml: lista
              .map((o) => `<OpcionalWM><CodigoOpcional>${o.id}</CodigoOpcional><Descricao>${xmlEscapa(o.nome)}</Descricao></OpcionalWM>`)
              .join(''),
          }
        : null,
    ],
  ])

  return { xml }
}

/** Resumo do anuncio sem o codigo -- para nao reenviar o que nao mudou. */
export function hashDoAnuncio(xml) {
  const semCodigo = String(xml).replace(/<CodigoAnuncio>[^<]*<\/CodigoAnuncio>/, '')
  return crypto.createHash('sha256').update(semCodigo).digest('hex').slice(0, 32)
}

// --- Anuncio: incluir, alterar, excluir ----------------------------------------------

/** Inclui o anuncio. Devolve { ok, codigoAnuncio, mensagem }. */
export async function incluirCarro(conexao, anuncioXml) {
  const xml = await comSessao(conexao, 'IncluirCarro', [['pAnuncio', { xml: anuncioXml }]], (x) => campo(blocos(x, 'IncluirCarroResult')[0], 'CodigoRetorno'))
  const resultado = blocos(xml, 'IncluirCarroResult')[0] ?? ''
  const codigo = lerRetornoDoAnuncio(resultado)
  const codigoAnuncio = Number(campo(resultado, 'CodigoAnuncio'))
  if (sucesso(codigo) && codigoAnuncio > 0) return { ok: true, codigoAnuncio, mensagem: null }
  return { ok: false, codigoAnuncio: null, mensagem: explicaRetorno(codigo) }
}

export async function alterarCarro(conexao, anuncioXml) {
  const xml = await comSessao(conexao, 'AlterarCarro', [['pAnuncio', { xml: anuncioXml }]], (x) => campo(blocos(x, 'AlterarCarroResult')[0], 'CodigoRetorno'))
  const resultado = blocos(xml, 'AlterarCarroResult')[0] ?? ''
  const codigo = lerRetornoDoAnuncio(resultado)
  return sucesso(codigo) ? { ok: true, mensagem: null } : { ok: false, mensagem: explicaRetorno(codigo) }
}

/**
 * CodigoRetorno do anuncio (o ultimo, depois da lista de opcionais -- cada
 * opcional tem o seu CodigoRetorno tambem).
 */
function lerRetornoDoAnuncio(resultado) {
  const semOpcionais = String(resultado).replace(/<(?:\w+:)?Opcional(?:\s[^>]*)?>[\s\S]*?<\/(?:\w+:)?Opcional>/g, '')
  return campo(semOpcionais, 'CodigoRetorno')
}

/** Motivo: '2' vendi na loja, '3' outros (reservado, excluido, tirado da Webmotors). */
export async function excluirCarro(conexao, codigoAnuncio, motivo = '3') {
  const xml = await comSessao(
    conexao,
    'ExcluirCarro',
    [
      ['pCodigoAnuncio', String(Number(codigoAnuncio))],
      ['pMotivoExclusao', motivo],
    ],
    (x) => lerRetornoDoAnuncio(blocos(x, 'ExcluirCarroResult')[0] ?? ''),
  )
  const codigo = lerRetornoDoAnuncio(blocos(xml, 'ExcluirCarroResult')[0] ?? '')
  return sucesso(codigo) ? { ok: true, mensagem: null } : { ok: false, mensagem: explicaRetorno(codigo) }
}

// --- Fotos ----------------------------------------------------------------------------

/**
 * Baixa uma foto do proprio estoque (Supabase Storage) para enviar como arquivo:
 * a Webmotors nao aceita foto por link. A foto guardada no painel nao muda.
 */
export async function baixarFoto(url) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '')
  if (!base || !String(url).startsWith(`${base}/storage/`)) return { erro: 'Foto fora do estoque do painel.' }
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null)
  if (!res?.ok) return { erro: 'Não consegui baixar a foto do estoque.' }
  const tipo = String(res.headers.get('content-type') || '').toLowerCase()
  const bytes = Buffer.from(await res.arrayBuffer())
  if (!/jpe?g|png|gif/.test(tipo)) return { erro: 'Foto em formato que a Webmotors não aceita (use JPG ou PNG).' }
  if (bytes.length > FOTO_MAX_BYTES) return { erro: 'Foto acima de 500 KB, o limite da Webmotors.' }
  return { bytes }
}

export async function incluirFoto(conexao, codigoAnuncio, bytes) {
  const corpo = [
    ['pByteImage', bytes.toString('base64')],
    ['pCodigoAnuncio', String(Number(codigoAnuncio))],
  ]
  const xml = await comSessao(conexao, 'IncluirFoto', corpo, (x) => campo(blocos(x, 'IncluirFotoResult')[0], 'CodigoRetorno'))
  const resultado = blocos(xml, 'IncluirFotoResult')[0] ?? ''
  const codigo = campo(resultado, 'CodigoRetorno')
  const codigoFoto = Number(campo(resultado, 'CodigoFoto'))
  if (sucesso(codigo) && codigoFoto > 0) return { ok: true, codigoFoto, codigo }
  return { ok: false, codigo, mensagem: explicaRetorno(codigo) }
}

export async function excluirFoto(conexao, codigoAnuncio, codigoFoto) {
  const xml = await comSessao(
    conexao,
    'ExcluirFoto',
    [
      ['pCodigoFoto', String(Number(codigoFoto))],
      ['pCodigoAnuncio', String(Number(codigoAnuncio))],
    ],
    (x) => campo(blocos(x, 'ExcluirFotoResult')[0], 'CodigoRetorno'),
  )
  const codigo = campo(blocos(xml, 'ExcluirFotoResult')[0] ?? '', 'CodigoRetorno')
  return { ok: sucesso(codigo), mensagem: sucesso(codigo) ? null : explicaRetorno(codigo) }
}
