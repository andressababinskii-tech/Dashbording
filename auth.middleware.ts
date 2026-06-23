import { Context, Next } from 'hono'
import { verifyToken, JwtPayload } from './jwt'
import { unauthorized } from './response'

export type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  LOGOS?: R2Bucket
  JWT_SECRET: string
  FRONTEND_URL: string
  ZAPI_INSTANCE?: string
  ZAPI_TOKEN?: string
  ADMIN_WHATSAPP?: string    // número WhatsApp que recebe o relatório diário
  FB_USER_TOKEN?: string
  NOTION_TOKEN?: string
  NOTION_PAGE_ID?: string
  MANYCHAT_TOKEN?: string
}

declare module 'hono' {
  interface ContextVariableMap {
    user: JwtPayload
  }
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return unauthorized()
  }

  const token = authHeader.slice(7)
  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET)

    const sessionKey = `session:${payload.sub}:${payload.tokenId}`
    const session = await c.env.SESSIONS.get(sessionKey)
    if (!session) {
      return unauthorized()
    }

    c.set('user', payload)
    await next()
  } catch {
    return unauthorized()
  }
}

export async function adminOnly(c: Context<{ Bindings: Env }>, next: Next) {
  const user = c.get('user')
  if (user?.role !== 'admin') {
    return Response.json({ success: false, error: 'Acesso negado' }, { status: 403 })
  }
  await next()
}
