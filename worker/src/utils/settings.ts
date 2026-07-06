/**
 * Lê um valor da tabela integration_settings.
 * Retorna null se a chave não existir.
 */
export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT value FROM integration_settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>()
  return row?.value ?? null
}

/**
 * Salva (upsert) um valor na tabela integration_settings.
 */
export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(`
      INSERT INTO integration_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value      = excluded.value,
        updated_at = excluded.updated_at
    `)
    .bind(key, value)
    .run()
}
