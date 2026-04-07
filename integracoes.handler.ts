import { Context } from 'hono'
import { Env } from '../middleware/auth.middleware'
import { jsonOk, jsonErr } from '../utils/response'
import { getSetting, setSetting } from '../utils/settings'

type C = Context<{ Bindings: Env }>

// Definição dos campos de cada integração
const SCHEMA: Record<string, { label: string; fields: { key: string; label: string; secret: boolean }[] }> = {
  meta: {
    label: 'Meta (Facebook / Instagram Ads)',
    fields: [
      { key: 'meta_access_token',       label: 'Access Token',          secret: true  },
      { key: 'meta_app_secret',          label: 'App Secret',            secret: true  },
      { key: 'meta_business_account_id', label: 'Business Account ID',  secret: false },
      { key: 'meta_pixel_id',            label: 'Pixel ID',              secret: false },
    ],
  },
  notion: {
    label: 'Notion',
    fields: [
      { key: 'notion_api_key',              label: 'API Key (Integration Token)', secret: true  },
      { key: 'notion_relatorio_db_id',      label: 'Database ID — Relatórios',    secret: false },
      { key: 'notion_tendencias_db_id',     label: 'Database ID — Tendências',    secret: false },
      { key: 'notion_calendario_db_id',     label: 'Database ID — Calendário',    secret: false },
    ],
  },
  manychat: {
    label: 'ManyChat',
    fields: [
      { key: 'manychat_token', label: 'API Token', secret: true },
    ],
  },
}

function maskValue(v: string | null): string | null {
  if (!v || v.length < 8) return v ? '••••' : null
  return `${v.slice(0, 4)}${'•'.repeat(Math.min(v.length - 8, 20))}${v.slice(-4)}`
}

// GET /api/admin/integracoes — retorna status + valores mascarados
export async function getIntegracoes(c: C) {
  try {
    // Uma única query para buscar todos os settings de uma vez
    const { results } = await c.env.DB
      .prepare('SELECT key, value FROM integration_settings')
      .all<{ key: string; value: string }>()

    const stored: Record<string, string> = {}
    for (const row of results) stored[row.key] = row.value

    const result: Record<string, {
      label: string
      connected: boolean
      fields: { key: string; label: string; secret: boolean; value: string | null; masked: string | null }[]
    }> = {}

    for (const [service, schema] of Object.entries(SCHEMA)) {
      const fields = []
      let allFilled = true

      for (const field of schema.fields) {
        const raw = stored[field.key] ?? null
        if (!raw && field.secret) allFilled = false
        fields.push({
          key: field.key,
          label: field.label,
          secret: field.secret,
          value: field.secret ? null : raw,
          masked: field.secret ? maskValue(raw) : null,
        })
      }

      result[service] = { label: schema.label, connected: allFilled, fields }
    }

    return jsonOk(c, result)
  } catch (e: any) {
    console.error('getIntegracoes error:', e)
    return jsonErr(c, `Erro interno: ${e?.message ?? String(e)}`, 500)
  }
}

type SchemaField = { key: string; label: string; secret: boolean }

// PUT /api/admin/integracoes/:service — salva tokens de uma integração
export async function saveIntegracao(c: C) {
  const service = c.req.param('service') ?? ''
  const schema = SCHEMA[service] as (typeof SCHEMA)[string] | undefined
  if (!schema) return jsonErr(c, `Serviço desconhecido: ${service}`, 400)

  const body = await c.req.json<Record<string, string>>()
  const validKeys = new Set(schema.fields.map((f: SchemaField) => f.key))

  const saved: string[] = []
  for (const [k, v] of Object.entries(body)) {
    if (!validKeys.has(k)) continue
    if (typeof v !== 'string') continue
    const trimmed = v.trim()
    if (trimmed) {
      await setSetting(c.env.DB, k, trimmed)
      saved.push(k)
    }
  }

  return jsonOk(c, { saved, service })
}

// POST /api/admin/integracoes/:service/test — testa a conexão
export async function testIntegracao(c: C) {
  const service = c.req.param('service')

  if (service === 'manychat') {
    const token = await getSetting(c.env.DB, 'manychat_token') ?? c.env.MANYCHAT_TOKEN
    if (!token) return jsonErr(c, 'Token não configurado', 400)

    const res = await fetch('https://api.manychat.com/fb/page/getInfo', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const text = await res.text()
    let data: any = null
    try { data = JSON.parse(text) } catch { /* não é JSON */ }

    // "Wrong token" = chave de perfil, não de bot — token salvo mas escopo errado
    if (res.status === 401) {
      const msg = data?.message ?? ''
      if (msg === 'Wrong token') {
        return jsonErr(c, 'Chave de perfil detectada. Use a chave do BOT: ManyChat → selecione seu bot → Settings → API', 400)
      }
      return jsonErr(c, 'Token inválido — verifique a API Key no ManyChat', 400)
    }
    if (res.status === 404) {
      return jsonOk(c, { ok: true, info: { name: 'ManyChat conectado', status: 'connected' } })
    }
    if (!res.ok) {
      return jsonErr(c, (data?.message ?? text.slice(0, 120)) || 'Erro desconhecido', 400)
    }
    const name = data?.data?.name ?? data?.name ?? 'ManyChat'
    return jsonOk(c, { ok: true, info: { name, status: 'connected' } })
  }

  if (service === 'notion') {
    const apiKey = await getSetting(c.env.DB, 'notion_api_key') ?? c.env.NOTION_TOKEN
    if (!apiKey) return jsonErr(c, 'API Key não configurada', 400)

    const res = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
      },
    })
    const text = await res.text()
    let data: any = null
    try { data = JSON.parse(text) } catch { /* não é JSON */ }

    if (!res.ok) {
      const msg = data?.message ?? text.slice(0, 120)
      return jsonErr(c, msg || 'Chave inválida', 502)
    }
    return jsonOk(c, { ok: true, info: { name: data?.name, type: data?.type } })
  }

  if (service === 'meta') {
    const token = await getSetting(c.env.DB, 'meta_access_token') ?? c.env.FB_USER_TOKEN
    if (!token) return jsonErr(c, 'Access Token não configurado', 400)

    const res = await fetch(`https://graph.facebook.com/v20.0/me?fields=id,name&access_token=${token}`)
    const text = await res.text()
    let data: any = null
    try { data = JSON.parse(text) } catch { /* não é JSON */ }

    if (!res.ok) {
      const msg = data?.error?.message ?? text.slice(0, 120)
      return jsonErr(c, msg || 'Token inválido', 502)
    }
    return jsonOk(c, { ok: true, info: { id: data?.id, name: data?.name } })
  }

  return jsonErr(c, `Teste não disponível para: ${service}`, 400)
}
