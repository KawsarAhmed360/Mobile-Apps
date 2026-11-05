/** Common synchronous SQL boundary for local Node SQLite and hosted durable SQLite. */
export interface SqlStatement {
  get(...parameters: any[]): Record<string, any> | undefined;
  all(...parameters: any[]): Record<string, any>[];
  run(...parameters: any[]): { lastInsertRowid: number | bigint; changes: number | bigint };
}
export interface SyncDatabase {
  prepare(sql: string): SqlStatement;
  exec(sql: string): void;
  close(): void;
}
