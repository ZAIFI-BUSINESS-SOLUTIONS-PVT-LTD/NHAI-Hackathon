import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

let _db: SQLite.SQLiteDatabase | null = null;

export interface User {
  id: string;
  name: string;
  createdAt: number;
}

export interface AttendanceLog {
  id: string;
  userId: string | null;
  timestamp: number;
  authResult: boolean;
  confidence: number;
  synced: boolean;
}

export interface SyncQueueItem {
  id: string;
  recordType: string;
  payload: string;
  createdAt: number;
  retryCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabase({ name: 'zaifi.db', location: 'default' });
  return _db;
}

// ── Schema init ───────────────────────────────────────────────────────────────

export async function initDatabase(): Promise<void> {
  const db = await getDb();
  await db.executeSql(
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  );
  await db.executeSql(
    `CREATE TABLE IF NOT EXISTS face_embeddings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      embedding TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  );
  await db.executeSql(
    `CREATE TABLE IF NOT EXISTS attendance_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      timestamp INTEGER NOT NULL,
      auth_result INTEGER NOT NULL,
      confidence REAL NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    )`,
  );
  await db.executeSql(
    `CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      record_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0
    )`,
  );
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function insertUser(name: string): Promise<User> {
  const db = await getDb();
  const user: User = { id: uid(), name, createdAt: Date.now() };
  await db.executeSql(
    'INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)',
    [user.id, user.name, user.createdAt],
  );
  return user;
}

export async function getUserById(id: string): Promise<User | null> {
  const db = await getDb();
  const [result] = await db.executeSql(
    'SELECT * FROM users WHERE id = ?',
    [id],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows.item(0);
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

export async function getAllUsers(): Promise<User[]> {
  const db = await getDb();
  const [result] = await db.executeSql(
    'SELECT * FROM users ORDER BY created_at DESC',
  );
  const users: User[] = [];
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows.item(i);
    users.push({ id: row.id, name: row.name, createdAt: row.created_at });
  }
  return users;
}

// ── Face embeddings ───────────────────────────────────────────────────────────

export async function saveEmbedding(
  userId: string,
  embedding: Float32Array,
): Promise<void> {
  const db = await getDb();
  await db.executeSql(
    'INSERT INTO face_embeddings (id, user_id, embedding, created_at) VALUES (?, ?, ?, ?)',
    [uid(), userId, float32ToBase64(embedding), Date.now()],
  );
}

export async function getAllEmbeddings(): Promise<
  Array<{ userId: string; embedding: Float32Array }>
> {
  const db = await getDb();
  const [result] = await db.executeSql(
    'SELECT user_id, embedding FROM face_embeddings',
  );
  const out: Array<{ userId: string; embedding: Float32Array }> = [];
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows.item(i);
    out.push({
      userId: row.user_id,
      embedding: base64ToFloat32(row.embedding),
    });
  }
  return out;
}

// ── Attendance logs ───────────────────────────────────────────────────────────

export async function logAttendance(
  userId: string | null,
  authResult: boolean,
  confidence: number,
): Promise<AttendanceLog> {
  const db = await getDb();
  const log: AttendanceLog = {
    id: uid(),
    userId,
    timestamp: Date.now(),
    authResult,
    confidence,
    synced: false,
  };
  await db.executeSql(
    `INSERT INTO attendance_logs (id, user_id, timestamp, auth_result, confidence, synced)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [log.id, log.userId, log.timestamp, log.authResult ? 1 : 0, log.confidence, 0],
  );
  return log;
}

export async function getAttendanceLogs(limit = 50): Promise<AttendanceLog[]> {
  const db = await getDb();
  const [result] = await db.executeSql(
    'SELECT * FROM attendance_logs ORDER BY timestamp DESC LIMIT ?',
    [limit],
  );
  const logs: AttendanceLog[] = [];
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows.item(i);
    logs.push({
      id: row.id,
      userId: row.user_id,
      timestamp: row.timestamp,
      authResult: row.auth_result === 1,
      confidence: row.confidence,
      synced: row.synced === 1,
    });
  }
  return logs;
}

export async function getUnsyncedLogs(): Promise<AttendanceLog[]> {
  const db = await getDb();
  const [result] = await db.executeSql(
    'SELECT * FROM attendance_logs WHERE synced = 0 ORDER BY timestamp ASC',
  );
  const logs: AttendanceLog[] = [];
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows.item(i);
    logs.push({
      id: row.id,
      userId: row.user_id,
      timestamp: row.timestamp,
      authResult: row.auth_result === 1,
      confidence: row.confidence,
      synced: false,
    });
  }
  return logs;
}

export async function markLogSynced(id: string): Promise<void> {
  const db = await getDb();
  await db.executeSql(
    'UPDATE attendance_logs SET synced = 1 WHERE id = ?',
    [id],
  );
}

// ── Sync queue ────────────────────────────────────────────────────────────────

export async function enqueueSync(
  recordType: string,
  payload: object,
): Promise<void> {
  const db = await getDb();
  await db.executeSql(
    `INSERT INTO sync_queue (id, record_type, payload, created_at, retry_count)
     VALUES (?, ?, ?, ?, 0)`,
    [uid(), recordType, JSON.stringify(payload), Date.now()],
  );
}

export async function getSyncQueue(): Promise<SyncQueueItem[]> {
  const db = await getDb();
  const [result] = await db.executeSql(
    'SELECT * FROM sync_queue ORDER BY created_at ASC',
  );
  const items: SyncQueueItem[] = [];
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows.item(i);
    items.push({
      id: row.id,
      recordType: row.record_type,
      payload: row.payload,
      createdAt: row.created_at,
      retryCount: row.retry_count,
    });
  }
  return items;
}

export async function incrementRetryCount(id: string): Promise<void> {
  const db = await getDb();
  await db.executeSql(
    'UPDATE sync_queue SET retry_count = retry_count + 1 WHERE id = ?',
    [id],
  );
}

export async function removeSyncQueueItem(id: string): Promise<void> {
  const db = await getDb();
  await db.executeSql('DELETE FROM sync_queue WHERE id = ?', [id]);
}
