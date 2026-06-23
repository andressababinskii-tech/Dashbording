import { Context } from 'hono'
import { ok, err, notFound } from './response'
import { Env } from './auth.middleware'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
const MAX_SIZE = 2 * 1024 * 1024 // 2 MB

export async function uploadLogo(c: Context<{ Bindings: Env }>) {
  const { clientId } = c.req.param()

  const client = await c.env.DB.prepare(
    'SELECT id FROM clients WHERE id = ? AND is_active = 1'
  ).bind(clientId).first()
  if (!client) return notFound('Cliente')

  const contentType = c.req.header('Content-Type') ?? ''
  if (!ALLOWED_TYPES.includes(contentType)) {
    return err('Formato inválido. Use JPG, PNG, WebP ou SVG.')
  }

  if (!c.env.LOGOS) return err('Upload de logo não disponível. Habilite o R2 no Cloudflare Dashboard.')

  const body = await c.req.arrayBuffer()
  if (body.byteLength > MAX_SIZE) return err('Arquivo muito grande. Máximo 2 MB.')

  const ext = contentType.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg')
  const key = `logos/${clientId}.${ext}`

  await c.env.LOGOS.put(key, body, { httpMetadata: { contentType } })

  const logoUrl = `/api/logos/${clientId}.${ext}`
  await c.env.DB.prepare(
    `UPDATE clients SET logo_url = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(logoUrl, clientId).run()

  return ok({ logo_url: logoUrl })
}

export async function serveLogo(c: Context<{ Bindings: Env }>) {
  const { filename } = c.req.param()
  if (!c.env.LOGOS) return notFound('Logo')
  const key = `logos/${filename}`

  const obj = await c.env.LOGOS.get(key)
  if (!obj) return notFound('Logo')

  const contentType = obj.httpMetadata?.contentType ?? 'image/png'
  return new Response(obj.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
