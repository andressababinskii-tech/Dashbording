export function ok(data: unknown, status = 200): Response {
  return Response.json({ success: true, data }, { status })
}

export function created(data: unknown): Response {
  return ok(data, 201)
}

export function err(message: string, status = 400): Response {
  return Response.json({ success: false, error: message }, { status })
}

export function unauthorized(): Response {
  return err('Não autorizado', 401)
}

export function forbidden(): Response {
  return err('Acesso negado', 403)
}

export function notFound(entity = 'Recurso'): Response {
  return err(`${entity} não encontrado`, 404)
}

// Aliases com assinatura Hono: jsonOk(c, data) / jsonErr(c, msg, status?)
export function jsonOk(c: { json: (data: unknown, status?: number) => Response }, data: unknown, status = 200): Response {
  return c.json({ success: true, data }, status)
}

export function jsonErr(c: { json: (data: unknown, status?: number) => Response }, message: string, status = 400): Response {
  return c.json({ success: false, error: message }, status)
}
