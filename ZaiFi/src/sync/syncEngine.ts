import NetInfo from '@react-native-community/netinfo';
import { getUnsyncedLogs, markLogSynced } from '../storage/database';

// Stub endpoint — replace with real backend URL before production.
// Using httpbin so the demo sync actually succeeds when online.
export const SYNC_ENDPOINT = 'https://httpbin.org/post';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 800;

export interface SyncStatus {
  isSyncing: boolean;
  pendingCount: number;
  lastSyncedCount: number;
}

type SyncListener = (status: SyncStatus) => void;

const _listeners = new Set<SyncListener>();
let _isSyncing = false;
let _unsubscribeNetInfo: (() => void) | null = null;

// Returns an unsubscribe function.
export function addSyncListener(fn: SyncListener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function emit(status: SyncStatus) {
  _listeners.forEach(fn => fn(status));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runSync(): Promise<{ synced: number; failed: number }> {
  if (_isSyncing) return { synced: 0, failed: 0 };
  _isSyncing = true;

  const logs = await getUnsyncedLogs();
  emit({ isSyncing: true, pendingCount: logs.length, lastSyncedCount: 0 });

  let synced = 0;
  let failed = 0;

  for (const log of logs) {
    let success = false;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(SYNC_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: log.id,
            userId: log.userId,
            timestamp: log.timestamp,
            authResult: log.authResult,
            confidence: log.confidence,
          }),
        });
        if (res.ok) {
          success = true;
          break;
        }
      } catch (_err) {
        if (attempt < MAX_RETRIES - 1) await sleep(RETRY_DELAY_MS);
      }
    }
    if (success) {
      await markLogSynced(log.id);
      synced++;
    } else {
      failed++;
    }
  }

  _isSyncing = false;
  emit({ isSyncing: false, pendingCount: failed, lastSyncedCount: synced });
  return { synced, failed };
}

export function startSyncEngine(): void {
  if (_unsubscribeNetInfo) return;

  _unsubscribeNetInfo = NetInfo.addEventListener(state => {
    if (state.isConnected && state.isInternetReachable) {
      runSync().catch(err => console.error('[SyncEngine] runSync error:', err));
    }
  });

  // If already online when the engine starts, attempt an immediate sync.
  NetInfo.fetch().then(state => {
    if (state.isConnected && state.isInternetReachable) {
      runSync().catch(err => console.error('[SyncEngine] initial sync error:', err));
    }
  });
}

export function stopSyncEngine(): void {
  _unsubscribeNetInfo?.();
  _unsubscribeNetInfo = null;
}
