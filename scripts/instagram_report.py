#!/usr/bin/env python3
"""
Daily Instagram Analytics Report

Analyzes all client Instagram Business accounts linked to the Meta
token and generates a comprehensive Markdown report covering:
  - Last post date and days without activity
  - Scheduled/pending posts
  - Engagement rate and follower count
  - Weekly posting frequency
  - 7-day impressions, reach, and profile views
  - Prioritised recommendations per account

Requires: META_API_TOKEN environment variable
"""

import os
import sys
import requests
from datetime import datetime, timezone, timedelta


API_TOKEN = os.environ.get("META_API_TOKEN", "")
BASE_URL = "https://graph.facebook.com/v20.0"
TODAY = datetime.now(timezone.utc)
REPORT_DATE = TODAY.strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def api_get(path: str, params: dict = None) -> dict:
    """GET from the Meta Graph API; returns {} on any error."""
    merged = dict(params or {})
    merged["access_token"] = API_TOKEN
    try:
        resp = requests.get(f"{BASE_URL}/{path}", params=merged, timeout=30)
        data = resp.json()
    except Exception as exc:
        print(f"  HTTP error on /{path}: {exc}", file=sys.stderr)
        return {}

    if "error" in data:
        err = data["error"]
        print(f"  API [{err.get('code')}] {err.get('message')}", file=sys.stderr)
        return {}

    return data


def paginate(path: str, params: dict = None, max_items: int = 50) -> list:
    """Collect all pages of a cursor-paginated endpoint."""
    items = []
    merged = dict(params or {})

    while True:
        data = api_get(path, merged)
        batch = data.get("data", [])
        items.extend(batch)
        if len(items) >= max_items or not batch:
            break
        cursor = data.get("paging", {}).get("cursors", {}).get("after")
        if not cursor:
            break
        merged["after"] = cursor

    return items[:max_items]


# ---------------------------------------------------------------------------
# Data fetchers
# ---------------------------------------------------------------------------

def get_pages() -> list:
    return paginate("me/accounts", {"fields": "id,name,instagram_business_account"})


def get_ig_details(ig_id: str) -> dict:
    return api_get(ig_id, {
        "fields": "id,name,username,biography,followers_count,media_count,website"
    })


def get_recent_media(ig_id: str, days: int = 60) -> list:
    since = (TODAY - timedelta(days=days)).strftime("%Y-%m-%d")
    return paginate(f"{ig_id}/media", {
        "fields": "id,caption,timestamp,like_count,comments_count,media_type,permalink",
        "since": since,
        "limit": 50,
    })


def get_scheduled_media(ig_id: str) -> list:
    """Attempt to fetch unpublished/scheduled content."""
    result = api_get(f"{ig_id}/media", {
        "fields": "id,caption,timestamp,media_type,status",
        "published": "false",
    })
    items = result.get("data", [])
    return [i for i in items if i.get("status") in ("SCHEDULED", "PENDING", "IN_PROGRESS")]


def get_account_insights(ig_id: str) -> dict:
    since = (TODAY - timedelta(days=7)).strftime("%Y-%m-%d")
    data = api_get(f"{ig_id}/insights", {
        "metric": "impressions,reach,profile_views",
        "period": "day",
        "since": since,
        "until": TODAY.strftime("%Y-%m-%d"),
    })
    return {
        m["name"]: sum(v.get("value", 0) for v in m.get("values", []))
        for m in data.get("data", [])
    }


# ---------------------------------------------------------------------------
# Analytics helpers
# ---------------------------------------------------------------------------

def posting_summary(posts: list) -> dict:
    timestamps = sorted(
        [
            datetime.fromisoformat(p["timestamp"].replace("Z", "+00:00"))
            for p in posts if "timestamp" in p
        ],
        reverse=True,
    )

    if not timestamps:
        return {"days_since_last": None, "last_post_date": "Nunca",
                "posts_last_30": 0, "avg_per_week": 0.0}

    last = timestamps[0]
    days_since = (TODAY - last).days
    cutoff = TODAY - timedelta(days=30)
    recent = [t for t in timestamps if t >= cutoff]

    return {
        "days_since_last": days_since,
        "last_post_date": last.strftime("%d/%m/%Y"),
        "posts_last_30": len(recent),
        "avg_per_week": round((len(recent) / 30) * 7, 1),
    }


def engagement_rate(posts: list, followers: int) -> float:
    if not posts or followers <= 0:
        return 0.0
    sample = posts[:10]
    total = sum((p.get("like_count") or 0) + (p.get("comments_count") or 0) for p in sample)
    return round((total / len(sample) / followers) * 100, 2)


def days_since_ts(ts: str) -> int:
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return (TODAY - dt).days


def fmt_ago(days) -> str:
    if days is None:
        return "nunca postou"
    if days == 0:
        return "hoje"
    if days == 1:
        return "1 dia atrás"
    return f"{days} dias atrás"


def status_icon(days, has_scheduled: bool) -> str:
    if days is None:
        return "⚫"
    if days > 14:
        return "🔴"
    if days > 7:
        return "🟡"
    if not has_scheduled:
        return "🟠"
    return "🟢"


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

def generate_report(accounts: list) -> str:
    critical = [a for a in accounts if (a["summary"].get("days_since_last") or 0) > 14]
    warning  = [a for a in accounts if 7 < (a["summary"].get("days_since_last") or 0) <= 14]
    no_sched = [a for a in accounts if not a["scheduled"]]
    ok_count = len(accounts) - len(critical) - len(warning)

    lines = [
        f"# Relatório Diário de Instagram — {REPORT_DATE}",
        f"*Gerado em: {TODAY.strftime('%d/%m/%Y às %H:%M UTC')}*",
        "",
        "---",
        "",
        "## Resumo Executivo",
        "",
        "| Indicador | Qtd |",
        "|-----------|-----|",
        f"| Total de contas monitoradas | {len(accounts)} |",
        f"| 🟢 Ativas com conteúdo agendado | {ok_count} |",
        f"| 🟠 Sem posts agendados | {len(no_sched)} |",
        f"| 🟡 Sem post há +7 dias | {len(warning)} |",
        f"| 🔴 Sem post há +14 dias (CRÍTICO) | {len(critical)} |",
        "",
    ]

    if critical:
        lines += ["### Contas Críticas — Ação Imediata Necessária"]
        for a in critical:
            d = a["summary"].get("days_since_last", "?")
            u = a["details"].get("username", "?")
            lines.append(f"- **@{u}** — {d} dias sem post")
        lines.append("")

    lines += ["---", ""]

    # Sort most-critical first
    sorted_accounts = sorted(
        accounts,
        key=lambda x: (x["summary"].get("days_since_last") or 0),
        reverse=True,
    )

    for a in sorted_accounts:
        details = a["details"]
        summary = a["summary"]
        sched   = a["scheduled"]
        posts   = a["posts"]
        insights = a["insights"]
        er      = a["engagement_rate"]

        username  = details.get("username", "desconhecido")
        followers = details.get("followers_count") or 0
        days      = summary.get("days_since_last")
        icon      = status_icon(days, bool(sched))

        lines += [
            f"## {icon} @{username} — {a['page_name']}",
            "",
            "| Métrica | Valor |",
            "|---------|-------|",
            f"| Seguidores | {followers:,} |",
            f"| Total de publicações | {details.get('media_count') or 0} |",
            f"| Último post | {summary.get('last_post_date', 'Nunca')} ({fmt_ago(days)}) |",
            f"| Posts nos últimos 30 dias | {summary.get('posts_last_30', 0)} |",
            f"| Média semanal | {summary.get('avg_per_week', 0.0)} posts/semana |",
            f"| Taxa de engajamento | {er}% |",
        ]

        if insights:
            lines.append(f"| Impressões (7d) | {insights.get('impressions', 'N/D'):,} |")
            lines.append(f"| Alcance (7d) | {insights.get('reach', 'N/D'):,} |")
            lines.append(f"| Visitas ao perfil (7d) | {insights.get('profile_views', 'N/D'):,} |")

        lines.append("")

        # Scheduled posts
        lines.append("### Posts Agendados")
        if sched:
            for s in sched:
                ts      = s.get("timestamp", "")[:10]
                mtype   = s.get("media_type", "")
                caption = (s.get("caption") or "Sem legenda")[:100]
                lines.append(f"- `{ts}` [{mtype}] {caption}")
        else:
            lines.append("**Nenhum post agendado encontrado para esta conta.**")
        lines.append("")

        # Recent posts
        lines.append("### Últimas Publicações")
        if posts:
            for p in posts[:5]:
                ts       = p.get("timestamp", "")
                d        = days_since_ts(ts) if ts else None
                caption  = (p.get("caption") or "Sem legenda")[:80]
                likes    = p.get("like_count") or 0
                comments = p.get("comments_count") or 0
                mtype    = p.get("media_type", "")
                link     = p.get("permalink", "")
                lines.append(
                    f"- **{fmt_ago(d)}** [{mtype}] "
                    f"Curtidas: {likes} / Comentários: {comments} — "
                    f"{caption}... [ver post]({link})"
                )
        else:
            lines.append("- Nenhuma publicação encontrada nos últimos 60 dias.")
        lines.append("")

        # Recommendations
        lines.append("### Pontos de Atenção e Recomendações")
        recs = []

        if days is None:
            recs.append("⚫ Conta nunca postou. Publicar o primeiro conteúdo imediatamente.")
        elif days > 14:
            recs.append(f"🔴 CRÍTICO: {days} dias sem post. Retomar postagens com urgência.")
        elif days > 7:
            recs.append(f"🟡 Parada há {days} dias. Planejar e publicar conteúdo urgente.")

        if not sched:
            recs.append("Sem posts agendados. Criar calendário editorial para as próximas 2 semanas.")

        avg = summary.get("avg_per_week", 0.0)
        if avg < 3:
            recs.append(f"Frequência baixa: {avg} posts/semana. Ideal: 4–7 posts/semana.")

        if er < 1.0 and followers > 500:
            recs.append(f"Engajamento abaixo de 1% ({er}%). Revisar tipo de conteúdo e horários.")
        elif er >= 5.0:
            recs.append(f"Excelente engajamento ({er}%)! Manter estratégia e documentar o que funciona.")

        if followers < 1000:
            recs.append("Menos de 1.000 seguidores. Investir em Reels, hashtags estratégicas e parcerias.")

        if not recs:
            recs.append("Conta em boa situação. Manter consistência e monitorar tendências.")

        for rec in recs:
            lines.append(f"- {rec}")

        lines += ["", "---", ""]

    lines.append(
        "*Relatório gerado automaticamente. "
        "[Ver histórico de relatórios](https://github.com/andressababinskii-tech/Dashbording/tree/main/reports)*"
    )

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if not API_TOKEN:
        print("Erro: META_API_TOKEN não definido.", file=sys.stderr)
        sys.exit(1)

    print(f"[{REPORT_DATE}] Iniciando análise das contas de Instagram...\n")

    pages = get_pages()
    print(f"Encontradas {len(pages)} páginas.\n")

    accounts = []

    for page in pages:
        page_name  = page.get("name", "Desconhecida")
        ig_account = page.get("instagram_business_account")

        if not ig_account:
            print(f"  Página '{page_name}' sem conta Instagram conectada — ignorada.")
            continue

        ig_id   = ig_account["id"]
        details = get_ig_details(ig_id)
        posts   = get_recent_media(ig_id)
        sched   = get_scheduled_media(ig_id)
        insights = get_account_insights(ig_id)
        summary = posting_summary(posts)
        er      = engagement_rate(posts, details.get("followers_count") or 1)

        print(
            f"  @{details.get('username', ig_id)} | "
            f"{details.get('followers_count', 0):,} seguidores | "
            f"último post: {summary.get('last_post_date', 'nunca')} | "
            f"agendados: {len(sched)}"
        )

        accounts.append({
            "page_name": page_name,
            "ig_id": ig_id,
            "details": details,
            "posts": posts,
            "scheduled": sched,
            "insights": insights,
            "summary": summary,
            "engagement_rate": er,
        })

    if not accounts:
        print("\nNenhuma conta Instagram encontrada. Verifique as permissões do token.")
        sys.exit(1)

    report = generate_report(accounts)

    os.makedirs("reports", exist_ok=True)
    report_path = f"reports/instagram_report_{REPORT_DATE}.md"

    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report)

    print(f"\nRelatório salvo: {report_path}")
    print("\n" + "=" * 60)
    print(report)


if __name__ == "__main__":
    main()
