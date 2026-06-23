-- Migration 0006: tabela de relatórios diários Instagram
-- Executar: wrangler d1 execute dashboard_clientes_db --file=migrations/0006_daily_reports.sql

CREATE TABLE IF NOT EXISTS daily_reports (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  report_json  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(date);
