import { existsSync } from 'node:fs';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import type { DocumentKind, RecentEntry } from '@shared/documents';
import type {
  RecentFilesRepository,
  RecentQuery,
  RecordOpenInput
} from './RecentFilesRepository';

const require = createRequire(import.meta.url);

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS recent_files (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path       TEXT NOT NULL UNIQUE,
    file_name       TEXT NOT NULL,
    folder          TEXT NOT NULL,
    kind            TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    last_opened_at  TEXT NOT NULL,
    open_count      INTEGER NOT NULL DEFAULT 1,
    pinned          INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_recent_last_opened
    ON recent_files (pinned DESC, last_opened_at DESC);
`;

/**
 * SQLite compiled to WebAssembly. It is the real engine — same SQL, same file
 * format — with no native toolchain required to build the installer, which
 * matters because this ships as a self-contained .exe.
 *
 * The database is small by nature (one row per file ever opened), so the whole
 * image is flushed after each mutation through a temp-file rename. That is
 * atomic on NTFS: a crash mid-write leaves the previous listing intact rather
 * than a truncated database.
 */
export class SqliteRecentFilesRepository implements RecentFilesRepository {
  private database: Database | null = null;
  private ready: Promise<Database> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly databasePath: string) {}

  async list(query: RecentQuery = {}): Promise<RecentEntry[]> {
    const database = await this.open();
    const limit = query.limit ?? 500;
    const statement = database.prepare(
      `SELECT id, file_path, file_name, folder, kind, size_bytes,
              last_opened_at, open_count, pinned
         FROM recent_files
        ORDER BY pinned DESC, last_opened_at DESC
        LIMIT $limit`
    );
    statement.bind({ $limit: limit });

    const entries: RecentEntry[] = [];
    while (statement.step()) {
      const row = statement.getAsObject() as Record<string, unknown>;
      const filePath = String(row.file_path);
      entries.push({
        id: Number(row.id),
        filePath,
        fileName: String(row.file_name),
        folder: String(row.folder),
        kind: String(row.kind) as DocumentKind,
        sizeBytes: Number(row.size_bytes),
        lastOpenedAt: String(row.last_opened_at),
        openCount: Number(row.open_count),
        pinned: Number(row.pinned) === 1,
        exists: existsSync(filePath)
      });
    }
    statement.free();
    return entries;
  }

  async recordOpen(input: RecordOpenInput): Promise<void> {
    const database = await this.open();
    database.run(
      `INSERT INTO recent_files
         (file_path, file_name, folder, kind, size_bytes, last_opened_at, open_count)
       VALUES ($path, $name, $folder, $kind, $size, $openedAt, 1)
       ON CONFLICT(file_path) DO UPDATE SET
         file_name      = excluded.file_name,
         folder         = excluded.folder,
         kind           = excluded.kind,
         size_bytes     = excluded.size_bytes,
         last_opened_at = excluded.last_opened_at,
         open_count     = recent_files.open_count + 1`,
      {
        $path: input.filePath,
        $name: input.fileName,
        $folder: input.folder,
        $kind: input.kind,
        $size: input.sizeBytes,
        $openedAt: input.openedAt
      }
    );
    await this.flush();
  }

  async remove(filePath: string): Promise<void> {
    const database = await this.open();
    database.run('DELETE FROM recent_files WHERE file_path = $path', { $path: filePath });
    await this.flush();
  }

  async clear(): Promise<void> {
    const database = await this.open();
    database.run('DELETE FROM recent_files WHERE pinned = 0');
    await this.flush();
  }

  async setPinned(filePath: string, pinned: boolean): Promise<void> {
    const database = await this.open();
    database.run('UPDATE recent_files SET pinned = $pinned WHERE file_path = $path', {
      $pinned: pinned ? 1 : 0,
      $path: filePath
    });
    await this.flush();
  }

  async close(): Promise<void> {
    await this.writeQueue;
    this.database?.close();
    this.database = null;
    this.ready = null;
  }

  private open(): Promise<Database> {
    this.ready ??= this.load();
    return this.ready;
  }

  private async load(): Promise<Database> {
    const SQL: SqlJsStatic = await initSqlJs({
      locateFile: (file) => join(sqlJsDistDirectory(), file)
    });

    await mkdir(dirname(this.databasePath), { recursive: true });

    let database: Database;
    try {
      const existing = await readFile(this.databasePath);
      database = new SQL.Database(new Uint8Array(existing));
      database.exec('SELECT 1 FROM recent_files LIMIT 1');
    } catch {
      // No database yet, or the file on disk is unreadable. Either way the
      // listing is a cache of local history — start a fresh one rather than
      // refusing to launch.
      database = new SQL.Database();
    }

    database.exec(SCHEMA);
    this.database = database;
    return database;
  }

  /** Serialised so two rapid opens cannot interleave two full-image writes. */
  private flush(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const database = this.database;
      if (!database) return;
      const temporaryPath = `${this.databasePath}.tmp`;
      await writeFile(temporaryPath, Buffer.from(database.export()));
      await rename(temporaryPath, this.databasePath);
    });
    return this.writeQueue;
  }
}

/**
 * Resolves the folder holding sql-wasm.wasm. Inside a packaged app the module
 * lives in app.asar.unpacked, because a .wasm file cannot be streamed out of
 * an asar archive by the WebAssembly loader.
 */
const sqlJsDistDirectory = (): string =>
  dirname(require.resolve('sql.js/dist/sql-wasm.js')).replace(
    `app.asar${sep()}`,
    `app.asar.unpacked${sep()}`
  );

const sep = (): string => (process.platform === 'win32' ? '\\' : '/');
