import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getAttendanceLogs,
  getAllUsers,
  type AttendanceLog,
  type User,
} from '../storage/database';
import {
  runSync,
  addSyncListener,
  type SyncStatus,
} from '../sync/syncEngine';

interface Props {
  navigation?: { goBack: () => void };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `Today ${hh}:${mm}`;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${hh}:${mm}`;
}

export function AttendanceLogScreen({ navigation }: Props) {
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [userMap, setUserMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isSyncing: false,
    pendingCount: 0,
    lastSyncedCount: 0,
  });

  const load = useCallback(async () => {
    const [fetchedLogs, users] = await Promise.all([
      getAttendanceLogs(100),
      getAllUsers(),
    ]);
    setLogs(fetchedLogs);
    setUserMap(new Map(users.map((u: User) => [u.id, u.name])));
    const pending = fetchedLogs.filter(l => !l.synced).length;
    setSyncStatus(prev => ({ ...prev, pendingCount: pending }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().finally(() => setLoading(false));
      const unsub = addSyncListener(status => {
        setSyncStatus(status);
        // Reload list after sync completes so badges update
        if (!status.isSyncing && status.lastSyncedCount > 0) {
          load().catch(console.error);
        }
      });
      return unsub;
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onSyncNow = useCallback(async () => {
    await runSync();
    await load();
  }, [load]);

  // ── Loading state ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#00C896" />
      </View>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* Sync status banner */}
      <View style={styles.syncBanner}>
        <View style={styles.syncInfo}>
          {syncStatus.isSyncing ? (
            <>
              <ActivityIndicator size="small" color="#00C896" />
              <Text style={styles.syncText}>  Syncing records…</Text>
            </>
          ) : (
            <>
              <View style={[
                styles.statusDot,
                syncStatus.pendingCount > 0 ? styles.pendingDot : styles.syncedDot,
              ]} />
              <Text style={styles.syncText}>
                {syncStatus.pendingCount > 0
                  ? `${syncStatus.pendingCount} pending sync`
                  : 'All synced'}
              </Text>
            </>
          )}
        </View>

        {!syncStatus.isSyncing && syncStatus.pendingCount > 0 && (
          <TouchableOpacity style={styles.syncNowBtn} onPress={onSyncNow}>
            <Text style={styles.syncNowText}>Sync Now</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Empty state */}
      {logs.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>No Records Yet</Text>
          <Text style={styles.emptySubText}>
            Attendance records appear here after each authentication attempt.
          </Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#00C896"
              colors={['#00C896']}
            />
          }
          renderItem={({ item }) => {
            const name = item.userId
              ? (userMap.get(item.userId) ?? 'Unknown Worker')
              : 'Unknown Worker';
            return (
              <View style={styles.row}>

                {/* PASS / FAIL badge */}
                <View style={[
                  styles.resultBadge,
                  item.authResult ? styles.passBadge : styles.failBadge,
                ]}>
                  <Text style={styles.resultBadgeText}>
                    {item.authResult ? 'PASS' : 'FAIL'}
                  </Text>
                </View>

                {/* Worker name + timestamp + confidence */}
                <View style={styles.rowBody}>
                  <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
                  <Text style={styles.rowMeta}>
                    {formatTime(item.timestamp)} · {Math.round(item.confidence * 100)}% conf
                  </Text>
                </View>

                {/* Sync status dot */}
                <View style={[
                  styles.syncBadge,
                  item.synced ? styles.syncedBadge : styles.pendingBadge,
                ]}>
                  <Text style={[
                    styles.syncBadgeText,
                    item.synced ? styles.syncedBadgeText : styles.pendingBadgeText,
                  ]}>
                    {item.synced ? '✓' : '⊙'}
                  </Text>
                </View>

              </View>
            );
          }}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  centered: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: 12,
  },
  emptyTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Sync banner
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  syncInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  pendingDot: {
    backgroundColor: '#FFB020',
  },
  syncedDot: {
    backgroundColor: '#00C896',
  },
  syncText: {
    color: '#AAA',
    fontSize: 13,
  },
  syncNowBtn: {
    backgroundColor: '#00C896',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  syncNowText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700',
  },

  // List
  list: {
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },

  // PASS / FAIL badge
  resultBadge: {
    width: 48,
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: 'center',
    marginRight: 12,
  },
  passBadge: {
    backgroundColor: 'rgba(0,200,150,0.15)',
  },
  failBadge: {
    backgroundColor: 'rgba(255,68,68,0.15)',
  },
  resultBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFF',
  },

  // Row body
  rowBody: {
    flex: 1,
  },
  rowName: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  rowMeta: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },

  // Sync status badge
  syncBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  syncedBadge: {
    backgroundColor: 'rgba(0,200,150,0.15)',
  },
  pendingBadge: {
    backgroundColor: 'rgba(255,176,32,0.15)',
  },
  syncBadgeText: {
    fontSize: 14,
    fontWeight: '700',
  },
  syncedBadgeText: {
    color: '#00C896',
  },
  pendingBadgeText: {
    color: '#FFB020',
  },
});
