# Configuração do Relatório Diário de Instagram

Este repositório inclui um sistema automático que analisa todas as contas
de Instagram dos seus clientes e gera relatórios diários.

## O que o relatório inclui

Para cada conta de cliente:
- Status da conta (ativa, parada, crítica)
- Data do último post e quantos dias sem publicação
- Posts agendados
- Taxa de engajamento
- Impressões, alcance e visitas ao perfil (últimos 7 dias)
- Frequência de postagem (média semanal)
- Pontos de atenção e recomendações personalizadas

## Configuração inicial (obrigatória)

### 1. Adicionar o token da Meta API como secret

1. Acesse: **Settings → Secrets and variables → Actions**
2. Clique em **New repository secret**
3. Nome: `META_API_TOKEN`
4. Valor: cole o token da Meta API
5. Salve

> **Atenção:** Tokens de usuário do Meta expiram em ~60 dias.
> Para uso contínuo, gere um token de longa duração ou use um
> System User Token no Meta Business Manager.

### 2. (Opcional) Configurar envio por e-mail

Se quiser receber o relatório por e-mail:

1. Crie uma **App Password** no Google:
   - Acesse: <https://myaccount.google.com/apppasswords>
   - Gere uma senha para "Mail"
2. Adicione dois secrets no repositório:
   - `GMAIL_USER`: seu e-mail Gmail
   - `GMAIL_APP_PASSWORD`: a App Password gerada

## Como executar

- **Automático:** roda todo dia às **08:00 BRT** (11:00 UTC)
- **Manual:** vá em **Actions → Daily Instagram Report → Run workflow**
- **Relatórios salvos:** pasta `reports/` (formato Markdown)
- **Histórico de artifacts:** cada execução fica disponível por 90 dias

## Interpretar o relatório

| Ícone | Significado |
|-------|-------------|
| 🟢 | Conta ativa com conteúdo agendado |
| 🟠 | Ativa mas sem posts agendados |
| 🟡 | Sem post há mais de 7 dias |
| 🔴 | Sem post há mais de 14 dias — ação urgente |
| ⚫ | Nunca postou |

## Permissões necessárias no token da Meta

- `pages_show_list` — listar páginas
- `pages_read_engagement` — dados da página
- `instagram_basic` — dados básicos da conta IG
- `instagram_manage_insights` — métricas de alcance/impressões
- `instagram_content_publish` — verificar posts agendados
