/**
 * Relatório diário de todas as contas Instagram ativas:
 * - Métricas de engajamento
 * - Dias sem postar (via Graph API)
 * - Posts agendados nos próximos 14 dias
 * - Status (ok / atenção / crítico) e insights por conta
 * Armazena em daily_reports e envia resumo via WhatsApp se configurado.
 */

import { Context } from 'hono'
import { Env } from '../middleware/auth.middleware'
import { jsonOk, jsonErr } from '../utils/response'
import { newId } from '../utils/id'

const GRAPH = 'https://graph.facebook.com/v21.0'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScheduledPost {
  scheduled_date: string
  day_of_week:    string | null
  format:         string | null
  theme:          string | null
  status:         string | null
}

export interface AccountReport {
  username:                string
  nicho:                   string | null
  followers:               number
  following:               number
  avg_likes:               number
  avg_comments:            number
  engagement_rate:         number
  last_post_date:          string | null
  days_without_post:       number | null
  scheduled_next_14_days:  number
  next_posts:              ScheduledPost[]
  status:                  'ok' | 'atenção' | 'crítico'
  insights:                string[]
}

export interface DailyReport {
  id:                  string
  generated_at:        string
  date:                string
  total_accounts:      number
  accounts_ok:         number
  accounts_attention:  number
  accounts_critical:   number
  critical_accounts:   string[]
  attention_accounts:  string[]
  accounts:            AccountReport[]
  whatsapp_summary:    string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function graphGet(
  path: string,
  token: string,
  params: Record<string, string> = {}
): Promise<Record<string, unknown> | null> {
  try {
    const url = new URL(`${GRAPH}${path}`)
    url.searchParams.set('access_token', token)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const r = await fetch(url.toString())
    if (!r.ok) return null
    return r.json() as Promise<Record<string, unknown>>
  } catch {
    return null
  }
}

function daysSince(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000)
}

function buildInsights(
  acc: Record<string, unknown>,
  daysSincePost: number | null,
  scheduled: number
): string[] {
  const ins: string[] = []

  if (daysSincePost === null) {
    ins.push('❓ Sem registro de última postagem via API')
  } else if (daysSincePost === 0) {
    ins.push('✅ Postou hoje')
  } else if (daysSincePost <= 3) {
    ins.push(`✅ Último post há ${daysSincePost} dia(s)`)
  } else if (daysSincePost <= 7) {
    ins.push(`⚠️ ${daysSincePost} dias sem postar — revisar frequência`)
  } else {
    ins.push(`🚨 ${daysSincePost} dias sem postar — ação urgente!`)
  }

  const eng = Number(acc.engagement_rate ?? 0)
  if (eng >= 5)      ins.push(`✅ Engajamento excelente: ${eng}%`)
  else if (eng >= 3) ins.push(`📊 Engajamento ok: ${eng}%`)
  else if (eng > 0)  ins.push(`⚠️ Engajamento baixo (${eng}%) — revisar tipo de conteúdo`)

  if (scheduled === 0) {
    ins.push('🚨 Sem posts agendados nos próximos 14 dias')
  } else if (scheduled <= 2) {
    ins.push(`⚠️ Apenas ${scheduled} post(s) agendado(s) para os próximos 14 dias`)
  } else {
    ins.push(`📅 ${scheduled} posts agendados para os próximos 14 dias`)
  }

  const followers = Number(acc.followers ?? 0)
  if (followers >= 10_000)     ins.push(`🌟 ${followers.toLocaleString('pt-BR')} seguidores`)
  else if (followers >= 1_000) ins.push(`👥 ${followers.toLocaleString('pt-BR')} seguidores`)

  return ins
}

function computeStatus(
  daysSincePost: number | null,
  scheduled: number,
  eng: number
): 'ok' | 'atenção' | 'crítico' {
  if (scheduled === 0 || (daysSincePost !== null && daysSincePost > 10)) return 'crítico'
  if (scheduled <= 2 || (daysSincePost !== null && daysSincePost > 4) || eng < 2) return 'atenção'
  return 'ok'
}

// ─── Core: gerador do relatório ───────────────────────────────────────────────

export async function generateDailyReport(env: Env): Promise<DailyReport> {
  const { results: accounts } = await env.DB.prepare(
    `SELECT * FROM instagram_accounts WHERE is_active = 1 ORDER BY username ASC`
  ).all() as { results: Record<string, unknown>[] }

  const today = new Date().toISOString().slice(0, 10)
  const in14d = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)

  // Token Meta: DB settings > variável de ambiente
  const metaTokenRow = await env.DB.prepare(
    `SELECT value FROM integration_settings WHERE key = 'meta_access_token'`
  ).first<{ value: string }>().catch(() => null)
  const metaToken: string | undefined = metaTokenRow?.value ?? env.FB_USER_TOKEN

  const critical: string[]          = []
  const attention: string[]         = []
  const accountReports: AccountReport[] = []

  for (const acc of accounts) {
    const username = acc.username as string

    // Posts agendados nos próximos 14 dias
    const { results: calRows } = await env.DB.prepare(
      `SELECT scheduled_date, day_of_week, format, theme, status
       FROM calendar_entries
       WHERE username = ? AND scheduled_date BETWEEN ? AND ?
       ORDER BY scheduled_date ASC LIMIT 20`
    ).bind(username, today, in14d).all() as { results: Record<string, unknown>[] }

    // Última postagem via Graph API
    let lastPostDate: string | null = null
    const pageId = acc.facebook_page_id as string | null

    if (metaToken && pageId) {
      const ptData    = await graphGet(`/${pageId}`, metaToken, { fields: 'access_token' })
      const pageToken = (ptData?.access_token as string | undefined) ?? metaToken

      const igData = await graphGet(`/${pageId}`, pageToken, { fields: 'instagram_business_account' })
      const igId   = (igData?.instagram_business_account as { id?: string } | undefined)?.id

      if (igId) {
        const media = await graphGet(`/${igId}/media`, pageToken, { fields: 'timestamp', limit: '1' })
        const posts = (media?.data as Array<{ timestamp?: string }> | undefined) ?? []
        lastPostDate = posts[0]?.timestamp ?? null
      }
    }

    const daysSincePost = lastPostDate ? daysSince(lastPostDate) : null
    const scheduled     = calRows.length
    const eng           = Number(acc.engagement_rate ?? 0)
    const status        = computeStatus(daysSincePost, scheduled, eng)
    const insights      = buildInsights(acc, daysSincePost, scheduled)

    if (status === 'crítico')      critical.push(username)
    else if (status === 'atenção') attention.push(username)

    accountReports.push({
      username,
      nicho:                  (acc.nicho as string | null) ?? null,
      followers:              Number(acc.followers ?? 0),
      following:              Number(acc.following ?? 0),
      avg_likes:              Number(acc.avg_likes ?? 0),
      avg_comments:           Number(acc.avg_comments ?? 0),
      engagement_rate:        eng,
      last_post_date:         lastPostDate,
      days_without_post:      daysSincePost,
      scheduled_next_14_days: scheduled,
      next_posts: calRows.slice(0, 5).map(r => ({
        scheduled_date: r.scheduled_date as string,
        day_of_week:    (r.day_of_week as string | null) ?? null,
        format:         (r.format     as string | null) ?? null,
        theme:          (r.theme      as string | null) ?? null,
        status:         (r.status     as string | null) ?? null,
      })),
      status,
      insights,
    })
  }

  const totalOk   = accountReports.filter(a => a.status === 'ok').length
  const totalAtt  = attention.length
  const totalCrit = critical.length

  // ── Resumo formatado para WhatsApp ─────────────────────────────────────────
  const dateStr = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  })

  const lines: string[] = [
    `📊 *RELATÓRIO DIÁRIO — ${dateStr.toUpperCase()}*`,
    ``,
    `📌 Contas ativas: ${accounts.length}`,
    `✅ OK: ${totalOk}   ⚠️ Atenção: ${totalAtt}   🚨 Crítico: ${totalCrit}`,
    ``,
  ]

  if (critical.length)  lines.push(`🚨 *AÇÃO URGENTE:* ${critical.join(', ')}`)
  if (attention.length) lines.push(`⚠️ *ATENÇÃO:* ${attention.join(', ')}`)
  if (critical.length || attention.length) lines.push('')

  for (const ar of accountReports) {
    const icon    = ar.status === 'crítico' ? '🚨' : ar.status === 'atenção' ? '⚠️' : '✅'
    const daysStr = ar.days_without_post !== null
      ? `${ar.days_without_post}d sem post`
      : 'sem data de post'
    lines.push(`${icon} *@${ar.username}*`)
    lines.push(`   └ ${daysStr} | Eng ${ar.engagement_rate}% | ${ar.followers.toLocaleString('pt-BR')} seg.`)
    if (ar.next_posts.length > 0) {
      const next  = ar.next_posts[0]
      const label = next.theme ?? next.format ?? 'sem tema'
      lines.push(`   └ 📅 Próximo: ${next.scheduled_date} — ${label}`)
    } else {
      lines.push(`   └ ⚠️ Sem posts agendados`)
    }
  }

  const reportId = newId()
  const report: DailyReport = {
    id:                  reportId,
    generated_at:       new Date().toISOString(),
    date:               today,
    total_accounts:     accounts.length,
    accounts_ok:        totalOk,
    accounts_attention: totalAtt,
    accounts_critical:  totalCrit,
    critical_accounts:  critical,
    attention_accounts: attention,
    accounts:           accountReports,
    whatsapp_summary:   lines.join('\n'),
  }

  // Persistir no banco (best-effort)
  try {
    await env.DB.prepare(`
      INSERT INTO daily_reports (id, date, generated_at, report_json)
      VALUES (?, ?, datetime('now'), ?)
      ON CONFLICT(date) DO UPDATE SET
        id           = excluded.id,
        generated_at = excluded.generated_at,
        report_json  = excluded.report_json
    `).bind(reportId, today, JSON.stringify(report)).run()
  } catch { /* tabela ainda não migrada — silencioso */ }

  return report
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────

// GET /api/admin/reports/daily
export async function getDailyReport(c: Context<{ Bindings: Env }>) {
  try {
    const row = await c.env.DB.prepare(
      `SELECT report_json FROM daily_reports ORDER BY generated_at DESC LIMIT 1`
    ).first<{ report_json: string }>()

    if (row) return jsonOk(c, JSON.parse(row.report_json) as DailyReport)

    // Sem relatório salvo — gera na hora
    const report = await generateDailyReport(c.env)
    return jsonOk(c, report)
  } catch (e: any) {
    return jsonErr(c, `Erro ao buscar relatório: ${e?.message ?? String(e)}`, 500)
  }
}

// GET /api/admin/reports  — histórico (últimos N dias)
export async function listDailyReports(c: Context<{ Bindings: Env }>) {
  try {
    const limit = Math.min(Number(c.req.query('limit') ?? '30'), 90)
    const { results } = await c.env.DB.prepare(
      `SELECT id, date, generated_at,
              json_extract(report_json, '$.total_accounts')    AS total_accounts,
              json_extract(report_json, '$.accounts_ok')       AS accounts_ok,
              json_extract(report_json, '$.accounts_attention') AS accounts_attention,
              json_extract(report_json, '$.accounts_critical') AS accounts_critical
       FROM daily_reports
       ORDER BY date DESC LIMIT ?`
    ).bind(limit).all()
    return jsonOk(c, results)
  } catch {
    return jsonOk(c, [])
  }
}

// POST /api/admin/reports/generate  — força geração imediata
export async function triggerDailyReport(c: Context<{ Bindings: Env }>) {
  try {
    const report = await generateDailyReport(c.env)
    return jsonOk(c, report)
  } catch (e: any) {
    return jsonErr(c, `Erro ao gerar relatório: ${e?.message ?? String(e)}`, 500)
  }
}
