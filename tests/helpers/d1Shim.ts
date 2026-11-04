// 測試用：用 Node 內建 SQLite（node:sqlite）模擬 D1 介面，讓 API 測試不用起 wrangler。
// 只實作本專案用到的部分：prepare/bind/first/all/run/batch。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type Value = string | number | null;

class ShimStatement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: Value[] = [],
  ) {}

  bind(...params: Value[]): ShimStatement {
    return new ShimStatement(this.db, this.sql, params);
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : { ...row }) as T;
  }

  async all<T>() {
    return { results: this.allSync() as T[], success: true, meta: {} };
  }

  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }

  allSync(): Record<string, unknown>[] {
    return (this.db.prepare(this.sql).all(...this.params) as Record<string, unknown>[]).map((r) => ({ ...r }));
  }
}

export class ShimD1 {
  readonly db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON');
    const dir = join(import.meta.dirname, '..', '..', 'migrations');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
      this.db.exec(readFileSync(join(dir, f), 'utf8'));
    }
  }

  prepare(sql: string): ShimStatement {
    return new ShimStatement(this.db, sql);
  }

  async batch(stmts: ShimStatement[]) {
    this.db.exec('BEGIN');
    try {
      // 跟 D1 一樣每一句都回 meta.changes（UPDATE 有沒有改到）
      const out = stmts.map((s) => {
        const results = s.allSync();
        const { n } = this.db.prepare('SELECT changes() AS n').get() as { n: number };
        return { results, success: true, meta: { changes: Number(n) } };
      });
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  asD1(): D1Database {
    return this as unknown as D1Database;
  }
}
