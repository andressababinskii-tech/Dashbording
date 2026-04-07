# Setup — Dashboard AT2

## Pré-requisitos
- Node.js 18+
- Git Bash
- Conta Cloudflare (gratuita)

---

## 1. Instalar dependências

```bash
# Worker (backend)
cd dashboard-clientes/worker
npm install

# Frontend
cd ../frontend
npm install
```

---

## 2. Criar recursos Cloudflare (uma vez só)

```bash
# Instalar Wrangler globalmente
npm install -g wrangler

# Login na Cloudflare
wrangler login

# Criar banco D1
wrangler d1 create dashboard_clientes_db

# Criar namespace KV
wrangler kv:namespace create SESSIONS

# Criar bucket R2
wrangler r2 bucket create dashboard-logos
```

Copie os IDs gerados e preencha em `worker/wrangler.toml`:
```toml
database_id = "ID_RETORNADO_ACIMA"
# kv namespaces → id = "ID_RETORNADO_ACIMA"
```

---

## 3. Rodar migrations

```bash
cd worker

# Ambiente local
wrangler d1 execute dashboard_clientes_db --local --file=../migrations/0001_schema.sql
wrangler d1 execute dashboard_clientes_db --local --file=../migrations/0002_seed.sql
wrangler d1 execute dashboard_clientes_db --local --file=../migrations/0003_indexes.sql
wrangler d1 execute dashboard_clientes_db --local --file=../migrations/0004_whatsapp_logo.sql
wrangler d1 execute dashboard_clientes_db --local --file=../migrations/0005_instagram_trends_calendar.sql

# Produção (após deploy)
wrangler d1 execute dashboard_clientes_db --file=../migrations/0001_schema.sql
wrangler d1 execute dashboard_clientes_db --file=../migrations/0002_seed.sql
wrangler d1 execute dashboard_clientes_db --file=../migrations/0003_indexes.sql
wrangler d1 execute dashboard_clientes_db --file=../migrations/0004_whatsapp_logo.sql
wrangler d1 execute dashboard_clientes_db --file=../migrations/0005_instagram_trends_calendar.sql
```

---

## 4. Configurar secrets

```bash
cd worker
wrangler secret put JWT_SECRET
# (digitar um segredo longo e aleatório — ex: openssl rand -hex 32)

# Opcional: WhatsApp Z-API
wrangler secret put ZAPI_TOKEN
```

---

## 5. Testar localmente

```bash
# Terminal 1 — Worker
cd worker
wrangler dev

# Terminal 2 — Frontend
cd frontend
echo "VITE_API_URL=http://localhost:8787" > .env.local
npm run dev
```

Acesse: http://localhost:5173

Login admin padrão (seed):
- Email: `admin@at2.com.br`
- Senha: `admin123`

**Troque a senha após o primeiro login!**

---

## 6. Deploy produção

```bash
# Deploy Worker
cd worker
wrangler deploy

# Deploy Frontend (Cloudflare Pages)
cd ../frontend
npm run build

# Faça upload da pasta dist/ em:
# cloudflare.com → Pages → Create project → Upload assets
# Ou via CLI:
wrangler pages deploy dist --project-name=dashboard-agencia
```

Configure a variável de ambiente no Cloudflare Pages:
```
VITE_API_URL = https://dashboard-agencia-worker.SEU_SUBDOMINIO.workers.dev
```

---

## 7. Sync Python → Dashboard

```bash
# Criar arquivo .env no instagram_scheduler/
echo "DASHBOARD_URL=https://dashboard-agencia-worker.xxx.workers.dev" >> instagram_scheduler/.env
echo "DASHBOARD_TOKEN=SEU_JWT_ADMIN" >> instagram_scheduler/.env

# Sync completo
cd instagram_scheduler
python sync_to_cloudflare.py

# Sync individual
python sync_to_cloudflare.py instagram
python sync_to_cloudflare.py trends
python sync_to_cloudflare.py calendar
```

Para obter o JWT admin: faça login no dashboard e copie o token do localStorage (`accessToken`).

---

## Estrutura final

```
Automações Python (local)     →  sync_to_cloudflare.py  →  Cloudflare D1
  - Post scheduling                                           ↑
  - Relatórios 15 dias                                    Worker API
  - Tendências (3 dias)                                       ↑
  - Calendário editorial                               React Dashboard
  - Onboarding / Feedback                           (Cloudflare Pages)
```
