import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import {
  getMatchThreshold,
  setMatchThreshold,
  DEFAULT_THRESHOLD,
} from '../engines/verification';

const STEP = 0.05;

const MODELS = [
  { name: 'BlazeFace',       purpose: 'Face Detection',    size: '~1.0 MB' },
  { name: 'MobileFaceNet',   purpose: 'Face Embedding',    size: '~5.0 MB' },
  { name: 'MiniFASNet v2',   purpose: 'Liveness / Anti-spoof', size: '~3.5 MB' },
];
const TOTAL_SIZE = '~9.5 MB';

const PERF_TARGETS = [
  { label: 'Auth latency',   target: '< 1 sec' },
  { label: 'Face detection', target: '< 80 ms / frame' },
  { label: 'Embedding',      target: '< 200 ms' },
  { label: 'Liveness check', target: '< 300 ms' },
  { label: 'Min device',     target: '3 GB RAM · Android 8+' },
];

export function SettingsScreen() {
  const [threshold, setThresholdState] = useState(getMatchThreshold());
  const [isOnline, setIsOnline] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setThresholdState(getMatchThreshold());
    }, []),
  );

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state: NetInfoState) => {
      setIsOnline(!!(state.isConnected && state.isInternetReachable));
    });
    NetInfo.fetch().then(s =>
      setIsOnline(!!(s.isConnected && s.isInternetReachable)),
    );
    return () => unsub();
  }, []);

  function adjustThreshold(delta: number) {
    const next = Math.round((threshold + delta) * 100) / 100;
    setMatchThreshold(next);
    setThresholdState(getMatchThreshold());
  }

  function resetThreshold() {
    setMatchThreshold(DEFAULT_THRESHOLD);
    setThresholdState(DEFAULT_THRESHOLD);
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

      {/* ── Match Threshold ─────────────────────────────────────── */}
      <View style={[styles.sectionRow]}><View style={[styles.sectionDot, { backgroundColor: '#00C896' }]} /><Text style={styles.sectionTitle}>MATCH THRESHOLD</Text></View>
      <View style={styles.card}>
        <View style={styles.thresholdRow}>
          <TouchableOpacity
            style={[styles.adjBtn, threshold <= 0.50 && styles.adjBtnDisabled]}
            onPress={() => adjustThreshold(-STEP)}
            disabled={threshold <= 0.50}
          >
            <Text style={styles.adjBtnText}>−</Text>
          </TouchableOpacity>

          <View style={styles.thresholdValue}>
            <Text style={styles.thresholdNumber}>{threshold.toFixed(2)}</Text>
            <Text style={styles.thresholdPct}>
              {Math.round(threshold * 100)}% confidence required
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.adjBtn, threshold >= 0.95 && styles.adjBtnDisabled]}
            onPress={() => adjustThreshold(STEP)}
            disabled={threshold >= 0.95}
          >
            <Text style={styles.adjBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.cardHint}>
          Minimum cosine similarity score for a face match. Range 0.50–0.95.
        </Text>

        {threshold !== DEFAULT_THRESHOLD && (
          <TouchableOpacity style={styles.resetLink} onPress={resetThreshold}>
            <Text style={styles.resetText}>Reset to default ({DEFAULT_THRESHOLD})</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── AI Models ────────────────────────────────────────────── */}
      <View style={styles.sectionRow}><View style={[styles.sectionDot, { backgroundColor: '#4B7BEC' }]} /><Text style={styles.sectionTitle}>AI MODELS</Text></View>
      <View style={styles.card}>
        {MODELS.map((m, i) => (
          <View
            key={m.name}
            style={[styles.modelRow, i < MODELS.length - 1 && styles.modelRowBorder]}
          >
            <View style={styles.modelLeft}>
              <Text style={styles.modelName}>{m.name}</Text>
              <Text style={styles.modelPurpose}>{m.purpose}</Text>
            </View>
            <Text style={styles.modelSize}>{m.size}</Text>
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total AI footprint</Text>
          <View style={styles.totalBadge}>
            <Text style={styles.totalBadgeText}>{TOTAL_SIZE}</Text>
          </View>
        </View>
      </View>

      {/* ── Connectivity ─────────────────────────────────────────── */}
      <View style={styles.sectionRow}><View style={[styles.sectionDot, { backgroundColor: '#0088FF' }]} /><Text style={styles.sectionTitle}>CONNECTIVITY</Text></View>
      <View style={styles.card}>
        <View style={styles.connRow}>
          <View style={[styles.connDot, isOnline ? styles.onlineDot : styles.offlineDot]} />
          <Text style={[styles.connText, isOnline ? styles.onlineText : styles.offlineText]}>
            {isOnline ? 'Online — Sync active' : 'Offline — Local mode'}
          </Text>
        </View>
        <Text style={styles.cardHint}>
          All authentication runs 100% on-device. Network is only used for attendance sync.
        </Text>
      </View>

      {/* ── Performance Targets ──────────────────────────────────── */}
      <View style={styles.sectionRow}><View style={[styles.sectionDot, { backgroundColor: '#FFB020' }]} /><Text style={styles.sectionTitle}>PERFORMANCE TARGETS</Text></View>
      <View style={styles.card}>
        {PERF_TARGETS.map((p, i) => (
          <View
            key={p.label}
            style={[styles.perfRow, i < PERF_TARGETS.length - 1 && styles.perfRowBorder]}
          >
            <Text style={styles.perfLabel}>{p.label}</Text>
            <Text style={styles.perfTarget}>{p.target}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.footer}>ZAi-Fi · Edge AI Biometric Auth · Hackathon 7.0</Text>
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#080808',
  },
  content: {
    padding: 20,
    paddingBottom: 52,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 10,
    gap: 8,
  },
  sectionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.8,
    color: '#888',
  },
  card: {
    backgroundColor: '#111217',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E1E2A',
    padding: 18,
    overflow: 'hidden',
  },

  // Threshold adjuster
  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  adjBtn: {
    width: 48,
    height: 48,
    backgroundColor: '#1A1A22',
    borderWidth: 1,
    borderColor: '#2A2A3A',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjBtnDisabled: {
    opacity: 0.25,
  },
  adjBtnText: {
    color: '#FFF',
    fontSize: 24,
    fontWeight: '300',
    lineHeight: 28,
  },
  thresholdValue: {
    alignItems: 'center',
  },
  thresholdNumber: {
    color: '#00C896',
    fontSize: 44,
    fontWeight: '800',
    lineHeight: 48,
  },
  thresholdPct: {
    color: '#555',
    fontSize: 12,
    marginTop: 3,
  },
  cardHint: {
    color: '#555',
    fontSize: 12,
    lineHeight: 18,
  },
  resetLink: {
    marginTop: 12,
  },
  resetText: {
    color: '#00C896',
    fontSize: 13,
  },

  // Model rows
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
  },
  modelRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#181820',
  },
  modelLeft: {
    flex: 1,
  },
  modelName: {
    color: '#EEE',
    fontSize: 14,
    fontWeight: '600',
  },
  modelPurpose: {
    color: '#555',
    fontSize: 12,
    marginTop: 3,
  },
  modelSize: {
    color: '#4B7BEC',
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: 'rgba(75,123,236,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E1E2A',
  },
  totalLabel: {
    color: '#BBB',
    fontSize: 13,
    fontWeight: '700',
  },
  totalBadge: {
    backgroundColor: 'rgba(0,200,150,0.12)',
    borderWidth: 1,
    borderColor: '#00C896',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  totalBadgeText: {
    color: '#00C896',
    fontSize: 13,
    fontWeight: '800',
  },

  // Connectivity
  connRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  },
  connDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  offlineDot: {
    backgroundColor: '#00C896',
  },
  onlineDot: {
    backgroundColor: '#0088FF',
  },
  connText: {
    fontSize: 15,
    fontWeight: '700',
  },
  offlineText: {
    color: '#00C896',
  },
  onlineText: {
    color: '#0088FF',
  },

  // Performance
  perfRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  perfRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#181820',
  },
  perfLabel: {
    color: '#999',
    fontSize: 13,
  },
  perfTarget: {
    color: '#00C896',
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: 'rgba(0,200,150,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },

  footer: {
    color: '#2A2A2A',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 36,
  },
});
