import { Context } from 'hono'
import { Env } from './auth.middleware'
import { getSetting, setSetting } from './settings'
import { generateId } from './id'
import { jsonOk, jsonErr } from './response'

type C = Context<{ Bindings: Env }>

async function ensureWebhookSecret(db: D1Database): Promise<string> {
  let secret = await getSetting(db, 'manychat_webhook_secret')
  if (!secret) {
    const arr = new Uint8Array(16)
    crypto.getRandomValues(arr)
    secret = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
    await setSetting(db, 'manychat_webhook_secret', secret)
  }
  return secret
}

export async function getWebhookInfo(c: C) {
  const secret = await ensureWebhookSecret(c.env.DB)
  const baseUrl = new URL(c.req.url).origin
  const webhookUrl = `${baseUrl}/api/webhook/manychat?secret=${secret}`
  return jsonOk(c, { webhookUrl, secret })
}

export async function receiveManyChat(c: C) {
  const provided = c.req.query('secret') ?? c.req.header('X-Webhook-Secret') ?? ''
  const stored   = await getSetting(c.env.DB, 'manychat_webhook_secret')

  if (!stored || provided !== stored) {
    return jsonErr(c, 'Unauthorized', 401)
  }

  let body: Record<string, any> = {}
  try { body = await c.req.json() } catch { return jsonErr(c, 'JSON inválido', 400) }

  const sub = body.subscriber ?? body
  const subscriberId   = String(sub.id ?? sub.subscriber_id ?? sub.key ?? '')
  const firstName      = sub.first_name ?? ''
  const lastName       = sub.last_name  ?? ''
  const rawName        = (sub.name ?? `${firstName} ${lastName}`.trim())
  const name           = rawName || (body.name as string) || 'Lead ManyChat'
  const phone          = sub.phone ?? sub.whatsapp_phone ?? body.phone ?? null
  const email          = sub.email ?? body.email ?? null
  const eventType      = body.event ?? body.trigger ?? body.action ?? 'webhook'

  const eventId = generateId()
  await c.env.DB.prepare(
    `INSERT INTO manychat_events (id, event_type, subscriber_id, subscriber_name, phone, email, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(eventId, eventType, subscriberId, name, phone, email, JSON.stringify(body)).run()

  const existingLead = await c.env.DB
    .prepare(`SELECT id FROM crm_leads WHERE (phone IS NOT NULL AND phone=?) OR (email IS NOT NULL AND email=?) LIMIT 1`)
    .bind(phone ?? '__none__', email ?? '__none__')
    .first<{ id: string }>()

  let leadId: string
  const origem = `Origem: ManyChat (${eventType})`

  if (existingLead) {
    leadId = existingLead.id
    await c.env.DB.prepare(
      `UPDATE crm_leads SET
         phone = COALESCE(phone, ?),
         email = COALESCE(email, ?),
         updated_at = datetime('now')
       WHERE id=?`
    ).bind(phone, email, leadId).run()
  } else {
    leadId = generateId()
    await c.env.DB.prepare(
      `INSERT INTO crm_leads (id, name, phone, email, stage, notes)
       VALUES (?, ?, ?, ?, 'prospeccao', ?)`
    ).bind(leadId, name, phone, email, origem).run()
  }

  await c.env.DB.prepare(
    `UPDATE manychat_events SET crm_lead_id=? WHERE id=?`
  ).bind(leadId, eventId).run()

  return jsonOk(c, { received: true, leadId, eventId })
}

export async function listWebhookEvents(c: C) {
  const limit = parseInt(c.req.query('limit') ?? '50')
  const { results } = await c.env.DB
    .prepare(`SELECT * FROM manychat_events ORDER BY created_at DESC LIMIT ?`)
    .bind(limit)
    .all()
  return jsonOk(c, results)
}
