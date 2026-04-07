#!/usr/bin/env bash
# ============================================================
# 4FUN Marketing — Deploy completo no Cloudflare
# Execute: bash deploy.sh
# ============================================================
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo ""
echo "======================================"
echo "  4FUN Marketing — Deploy Cloudflare"
echo "======================================"
echo ""

# ── 1. Verificar token ─────────────────────────────────────
if ! wrangler whoami &>/dev/null; then
  echo "❌  Não autenticado. Configure o token primeiro:"
  echo "    export CLOUDFLARE_API_TOKEN=seu_token_aqui"
  echo "    ou execute: wrangler login"
  exit 1
fi

ACCOUNT=$(wrangler whoami 2>&1 | grep "Account ID" | head -1)
echo "✅  Autenticado: $ACCOUNT"

# ── 2. Criar banco D1 ─────────────────────────────────────
echo ""
echo "[1/6] Criando banco D1..."
D1_OUTPUT=$(wrangler d1 create dashboard_clientes_db 2>&1 || true)

# Extrai database_id do output
DB_ID=$(echo "$D1_OUTPUT" | grep -oP 'database_id\s*=\s*"\K[^"]+' || true)

if [ -z "$DB_ID" ]; then
  # Banco já existe — busca o ID existente
  echo "      (banco já existe, buscando ID...)"
  DB_ID=$(wrangler d1 list 2>&1 | grep "dashboard_clientes_db" | awk '{print $1}' || true)
fi

if [ -z "$DB_ID" ]; then
  echo "❌  Não foi possível obter o ID do banco D1. Verifique manualmente."
  exit 1
fi

echo "      D1 ID: $DB_ID"

# ── 3. Criar KV ────────────────────────────────────────────
echo ""
echo "[2/6] Criando namespace KV (sessões)..."
KV_OUTPUT=$(wrangler kv:namespace create SESSIONS 2>&1 || true)
KV_ID=$(echo "$KV_OUTPUT" | grep -oP 'id\s*=\s*"\K[^"]+' || true)

if [ -z "$KV_ID" ]; then
  echo "      (KV já existe, buscando ID...)"
  KV_ID=$(wrangler kv:namespace list 2>&1 | python3 -c "
import sys, json
data = json.load(sys.stdin)
for ns in data:
    if 'SESSIONS' in ns.get('title',''):
        print(ns['id'])
        break
" 2>/dev/null || true)
fi

echo "      KV ID: $KV_ID"

# ── 4. Criar R2 ────────────────────────────────────────────
echo ""
echo "[3/6] Criando bucket R2 (logos)..."
wrangler r2 bucket create dashboard-logos 2>&1 | grep -v "^$" || true
echo "      R2: dashboard-logos"

# ── 5. Atualizar wrangler.toml ─────────────────────────────
echo ""
echo "[4/6] Atualizando wrangler.toml..."

TOML="$ROOT/worker/wrangler.toml"

# Substitui database_id
sed -i "s|database_id = \"SUBSTITUA_APOS_CRIAR_COM_WRANGLER\"|database_id = \"$DB_ID\"|g" "$TOML"

# Substitui KV id
# A segunda ocorrência de SUBSTITUA é o KV
python3 - <<PYEOF
import re

with open('$TOML', 'r') as f:
    content = f.read()

# Substitui apenas o segundo SUBSTITUA (que é o KV id)
count = [0]
def replacer(m):
    count[0] += 1
    if count[0] == 1:
        return f'id = "$KV_ID"'
    return m.group(0)

content = re.sub(r'id = "SUBSTITUA_APOS_CRIAR_COM_WRANGLER"', replacer, content)

with open('$TOML', 'w') as f:
    f.write(content)
print("      wrangler.toml atualizado.")
PYEOF

# ── 6. JWT Secret ──────────────────────────────────────────
echo ""
echo "[5/6] Configurando JWT_SECRET..."
JWT=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "$JWT" | wrangler secret put JWT_SECRET --config "$ROOT/worker/wrangler.toml" 2>&1 | tail -2

# ── 7. Migrations ──────────────────────────────────────────
echo ""
echo "[6/6] Aplicando migrations do banco..."
wrangler d1 execute dashboard_clientes_db --file "$ROOT/migrations/0001_schema.sql"
wrangler d1 execute dashboard_clientes_db --file "$ROOT/migrations/0002_seed.sql"
wrangler d1 execute dashboard_clientes_db --file "$ROOT/migrations/0003_indexes.sql"
wrangler d1 execute dashboard_clientes_db --file "$ROOT/migrations/0004_whatsapp_logo.sql"
echo "      Migrations aplicadas."

# ── 8. Deploy Worker ───────────────────────────────────────
echo ""
echo "[7/7] Deploy do Worker (API)..."
cd "$ROOT/worker"
npm run deploy 2>&1 | tail -5

WORKER_URL=$(wrangler deploy --dry-run 2>&1 | grep "https://" | head -1 | awk '{print $NF}' || true)
echo "      Worker URL: $WORKER_URL"

# ── 9. Atualizar VITE_API_URL ──────────────────────────────
if [ -n "$WORKER_URL" ]; then
  echo "VITE_API_URL=$WORKER_URL" > "$ROOT/frontend/.env.production"
  echo "      .env.production atualizado."
fi

# ── 10. Deploy Frontend ────────────────────────────────────
echo ""
echo "[8/8] Build e deploy do Frontend..."
cd "$ROOT/frontend"
npm run build 2>&1 | tail -3
wrangler pages deploy dist --project-name dashboard-agencia 2>&1 | tail -5

echo ""
echo "======================================"
echo "  ✅  DEPLOY CONCLUÍDO!"
echo "======================================"
echo ""
echo "  🌐 Dashboard: https://dashboard-agencia.pages.dev"
echo "  📧 Login admin: admin@suaagencia.com.br"
echo "  🔑 Senha inicial: Admin@2026  (ALTERE IMEDIATAMENTE)"
echo ""
echo "  ⚠️  Copie seu logo para:"
echo "     frontend/public/logo-4fun.png"
echo "     e faça um novo deploy: cd frontend && npm run build"
echo "     wrangler pages deploy dist --project-name dashboard-agencia"
echo ""
