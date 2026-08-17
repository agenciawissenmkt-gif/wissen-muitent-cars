# Wissen Cars

SaaS multi-tenant para lojas de veículos multimarcas. O lojista entra com a conta Google, cadastra o estoque
(com fotos tiradas na hora pela câmera), roda o assistente de implementação em 4 etapas e passa a ter um agente
de IA atendendo no WhatsApp — alimentado em tempo real pelos dados do Supabase.

## O que a plataforma faz

| Aba | O que acontece |
| --- | --- |
| 🚗 **Estoque de Veículos** | Cadastro, edição e exclusão de anúncios com ficha técnica completa, upload/câmera de fotos, busca instantânea e filtro por status. |
| 📊 **Visão Geral** | Total em estoque, disponíveis, valor acumulado do inventário e status do agente de IA. |
| ⚙️ **Implementação** | Assistente de 4 etapas: regras da loja e prompts → Google Agenda → central Chatwoot e vendedores → conexão do WhatsApp por QR Code (com comemoração ao conectar). |

## Arquitetura

- **Front-end** (`src/`): React 19 + Vite + TypeScript + Tailwind v4 + Framer Motion. Fala direto com o Supabase
  (Auth, Postgres e Storage) usando a anon key — o isolamento entre lojas é garantido pelas políticas de RLS.
- **Back-end** (`server/`): Express com as rotas de provisionamento. Existe apenas para guardar as chaves
  privilegiadas (service role do Supabase, Super Admin do Chatwoot, Evolution API, OAuth do Google) fora do navegador.
  Toda rota exige o access token do usuário e confere se ele é dono da loja.
- **Banco** (`supabase/migrations/`): o painel roda sobre o projeto Supabase que já alimenta o
  fluxo do N8N. `0001_wissen_cars.sql` é o schema base (para subir um ambiente novo) e
  `0002_app_layer.sql` é a camada do painel — aditiva, sem tocar no que o N8N usa.

```
src/
  core/      supabase, auth, contexto do tenant, chamadas à API, formatação, confetes
  ui/        botões, campos, modal, toasts, ícones
  screens/   Login, AppShell, Inventory, Overview, Implementation
    inventory/      card, formulário, seletor de fotos, câmera
    implementation/ etapas 1 a 4
server/
  routes/    google, chatwoot, evolution, provisioning
  lib/       acesso ao Supabase e verificação de sessão
```

## Rodando localmente

```bash
npm install

# 1. Banco: no projeto atual a migração 0002_app_layer.sql já está aplicada.
#    Para um ambiente novo, rode 0001_wissen_cars.sql e depois 0002_app_layer.sql.

# 2. Front-end
cp .env.example .env        # cole VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev

# 3. Back-end de provisionamento (etapas 2, 3 e 4 da implementação)
cp server/.env.example server/.env
npm run server
```

O Vite já encaminha `/api/*` para `http://localhost:8787` (veja `vite.config.ts`).

Dois verificadores ajudam a saber se está tudo de pé:

- `npm run check` — projeto Supabase: tabelas, funções, bucket e login com Google;
- `npm run check:server` — chaves das integrações: Supabase service role, Chatwoot, Evolution,
  Google e o webhook do n8n, cada uma testada contra a API real.

Onde pegar cada chave: [`docs/CHAVES.md`](docs/CHAVES.md).
Como o app mapeia o banco: [`docs/CONFIGURACAO.md`](docs/CONFIGURACAO.md).

Sem as variáveis do Supabase o app mostra uma tela explicando a configuração pendente; sem as chaves das
integrações no servidor, cada etapa responde com uma mensagem dizendo exatamente qual variável falta —
o estoque e o dashboard continuam funcionando normalmente.

Para testar a etapa 4 (QR Code + fogos de artifício) sem uma Evolution API real, use `WISSEN_SIMULATE=true`
em `server/.env`: o servidor devolve um QR de simulação e reporta a conexão depois de ~12 segundos.

## Banco de dados

| Tabela | Papel |
| --- | --- |
| `stores` | A loja do lojista: `owner_id` é a conta Google que faz login. Guarda CNPJ, endereço, garantia, formas de pagamento, regras comerciais e o passo do wizard. |
| `tenants` | A mesma loja do ponto de vista do agente, ligada por `stores.tenant_id`. |
| `tenant_channels` | `chatwoot_account_id`, `chatwoot_inbox_id`, `evolution_instance` e `whatsapp_number`. |
| `tenant_settings` | URLs e tokens do Chatwoot e da Evolution, telefone do bot, agenda e horário de atendimento. |
| `tenant_agents` | Um prompt por fase da conversa (descoberta, encantamento, fechamento). |
| `tenant_google_credentials` | Tokens do Google Agenda da loja. |
| `salespeople` | Equipe de vendas e o papel de cada um (administrador/vendedor). |
| `cars` / `car_photos` | Estoque e as fotos (`ordem`, `is_cover`) no bucket `car-photos`. |

RLS: cada tabela só devolve linhas do tenant vinculado à loja de `auth.uid()` (função `owns_tenant`). As fotos ficam em
`car-photos/<tenant_id>/<car_id>/<arquivo>` e só o dono da loja pode escrever nessa pasta. O N8N acessa tudo com a
service role key, que ignora RLS.

### RPCs para o agente no N8N

```sql
-- contexto da loja a partir do par conta/inbox do Chatwoot
select tenant_context(1, 42);

-- estoque com ficha técnica e fotos ordenadas
select api_cars('e30fd78b-...'::uuid, 'compass', 'ativo');
-- => { "cars": [ { "brand": "JEEP", ..., "photos": [{ "url": "...", "is_cover": true }] } ] }
```

Essas funções já existiam no projeto e não foram alteradas.

## Webhook de provisionamento

Ao concluir a etapa 4, o servidor envia para `N8N_PROVISIONING_WEBHOOK_URL`:

```json
{
  "store_name": "Wissen Multimarcas",
  "owner_email": "dono@loja.com.br",
  "bot_phone": "5541999999999",
  "google_calendar_id": "primary",
  "prompt_descoberta": "...",
  "prompt_encantamento": "...",
  "prompt_fechamento": "...",
  "salespeople": [{ "name": "Marcos Vendas", "email": "marcos@loja.com.br", "role": "agent" }],
  "tenant": { "id": "...", "slug": "wise-multimarcas", "account_id": 1, "inbox_id": 42, "instance_name": "wissen-..." },
  "regras": { "aceita_troca": true, "bancos_parceiros": ["BV", "Santander"], "...": "..." },
  "horario_ia": "24h",
  "endereco": "Rua ..., 58, centro, Curitiba, PR"
}
```

## Publicando

O front (`npm run build`) é estático e roda em qualquer hospedagem (Vercel, Netlify, Cloudflare Pages).
O servidor de provisionamento precisa de um host com Node (Render, Railway, Fly.io, VPS) e das variáveis de
`server/.env.example`. Lembre de apontar `APP_URL`/`GOOGLE_REDIRECT_URI` para o domínio de produção e de
cadastrar esse mesmo redirect URI no Google Cloud Console.
