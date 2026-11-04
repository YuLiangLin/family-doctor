// D1 小工具：參數裡的 undefined 一律轉 null，boolean 轉 0/1。
type Param = string | number | boolean | null | undefined;

function norm(params: Param[]): (string | number | null)[] {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

export function stmt(db: D1Database, sql: string, ...params: Param[]): D1PreparedStatement {
  return db.prepare(sql).bind(...norm(params));
}

export async function all<T>(db: D1Database, sql: string, ...params: Param[]): Promise<T[]> {
  const res = await stmt(db, sql, ...params).all<T>();
  return res.results ?? [];
}

export async function first<T>(db: D1Database, sql: string, ...params: Param[]): Promise<T | null> {
  return (await stmt(db, sql, ...params).first<T>()) ?? null;
}

export async function run(db: D1Database, sql: string, ...params: Param[]): Promise<number> {
  const res = await stmt(db, sql, ...params).run();
  return res.meta?.changes ?? 0;
}

/** SQLite 的 LIKE 參數：跳脫 % _ \ */
export function likeParam(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}
