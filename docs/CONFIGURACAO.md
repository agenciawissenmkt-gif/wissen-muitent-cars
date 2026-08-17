# Configuração

O painel roda sobre o projeto Supabase **wissen-cars-multitenant**
(`bhffexojdowetruhbpxs`, região sa-east-1) — o mesmo que já alimenta o fluxo do N8N.
Nada do que existia foi apagado ou renomeado.

## Como o app enxerga o banco

| O app usa | Tabela / coluna real |
| --- | --- |
| Loja do lojista logado | `stores` (`owner_id` = usuário do Google) |
| Loja do ponto de vista da IA | `tenants`, ligada por `stores.tenant_id` |
| Regras comerciais (etapa 1) | `stores.accepts_trade`, `offers_consignment`, `works_with_auction`, `has_inspection` + `inspection_type`, `partner_banks` |
| Horário da IA | `tenant_settings.horario_atendimento` (`24h` ou `18:00-08:00`) |
| Prompts das 3 fases | `tenant_agents.system_prompt`, um por `agent_type` |
| Central e WhatsApp | `tenant_channels.chatwoot_account_id`, `chatwoot_inbox_id`, `evolution_instance`, `whatsapp_number` |
| Estoque | `cars` + `car_photos` (`ordem`, `is_cover`) |
| Progresso do wizard | `stores.onboarding_step` (`perfil` → `calendar` → `chatwoot` → `evolution` → `concluido`) |

As funções `tenant_context()`, `api_cars()`, `resolve_tenant()`, `get_agent_prompt()`,
`upsert_lead()` e `match_faq()` continuam exatamente como estavam — o painel não as
altera, só lê e escreve nas tabelas que elas consultam.

## O que foi adicionado ao projeto

A migração `supabase/migrations/0002_app_layer.sql` (já aplicada) é aditiva:

1. **`stores.tenant_id`** — a ligação que faltava entre a loja e o tenant, mais as colunas
   `works_with_auction` e `partner_banks`; em `cars`, `model_year`; em `car_photos`, `storage_path`.
2. **Policies de RLS** — antes só `stores` tinha policy, então um lojista logado não conseguia
   ler os próprios veículos pelo navegador. Agora `cars`, `car_photos`, `tenants`,
   `tenant_channels`, `tenant_settings` e `tenant_agents` liberam exatamente as linhas do tenant
   vinculado à loja do usuário (função `owns_tenant`). O N8N segue com a service role, que ignora RLS.
3. **`salespeople`** e **`tenant_google_credentials`** — tabelas novas para as etapas 3 e 2.
4. **Bucket `car-photos`** — as fotos novas vão para `car-photos/<tenant_id>/<car_id>/`;
   as fotos antigas continuam apontando para a URL externa gravada em `car_photos.url`.
5. **`bootstrap_store()`** — no primeiro login de um lojista novo, cria loja + tenant +
   settings + os três agentes numa tacada só.

Isolamento conferido no banco: com o usuário dono, `cars` devolve 13 registros;
com outro usuário autenticado, devolve 0.

## Rodando

```bash
npm install
cp .env.example .env    # VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (Project Settings › API)
npm run check           # confere tabelas, funções, bucket e login do Google
npm run dev
```

Para um **projeto novo** (outro cliente), rode `0001_wissen_cars.sql` e depois
`0002_app_layer.sql`. No projeto atual, só o 0002 — o 0001 recriaria o que já existe.

## Integrações da implementação (etapas 2, 3 e 4)

Passam pelo servidor (`npm run server`), que guarda as chaves privilegiadas.
Copie `server/.env.example` para `server/.env`:

O `server/.env.example` já vem com **todas as URLs preenchidas** (Supabase, Chatwoot público,
Evolution e o webhook do n8n). Faltam só quatro segredos:

| Etapa | Variável | Onde conseguir |
| --- | --- | --- |
| Base | `SUPABASE_SERVICE_ROLE_KEY` | Project Settings › API › `service_role` |
| 2 — Google Agenda | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Google Cloud Console › Credenciais |
| 3 — Chatwoot | `CHATWOOT_PLATFORM_TOKEN` | Chatwoot › `/super_admin` › Platform Apps |
| 4 — WhatsApp | `EVOLUTION_API_KEY` | `AUTHENTICATION_API_KEY` da Evolution (EasyPanel › Environment) |

O passo a passo de cada uma, com clique por clique, está em
[`docs/CHAVES.md`](CHAVES.md). Depois de preencher:

```bash
npm run check:server
```

Ele testa cada chave contra a API de verdade e diz qual está errada, sem imprimir segredo.

Enquanto uma chave não existir, a etapa correspondente diz na tela qual variável falta —
o estoque e o dashboard seguem funcionando.

### Endereços da sua infraestrutura

| Serviço | URL |
| --- | --- |
| Chatwoot 4.13 | `https://wissen-chatwoot.2kk4lp.easypanel.host` (público) · `http://wissen_chatwoot:3000` (interno, usado por n8n e Evolution) |
| Evolution API 2.3.7 | `https://wissen-evolution-api.2kk4lp.easypanel.host` |
| n8n | `https://wissen-n8n.2kk4lp.easypanel.host` |

O painel usa a URL pública do Chatwoot para provisionar, e **não sobrescreve** o
`chatwoot_base_url` interno gravado em `tenant_settings` — ele continua sendo o endereço
certo para o n8n e a Evolution, que rodam na mesma rede Docker.

Para testar a etapa 4 (QR Code e a comemoração) sem WhatsApp real, use
`WISSEN_SIMULATE=true` em `server/.env`.

## n8n

O painel conversa com dois workflows no n8n (`wissen-n8n.2kk4lp.easypanel.host`):

| Workflow | Papel |
| --- | --- |
| **cars Multi Tenant (Supabase)** | O agente. Já chama `tenant_context(account_id, inbox_id)` e `api_cars(tenant, model, status)` direto no Supabase — tudo que o painel grava (veículos, fotos, prompts, canal) chega nele sem nenhuma alteração. |
| **Wissen Cars - Provisionamento do App** | Criado para o painel. Recebe o payload da etapa 4, ativa o tenant e sincroniza `tenant_channels` (inbox, instância, número). |

Webhook de produção do provisionamento (já ativo):

```
POST https://wissen-n8n.2kk4lp.easypanel.host/webhook/wissen-cars/provisionamento
```

Ele é tolerante a falha: se o Supabase recusar a escrita, ainda responde `200` com
`"supabase": "falhou..."`, para que a implementação não trave no painel — o erro fica
registrado na execução do n8n.

> **Pendência conhecida:** a credencial **“Supabase account”** do n8n responde
> `401 Invalid API key` para o projeto `bhffexojdowetruhbpxs`. Ela é a mesma usada pelos nós
> `Contexto do Tenant`, `Detalhes do carro` e `Buscar fotos do carro` do agente, então esses nós
> falham do mesmo jeito. Correção: abrir a credencial no n8n e preencher com o host
> `https://bhffexojdowetruhbpxs.supabase.co` e a **service_role key** desse projeto
> (Project Settings › API). Não dá para fazer isso pela API — segredos só pelo painel do n8n.

## Detalhes que valem saber

- **Chatwoot**: a conta da loja já existe (`chatwoot_account_id = 1`), mas `chatwoot_inbox_id`
  está nulo. O app preenche a inbox automaticamente quando o WhatsApp conectar na etapa 4 —
  é o par conta+inbox que o `resolve_tenant()` usa para achar a loja.
- **Prompts**: os três prompts atuais têm ~18 mil caracteres cada. A etapa 1 carrega o texto
  existente para edição; o botão "Gerar sugestão" só troca o que está na tela, e nada é
  gravado até você salvar.
- **Fotos antigas**: as 52 fotos já cadastradas apontam para `wissencars.lovable.app`. Elas
  continuam funcionando; se aquele domínio sair do ar, basta recadastrar as fotos pelo painel
  para que passem a viver no Storage do Supabase.
