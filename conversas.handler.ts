import { Context } from 'hono'
import { Env } from './auth.middleware'
import { jsonOk, jsonErr } from './response'
import { getSetting } from './settings'
import { generateId } from './id'

type C = Context<{ Bindings: Env }>

async function resolveToken(c: C): Promise<string | null> {
  return c.env.MANYCHAT_TOKEN ?? await getSetting(c.env.DB, 'manychat_token')
}

const MC_BASE = 'https://api.manychat.com'

function mcHeaders(token: string) {
  return {
    // ManyChat aceita tanto "Bearer token" quanto apenas o token direto
    'Authorization': token.startsWith('eyJ') ? `Bearer ${token}` : token,
    'Content-Type': 'application/json',
  }
}

// Safe fetch: always parses response, never throws on non-JSON
async function mcFetch(url: string, token: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...mcHeaders(token), ...(options.headers ?? {}) },
  })

  const text = await res.text()
  let data: any = null
  try { data = JSON.parse(text) } catch { data = { message: text.slice(0, 200) } }

  return { ok: res.ok, status: res.status, data }
}

// GET /api/admin/conversas/info
export async function getManyhatInfo(c: C) {
  const token = await resolveToken(c)
  if (!token) return jsonErr(c, 'Token não configurado. Acesse Integrações para configurar.', 400)

  const pageRes = await mcFetch(`${MC_BASE}/fb/page/getInfo`, token)

  // 401 = token inválido — usar 400 para não derrubar login do dashboard
  if (pageRes.status === 401) {
    return jsonErr(c, 'Token inválido — configure em Integrações', 400)
  }

  // 200 = Facebook Messenger conectado
  if (pageRes.ok) {
    return jsonOk(c, pageRes.data?.data ?? { name: 'ManyChat', id: 'connected' })
  }

  // 404 = token válido mas sem Facebook Messenger (Instagram/WhatsApp)
  if (pageRes.status === 404) {
    return jsonOk(c, { name: 'ManyChat', id: 'connected', channel: 'instagram/whatsapp' })
  }

  const msg = pageRes.data?.message ?? 'Erro ao conectar com ManyChat'
  return jsonErr(c, msg, 502)
}

// GET /api/admin/conversas/subscribers?q=&page=1
export async function listSubscribers(c: C) {
  const token = await resolveToken(c)
  if (!token) return jsonErr(c, 'MANYCHAT_TOKEN não configurado', 400)

  const q     = c.req.query('q') ?? ''
  const page  = parseInt(c.req.query('page') ?? '1')
  const count = 20

  const url = q
    ? `${MC_BASE}/fb/subscriber/search?name=${encodeURIComponent(q)}&count=${count}&page=${page}`
    : `${MC_BASE}/fb/subscriber/getList?count=${count}&page=${page}`

  const { ok, data } = await mcFetch(url, token)
  if (!ok) return jsonErr(c, data?.message ?? 'Erro ao listar contatos', 502)

  return jsonOk(c, {
    subscribers: data?.data ?? [],
    total: data?.total ?? 0,
    page,
  })
}

// GET /api/admin/conversas/subscribers/:id
export async function getSubscriber(c: C) {
  const token = await resolveToken(c)
  if (!token) return jsonErr(c, 'MANYCHAT_TOKEN não configurado', 400)

  const id = c.req.param('id')
  const { ok, data } = await mcFetch(
    `${MC_BASE}/fb/subscriber/getInfo?subscriber_id=${id}`, token
  )
  if (!ok) return jsonErr(c, data?.message ?? 'Contato não encontrado', 502)
  return jsonOk(c, data?.data ?? data)
}

// POST /api/admin/conversas/send
export async function sendManyChat(c: C) {
  const token = await resolveToken(c)
  if (!token) return jsonErr(c, 'MANYCHAT_TOKEN não configurado', 400)

  const body = await c.req.json<{
    subscriber_id: string
    subscriber_name?: string
    text: string
  }>()

  if (!body.subscriber_id || !body.text)
    return jsonErr(c, 'subscriber_id e text são obrigatórios', 400)

  const payload = {
    subscriber_id: body.subscriber_id,
    data: {
      version: 'v2',
      content: { messages: [{ type: 'text', text: body.text }] },
    },
  }

  const { ok, data } = await mcFetch(`${MC_BASE}/fb/sending/sendContent`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  if (!ok) return jsonErr(c, data?.message ?? 'Erro ao enviar mensagem', 502)

  // Registra a mensagem no log
  try {
    await c.env.DB.prepare(
      `INSERT INTO manychat_messages (id, subscriber_id, subscriber_name, direction, content, status)
       VALUES (?, ?, ?, 'outbound', ?, 'sent')`
    ).bind(generateId(), body.subscriber_id, body.subscriber_name ?? null, body.text).run()
  } catch { /* log opcional — não bloqueia o envio */ }

  return jsonOk(c, data)
}

// GET /api/admin/conversas/messages?subscriber_id=xxx
export async function listMessages(c: C) {
  const subscriberId = c.req.query('subscriber_id')
  const limit        = parseInt(c.req.query('limit') ?? '50')

  const query = subscriberId
    ? `SELECT * FROM manychat_messages WHERE subscriber_id=? ORDER BY created_at DESC LIMIT ?`
    : `SELECT * FROM manychat_messages ORDER BY created_at DESC LIMIT ?`

  const stmt = subscriberId
    ? c.env.DB.prepare(query).bind(subscriberId, limit)
    : c.env.DB.prepare(query).bind(limit)

  const { results } = await stmt.all()
  return jsonOk(c, results)
}

// POST /api/admin/conversas/sync-crm — importa subscribers do ManyChat para o CRM
export async function syncSubscribersToCRM(c: C) {
  const token = await resolveToken(c)
  if (!token) return jsonErr(c, 'MANYCHAT_TOKEN não configurado', 400)

  let page = 1
  let imported = 0
  let updated  = 0
  let errors   = 0

  // Pagina até trazer todos os subscribers (máx 10 páginas = ~200 contatos)
  while (page <= 10) {
    const { ok, data } = await mcFetch(
      `${MC_BASE}/fb/subscriber/getList?count=20&page=${page}`, token
    )
    if (!ok || !data?.data?.length) break

    for (const sub of data.data) {
      try {
        const rawName = (sub.name ?? `${sub.first_name ?? ''} ${sub.last_name ?? ''}`.trim())
        const name    = rawName || 'Lead ManyChat'
        const phone = sub.channel_data?.whatsapp_phone ?? null
        const email = sub.email ?? null

        const existing = await c.env.DB
          .prepare(`SELECT id FROM crm_leads WHERE (phone IS NOT NULL AND phone=?) OR (email IS NOT NULL AND email=?) LIMIT 1`)
          .bind(phone ?? '__none__', email ?? '__none__')
          .first<{ id: string }>()

        if (existing) {
          await c.env.DB.prepare(
            `UPDATE crm_leads SET
               name=COALESCE(NULLIF(name,''),?),
               phone=COALESCE(phone,?),
               email=COALESCE(email,?),
               updated_at=datetime('now')
             WHERE id=?`
          ).bind(name, phone, email, existing.id).run()
          updated++
        } else {
          await c.env.DB.prepare(
            `INSERT INTO crm_leads (id, name, phone, email, stage, notes)
             VALUES (?, ?, ?, ?, 'prospeccao', 'Importado do ManyChat')`
          ).bind(generateId(), name, phone, email).run()
          imported++
        }
      } catch { errors++ }
    }

    if (data.data.length < 20) break
    page++
  }

  return jsonOk(c, { imported, updated, errors, pages: page - 1 })
}

// GET /api/admin/conversas/flows
export async function listFlows(c: C) {
  const token = await resolveToken(c)
  if (!token) return jsonErr(c, 'MANYCHAT_TOKEN não configurado', 400)

  const { ok, data } = await mcFetch(`${MC_BASE}/fb/flow/getFlows`, token)
  if (!ok) return jsonErr(c, data?.message ?? 'Erro ao listar flows', 502)
  return jsonOk(c, data?.data ?? [])
}

// POST /api/admin/conversas/trigger
export async function triggerFlow(c: C) {
  const token = await resolveToken(c)
  if (!token) return jsonErr(c, 'MANYCHAT_TOKEN não configurado', 400)

  const body = await c.req.json<{ subscriber_id: string; flow_ns: string }>()
  const { ok, data } = await mcFetch(`${MC_BASE}/fb/sending/sendFlow`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!ok) return jsonErr(c, data?.message ?? 'Erro ao disparar flow', 502)
  return jsonOk(c, data)
}

// GET /api/admin/conversas/tags
export async function listTags(c: C) {
  const token = await resolveToken(c)
  if (!token) return jsonErr(c, 'MANYCHAT_TOKEN não configurado', 400)

  const { ok, data } = await mcFetch(`${MC_BASE}/fb/tag/getTags`, token)
  if (!ok) return jsonErr(c, data?.message ?? 'Erro ao listar tags', 502)
  return jsonOk(c, data?.data ?? [])
}

// POST /api/admin/conversas/tag
export async function addTag(c: C) {
  const token = await resolveToken(c)
  if (!token) return jsonErr(c, 'MANYCHAT_TOKEN não configurado', 400)

  const body = await c.req.json<{ subscriber_id: string; tag_id: number }>()
  const { ok, data } = await mcFetch(`${MC_BASE}/fb/subscriber/addTag`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!ok) return jsonErr(c, data?.message ?? 'Erro ao adicionar tag', 502)
  return jsonOk(c, data)
}
