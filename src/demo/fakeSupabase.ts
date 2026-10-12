/**
 * Banco de mentira da demonstracao do painel.
 *
 * Na demonstracao o painel inteiro roda contra ESTE objeto, e nao contra o
 * Supabase: as telas continuam chamando `supabase.from(...)` normalmente e o
 * proxy de src/core/supabase.ts manda a chamada para ca. Tudo fica na memoria
 * da aba -- nada sai do navegador, nada e gravado no banco, e fechar a aba
 * apaga tudo. Mesmo que alguma chamada escapasse, sem sessao o RLS do Supabase
 * nega qualquer leitura ou escrita.
 *
 * Implementa so o pedaco do query builder que o painel usa: select (com o
 * embutido `car_photos(*)`), eq/neq/in/is/gt/gte/lt/lte, order, limit, single,
 * maybeSingle, insert, update, upsert e delete. Metodo desconhecido vira no-op
 * em vez de quebrar a tela.
 */

type Row = Record<string, unknown>
type Result = { data: unknown; error: { message: string } | null; count: null; status: number; statusText: string }

export type FakeDb = Record<string, Row[]>

const clone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`

/** Chave natural de cada tabela (o que o upsert usa quando a tela nao diz). */
const CHAVE: Record<string, string> = {
  tenant_settings: 'tenant_id',
  report_settings: 'tenant_id',
  tenant_google_credentials: 'tenant_id',
}

type Filtro = (row: Row) => boolean
type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete'

function comparar(a: unknown, b: unknown) {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  return String(a) < String(b) ? -1 : 1
}

class Query implements PromiseLike<Result> {
  private op: Op = 'select'
  private filtros: Filtro[] = []
  private ordens: { col: string; asc: boolean }[] = []
  private limite: number | null = null
  private modo: 'lista' | 'single' | 'maybe' = 'lista'
  private retornar = false
  private embutir = false
  private payload: Row[] = []
  private patch: Row = {}
  private conflito: string | null = null

  private db: FakeDb
  private tabela: string

  constructor(db: FakeDb, tabela: string) {
    this.db = db
    this.tabela = tabela
  }

  private linhas(): Row[] {
    if (!this.db[this.tabela]) this.db[this.tabela] = []
    return this.db[this.tabela]
  }

  select(colunas = '*') {
    if (this.op === 'select') this.embutir = /car_photos\s*\(/.test(colunas)
    else this.retornar = true
    if (/car_photos\s*\(/.test(colunas)) this.embutir = true
    return this
  }

  insert(valores: Row | Row[]) {
    this.op = 'insert'
    this.payload = Array.isArray(valores) ? valores : [valores]
    return this
  }

  upsert(valores: Row | Row[], opcoes?: { onConflict?: string }) {
    this.op = 'upsert'
    this.payload = Array.isArray(valores) ? valores : [valores]
    this.conflito = opcoes?.onConflict ?? null
    return this
  }

  update(patch: Row) {
    this.op = 'update'
    this.patch = patch
    return this
  }

  delete() {
    this.op = 'delete'
    return this
  }

  eq(col: string, v: unknown) {
    this.filtros.push((r) => r[col] === v || (r[col] !== null && v !== null && String(r[col]) === String(v)))
    return this
  }
  neq(col: string, v: unknown) {
    this.filtros.push((r) => r[col] !== v)
    return this
  }
  in(col: string, lista: unknown[]) {
    const set = new Set((lista || []).map(String))
    this.filtros.push((r) => set.has(String(r[col])))
    return this
  }
  is(col: string, v: unknown) {
    this.filtros.push((r) => (v === null ? r[col] === null || r[col] === undefined : r[col] === v))
    return this
  }
  gt(col: string, v: unknown) {
    this.filtros.push((r) => comparar(r[col], v) > 0)
    return this
  }
  gte(col: string, v: unknown) {
    this.filtros.push((r) => comparar(r[col], v) >= 0)
    return this
  }
  lt(col: string, v: unknown) {
    this.filtros.push((r) => comparar(r[col], v) < 0)
    return this
  }
  lte(col: string, v: unknown) {
    this.filtros.push((r) => comparar(r[col], v) <= 0)
    return this
  }
  order(col: string, opcoes?: { ascending?: boolean }) {
    this.ordens.push({ col, asc: opcoes?.ascending !== false })
    return this
  }
  limit(n: number) {
    this.limite = n
    return this
  }
  single() {
    this.modo = 'single'
    return this
  }
  maybeSingle() {
    this.modo = 'maybe'
    return this
  }

  private casa(row: Row) {
    return this.filtros.every((f) => f(row))
  }

  private comFotos(row: Row): Row {
    if (!this.embutir) return row
    const fotos = (this.db.car_photos || []).filter((f) => f.car_id === row.id)
    return { ...row, car_photos: fotos }
  }

  private finalizar(rows: Row[]): Result {
    let out = rows.map((r) => this.comFotos(r))
    if (this.ordens.length) {
      out = [...out].sort((a, b) => {
        for (const { col, asc } of this.ordens) {
          const c = comparar(a[col], b[col])
          if (c !== 0) return asc ? c : -c
        }
        return 0
      })
    }
    if (this.limite !== null) out = out.slice(0, this.limite)
    out = clone(out)
    if (this.modo === 'single') {
      if (out.length !== 1) return erro('Nenhum registro encontrado.')
      return ok(out[0])
    }
    if (this.modo === 'maybe') return ok(out[0] ?? null)
    return ok(out)
  }

  private executar(): Result {
    const tabela = this.linhas()
    const agora = new Date().toISOString()

    if (this.op === 'select') return this.finalizar(tabela.filter((r) => this.casa(r)))

    if (this.op === 'insert') {
      const novos = this.payload.map((v) => ({ id: uuid(), created_at: agora, ...clone(v) }))
      tabela.push(...novos)
      return this.retornar || this.modo !== 'lista' ? this.finalizar(novos) : ok(null)
    }

    if (this.op === 'upsert') {
      const chaves = (this.conflito || CHAVE[this.tabela] || 'id').split(',').map((c) => c.trim())
      const tocados: Row[] = []
      for (const v of this.payload) {
        const atual = tabela.find((r) => chaves.every((k) => v[k] !== undefined && String(r[k]) === String(v[k])))
        if (atual) {
          Object.assign(atual, clone(v))
          tocados.push(atual)
        } else {
          const novo = { id: uuid(), created_at: agora, ...clone(v) }
          tabela.push(novo)
          tocados.push(novo)
        }
      }
      return this.retornar || this.modo !== 'lista' ? this.finalizar(tocados) : ok(null)
    }

    if (this.op === 'update') {
      const alvo = tabela.filter((r) => this.casa(r))
      for (const r of alvo) Object.assign(r, clone(this.patch))
      return this.retornar || this.modo !== 'lista' ? this.finalizar(alvo) : ok(null)
    }

    // delete
    const ficam = tabela.filter((r) => !this.casa(r))
    this.db[this.tabela] = ficam
    return ok(null)
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    let resultado: Result
    try {
      resultado = this.executar()
    } catch (e) {
      resultado = erro(e instanceof Error ? e.message : 'Falha na demonstração.')
    }
    // Um pequeno atraso deixa os carregamentos da tela parecidos com os de verdade.
    return new Promise<Result>((resolve) => setTimeout(() => resolve(resultado), 120)).then(onfulfilled, onrejected)
  }
}

function ok(data: unknown): Result {
  return { data, error: null, count: null, status: 200, statusText: 'OK' }
}

function erro(message: string): Result {
  return { data: null, error: { message }, count: null, status: 400, statusText: 'Bad Request' }
}

/** Qualquer metodo que o painel chame e este banco nao conheca vira no-op encadeavel. */
function tolerante(q: Query): Query {
  return new Proxy(q, {
    get(alvo, prop, recv) {
      if (prop in alvo) {
        const v = Reflect.get(alvo, prop, recv)
        return typeof v === 'function'
          ? (...args: unknown[]) => {
              const r = (v as (...a: unknown[]) => unknown).apply(alvo, args)
              return r === alvo ? recv : r
            }
          : v
      }
      return () => recv
    },
  })
}

// --- storage: arquivo fica so na aba (URL de objeto) ----------------------------

const urlPorCaminho = new Map<string, string>()
const arquivoPorUrl = new Map<string, File | Blob>()

/** O PDF que a loja escolheu no cadastro (para a leitura do laudo pela IA). */
export function arquivoDaDemo(url: string): File | Blob | undefined {
  return arquivoPorUrl.get(url)
}

function storageFalso() {
  return {
    from(_bucket: string) {
      return {
        async upload(caminho: string, arquivo: File | Blob) {
          const url = URL.createObjectURL(arquivo)
          urlPorCaminho.set(caminho, url)
          arquivoPorUrl.set(url, arquivo)
          return { data: { path: caminho }, error: null }
        },
        getPublicUrl(caminho: string) {
          return { data: { publicUrl: urlPorCaminho.get(caminho) ?? '' } }
        },
        async remove(_caminhos: string[]) {
          return { data: [], error: null }
        },
        async createSignedUrl() {
          return { data: null, error: { message: 'Indisponível na demonstração.' } }
        },
      }
    },
  }
}

export function criarSupabaseFalso(db: FakeDb) {
  return {
    from: (tabela: string) => tolerante(new Query(db, tabela)),
    rpc: async () => ({ data: null, error: null }),
    storage: storageFalso(),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: async () => undefined,
  }
}
