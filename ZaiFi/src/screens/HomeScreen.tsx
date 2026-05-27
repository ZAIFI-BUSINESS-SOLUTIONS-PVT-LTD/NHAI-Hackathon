import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { getUnsyncedLogs } from '../storage/database';

interface Props {
  navigation: { navigate: (screen: string) => void };
}

export function HomeScreen({ navigation }: Props) {
  const [isOnline, setIsOnline] = useState(false);
  const [unsyncedCount, setUnsyncedCount] = useState(0);

  // Live network status
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state: NetInfoState) => {
      setIsOnline(!!(state.isConnected && state.isInternetReachable));
    });
    NetInfo.fetch().then(s =>
      setIsOnline(!!(s.isConnected && s.isInternetReachable)),
    );
    return () => unsub();
  }, []);

  // Refresh pending count whenever this screen comes into focus
  useFocusEffect(
    useCallback(() => {
      getUnsyncedLogs()
        .then(logs => setUnsyncedCount(logs.length))
        .catch(console.error);
    }, []),
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>ZAi-Fi</Text>
        <Text style={styles.tagline}>Offline Biometric Authentication</Text>

        {/* Live online / offline pill */}
        <View style={[styles.statusPill, isOnline ? styles.onlinePill : styles.offlinePill]}>
          <View style={[styles.statusDot, isOnline ? styles.onlineDot : styles.offlineDot]} />
          <Text style={[styles.statusPillText, isOnline ? styles.onlineText : styles.offlineText]}>
            {isOnline ? 'Online · Sync Active' : 'Offline Ready'}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        {/* Primary: Authenticate */}
        <TouchableOpacity
          style={[styles.btn, styles.primaryBtn]}
          onPress={() => navigation.navigate('Authenticate')}
        >
          <Text style={styles.primaryBtnText}>Authenticate</Text>
          <Text style={styles.btnSub}>Verify identity in &lt; 1 sec</Text>
        </TouchableOpacity>

        {/* Secondary: Enroll */}
        <TouchableOpacity
          style={[styles.btn, styles.secondaryBtn]}
          onPress={() => navigation.navigate('Enroll')}
        >
          <Text style={styles.secondaryBtnText}>Enroll New Worker</Text>
          <Text style={[styles.btnSub, styles.secondaryBtnSub]}>
            Register face for offline auth
          </Text>
        </TouchableOpacity>

        {/* Tertiary: Attendance Log */}
        <TouchableOpacity
          style={[styles.btn, styles.secondaryBtn]}
          onPress={() => navigation.navigate('AttendanceLogs')}
        >
          <View style={styles.btnRow}>
            <Text style={styles.secondaryBtnText}>Attendance Log</Text>
            {unsyncedCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unsyncedCount}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.btnSub, styles.secondaryBtnSub]}>
            {unsyncedCount > 0
              ? `${unsyncedCount} record${unsyncedCount > 1 ? 's' : ''} pending sync`
              : 'View auth history · All synced'}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>Edge AI · No Internet Required</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    padding: 32,
    justifyContent: 'space-between',
  },
  header: {
    marginTop: 60,
    alignItems: 'center',
  },
  logo: {
    color: '#FFFFFF',
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: 2,
  },
  tagline: {
    color: '#666',
    fontSize: 14,
    marginTop: 6,
    letterSpacing: 0.5,
  },

  // Status pill
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 20,
    gap: 6,
  },
  offlinePill: {
    backgroundColor: '#0D2B22',
    borderColor: '#00C896',
  },
  onlinePill: {
    backgroundColor: '#0D1F2D',
    borderColor: '#0088FF',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  offlineDot: {
    backgroundColor: '#00C896',
  },
  onlineDot: {
    backgroundColor: '#0088FF',
  },
  statusPillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  offlineText: {
    color: '#00C896',
  },
  onlineText: {
    color: '#0088FF',
  },

  // Action buttons
  actions: {
    gap: 14,
  },
  btn: {
    borderRadius: 14,
    padding: 20,
    alignItems: 'flex-start',
  },
  primaryBtn: {
    backgroundColor: '#00C896',
  },
  secondaryBtn: {
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333',
  },
  primaryBtnText: {
    color: '#000',
    fontSize: 20,
    fontWeight: '700',
  },
  secondaryBtnText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '700',
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  badge: {
    backgroundColor: '#FFB020',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  badgeText: {
    color: '#000',
    fontSize: 11,
    fontWeight: '800',
  },
  btnSub: {
    color: 'rgba(0,0,0,0.55)',
    fontSize: 13,
    marginTop: 4,
  },
  secondaryBtnSub: {
    color: '#666',
  },

  footer: {
    color: '#333',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 16,
  },
});
