# Configuração — Relatórios Diários de Instagram

Este repositório gera automaticamente um relatório completo de todas as contas
Instagram Business dos seus clientes, todo dia às **9h BRT**.

---

## O que o relatório entrega

Para cada conta de cliente:
- Status (🟢 ativa / 🟡 alerta / 🔴 crítica / ⚫ inativa)
- Data do último post e **quantos dias sem publicar**
- Posts agendados detectados via API
- Taxa de engajamento (curtidas + comentários / seguidores)
- Impressões, alcance e visitas ao perfil (últimos 7 dias)
- Média de posts por semana
- **Pontos de atenção** e recomendações personalizadas

No topo do relatório: resumo executivo + **ações prioritárias do dia**.

---

## Configuração obrigatória — Token Meta API

1. Acesse o repositório → **Settings → Secrets and variables → Actions**
2. Clique em **New repository secret**
3. Nome: `META_API_TOKEN`
4. Valor: cole o token da Meta API (começa com `EAAa...`)
5. Salve

> **Importante:** Tokens de usuário do Meta expiram em ~60 dias.  
> Para uso contínuo sem reconfigurar, gere um **System User Token** no  
> [Meta Business Manager](https://business.facebook.com/settings/system-users)  
> com permissão de longa duração.

### Permissões necessárias no token

| Permissão | Para que serve |
|-----------|----------------|
| `pages_show_list` | Listar páginas da conta |
| `pages_read_engagement` | Dados de engajamento |
| `instagram_basic` | Dados básicos da conta IG |
| `instagram_manage_insights` | Métricas de alcance/impressões |
| `instagram_content_publish` | Detectar posts agendados |

---

## Configuração opcional — Envio por e-mail

Para receber o relatório por e-mail toda manhã:

1. Crie uma **App Password** do Gmail:
   - Acesse: <https://myaccount.google.com/apppasswords>
   - Escolha "Outro (nome personalizado)" → "Relatórios Instagram"
   - Copie a senha de 16 caracteres gerada

2. Adicione dois secrets no repositório:
   - `GMAIL_USER`: seu endereço Gmail (ex: `andressababinskii@gmail.com`)
   - `GMAIL_APP_PASSWORD`: a App Password de 16 caracteres

Se esses secrets não estiverem configurados, o relatório ainda é gerado e  
salvo na pasta `reports/` — só não é enviado por e-mail.

---

## Como funciona

| Modo | Quando |
|------|--------|
| **Automático** | Todo dia às **9h BRT** (12h UTC) |
| **Manual** | Actions → Daily Instagram Report → Run workflow |
| **Relatórios salvos** | Pasta `reports/` do repositório (Markdown) |
| **Histórico de runs** | Actions tab — cada execução fica disponível por 90 dias |

---

## Interpretando o relatório

| Ícone | Significado |
|-------|-------------|
| 🟢 | Postou recentemente E tem conteúdo agendado |
| 🟠 | Postou recentemente MAS sem agendamentos |
| 🟡 | Sem post há mais de 7 dias |
| 🔴 | Sem post há mais de 14 dias — ação urgente |
| ⚫ | Nunca postou |

---

## Estrutura dos arquivos

```
.github/workflows/
  daily_instagram_report.yml   # Automação (roda 9h BRT)
scripts/
  instagram_report.py          # Script principal de análise
reports/
  instagram_report_YYYY-MM-DD.md  # Relatórios gerados
INSTAGRAM_REPORTS_SETUP.md    # Este guia
```
