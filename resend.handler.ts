import { Context } from 'hono'
import { Env } from '../middleware/auth.middleware'
import { getSetting } from '../utils/settings'
import { jsonOk, jsonErr } from '../utils/response'

type C = Context<{ Bindings: Env }>

// Tolerância de relógio entre o Resend e o Worker (anti-replay)
const TOLERANCE_SECONDS = 5 * 60

async function ensureTable(db: D1Database) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS resend_events (
       id          TEXT PRIMARY KEY,   -- svix-id: reentregas do Resend não duplicam
       event_type  TEXT NOT NULL,
       email_id    TEXT,
       recipient   TEXT,
       subject     TEXT,
       payload     TEXT NOT NULL,
       created_at  TEXT NOT NULL DEFAULT (datetime('now'))
     )`
  ).run()
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Verifica a assinatura Svix (padrão do webhook do Resend).
 * Assina `${svix-id}.${svix-timestamp}.${body}` com HMAC-SHA256, chave = base64(secret sem "whsec_").
 * A comparação usa crypto.subtle.verify (tempo constante).
 */
async function verifySvix(
  secret: string, id: string, timestamp: string, signatureHeader: string, rawBody: string,
): Promise<boolean> {
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false

  const key = await crypto.subtle.importKey(
    'raw', b64ToBytes(secret.replace(/^whsec_/, '')),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  )
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`)

  // Header: "v1,<sig> v1,<sig2>" (mais de uma durante rotação de secret)
  for (const part of signatureHeader.split(' ')) {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) continue
    try {
      if (await crypto.subtle.verify('HMAC', key, b64ToBytes(sig), signed)) return true
    } catch { /* base64 inválido: tenta o próximo */ }
  }
  return false
}

// GET /api/admin/resend/webhook-info — URL para colar no painel do Resend
export async function getResendWebhookInfo(c: C) {
  const webhookUrl = `${new URL(c.req.url).origin}/api/webhook/resend`
  const configured = !!(await getSetting(c.env.DB, 'resend_webhook_secret') ?? c.env.RESEND_WEBHOOK_SECRET)
  return jsonOk(c, { webhookUrl, secretConfigured: configured })
}

// POST /api/webhook/resend — recebe eventos do Resend (rota PÚBLICA, protegida por assinatura)
export async function receiveResend(c: C) {
  const secret = await getSetting(c.env.DB, 'resend_webhook_secret') ?? c.env.RESEND_WEBHOOK_SECRET
  if (!secret) return jsonErr(c, 'Webhook secret não configurado', 503)

  const svixId = c.req.header('svix-id') ?? ''
  const svixTs = c.req.header('svix-timestamp') ?? ''
  const svixSig = c.req.header('svix-signature') ?? ''
  if (!svixId || !svixTs || !svixSig) return jsonErr(c, 'Unauthorized', 401)

  // Corpo CRU: a assinatura é calculada sobre os bytes exatos, não sobre o JSON re-serializado
  const rawBody = await c.req.text()
  if (!(await verifySvix(secret, svixId, svixTs, svixSig, rawBody))) {
    return jsonErr(c, 'Unauthorized', 401)
  }

  let event: { type?: string; data?: Record<string, any> }
  try { event = JSON.parse(rawBody) } catch { return jsonErr(c, 'JSON inválido', 400) }

  await ensureTable(c.env.DB)

  const data = event.data ?? {}
  const recipient = Array.isArray(data.to) ? data.to.join(', ') : (data.to ?? null)

  // INSERT OR IGNORE: o Resend reentrega em caso de timeout; svix-id garante idempotência
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO resend_events (id, event_type, email_id, recipient, subject, payload)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(svixId, event.type ?? 'unknown', data.email_id ?? null, recipient, data.subject ?? null, rawBody).run()

  // Bounce/spam: marca o lead no CRM para ninguém insistir em um e-mail morto
  if ((event.type === 'email.bounced' || event.type === 'email.complained') && recipient) {
    await c.env.DB.prepare(
      `UPDATE crm_leads
          SET notes = COALESCE(notes || char(10), '') || ?, updated_at = datetime('now')
        WHERE email = ?`
    ).bind(`[Resend] ${event.type} em ${new Date().toISOString().slice(0, 10)}`, recipient).run()
  }

  return jsonOk(c, { received: true })
}

// GET /api/admin/resend/events — histórico de eventos recebidos
export async function listResendEvents(c: C) {
  await ensureTable(c.env.DB)
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50') || 50, 200)
  const { results } = await c.env.DB
    .prepare(`SELECT id, event_type, email_id, recipient, subject, created_at
                FROM resend_events ORDER BY created_at DESC LIMIT ?`)
    .bind(limit)
    .all()
  return jsonOk(c, results)
}
