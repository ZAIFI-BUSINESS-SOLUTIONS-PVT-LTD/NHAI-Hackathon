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
      <Text style={styles.sectionTitle}>MATCH THRESHOLD</Text>
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
      <Text style={styles.sectionTitle}>AI MODELS</Text>
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
      <Text style={styles.sectionTitle}>CONNECTIVITY</Text>
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
      <Text style={styles.sectionTitle}>PERFORMANCE TARGETS</Text>
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
    backgroundColor: '#0A0A0A',
  },
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  sectionTitle: {
    color: '#555',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 24,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#222',
    padding: 16,
  },

  // Threshold adjuster
  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  adjBtn: {
    width: 44,
    height: 44,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjBtnDisabled: {
    opacity: 0.3,
  },
  adjBtnText: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '300',
    lineHeight: 26,
  },
  thresholdValue: {
    alignItems: 'center',
  },
  thresholdNumber: {
    color: '#00C896',
    fontSize: 40,
    fontWeight: '700',
    lineHeight: 44,
  },
  thresholdPct: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  cardHint: {
    color: '#555',
    fontSize: 12,
    lineHeight: 17,
  },
  resetLink: {
    marginTop: 10,
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
    paddingVertical: 10,
  },
  modelRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C1C',
  },
  modelLeft: {
    flex: 1,
  },
  modelName: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  modelPurpose: {
    color: '#555',
    fontSize: 12,
    marginTop: 2,
  },
  modelSize: {
    color: '#888',
    fontSize: 13,
    fontWeight: '500',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  totalLabel: {
    color: '#AAA',
    fontSize: 13,
    fontWeight: '600',
  },
  totalBadge: {
    backgroundColor: 'rgba(0,200,150,0.12)',
    borderWidth: 1,
    borderColor: '#00C896',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  totalBadgeText: {
    color: '#00C896',
    fontSize: 13,
    fontWeight: '700',
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
    fontWeight: '600',
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
    paddingVertical: 9,
  },
  perfRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C1C',
  },
  perfLabel: {
    color: '#AAA',
    fontSize: 13,
  },
  perfTarget: {
    color: '#00C896',
    fontSize: 13,
    fontWeight: '600',
  },

  footer: {
    color: '#333',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 32,
  },
});
