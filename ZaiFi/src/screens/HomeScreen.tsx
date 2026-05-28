import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { getUnsyncedLogs } from '../storage/database';

interface Props {
  navigation: { navigate: (screen: string, params?: object) => void };
}

export function HomeScreen({ navigation }: Props) {
  const [isOnline, setIsOnline]           = useState(false);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const glowAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1,   duration: 2000, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0.6, duration: 2000, useNativeDriver: true }),
      ]),
    ).start();
  }, [glowAnim]);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state: NetInfoState) => {
      setIsOnline(!!(state.isConnected && state.isInternetReachable));
    });
    NetInfo.fetch().then(s =>
      setIsOnline(!!(s.isConnected && s.isInternetReachable)),
    );
    return () => unsub();
  }, []);

  useFocusEffect(
    useCallback(() => {
      getUnsyncedLogs()
        .then(logs => setUnsyncedCount(logs.length))
        .catch(console.error);
    }, []),
  );

  return (
    <View style={styles.container}>

      {/* HERO */}
      <View style={styles.hero}>
        <Animated.View style={[styles.glowRing, { opacity: glowAnim }]} />
        <View style={styles.logoWrap}>
          <Text style={styles.logoIcon}>{'🛡'}</Text>
        </View>
        <Text style={styles.logo}>ZAi-Fi</Text>
        <Text style={styles.tagline}>Edge AI  Offline Biometric Auth</Text>
        <View style={[styles.statusPill, isOnline ? styles.pillOnline : styles.pillOffline]}>
          <View style={[styles.statusDot, isOnline ? styles.dotOnline : styles.dotOffline]} />
          <Text style={[styles.statusText, isOnline ? styles.textOnline : styles.textOffline]}>
            {isOnline ? 'Online  Sync Active' : 'Offline Ready'}
          </Text>
        </View>
      </View>

      {/* ACTION CARDS */}
      <View style={styles.actions}>

        {/* Authenticate */}
        <TouchableOpacity
          style={styles.primaryCard}
          onPress={() => navigation.navigate('Authenticate')}
          activeOpacity={0.88}
        >
          <View style={styles.cardInner}>
            <View style={[styles.cardIcon, { backgroundColor: 'rgba(0,200,150,0.18)' }]}>
              <Text style={styles.cardIconText}>{'🔍'}</Text>
            </View>
            <View style={styles.cardText}>
              <Text style={styles.primaryCardTitle}>Authenticate</Text>
              <Text style={styles.primaryCardSub}>Verify identity  &lt; 1 sec</Text>
            </View>
            <Text style={[styles.cardArrow, { color: 'rgba(0,0,0,0.4)' }]}>{'›'}</Text>
          </View>
        </TouchableOpacity>

        {/* Enroll */}
        <TouchableOpacity
          style={styles.secondaryCard}
          onPress={() => navigation.navigate('Enroll')}
          activeOpacity={0.88}
        >
          <View style={[styles.cardAccentBar, { backgroundColor: '#4B7BEC' }]} />
          <View style={styles.cardInner}>
            <View style={[styles.cardIcon, { backgroundColor: 'rgba(75,123,236,0.15)' }]}>
              <Text style={styles.cardIconText}>{'👤'}</Text>
            </View>
            <View style={styles.cardText}>
              <Text style={styles.secondaryCardTitle}>Enroll New Worker</Text>
              <Text style={styles.secondaryCardSub}>Register face for offline auth</Text>
            </View>
            <Text style={[styles.cardArrow, { color: '#4B7BEC' }]}>{'›'}</Text>
          </View>
        </TouchableOpacity>

        {/* Attendance Log */}
        <TouchableOpacity
          style={styles.secondaryCard}
          onPress={() => navigation.navigate('AttendanceLogs')}
          activeOpacity={0.88}
        >
          <View style={[styles.cardAccentBar, { backgroundColor: unsyncedCount > 0 ? '#FFB020' : '#333' }]} />
          <View style={styles.cardInner}>
            <View style={[styles.cardIcon, { backgroundColor: unsyncedCount > 0 ? 'rgba(255,176,32,0.15)' : 'rgba(80,80,80,0.2)' }]}>
              <Text style={styles.cardIconText}>{'📋'}</Text>
            </View>
            <View style={styles.cardText}>
              <Text style={styles.secondaryCardTitle}>Attendance Log</Text>
              <Text style={styles.secondaryCardSub}>
                {unsyncedCount > 0
                  ? `${unsyncedCount} record${unsyncedCount > 1 ? 's' : ''} pending sync`
                  : 'View auth history  All synced'}
              </Text>
            </View>
            <View style={styles.logRight}>
              {unsyncedCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unsyncedCount}</Text>
                </View>
              )}
              <Text style={[styles.cardArrow, { color: unsyncedCount > 0 ? '#FFB020' : '#555' }]}>{'›'}</Text>
            </View>
          </View>
        </TouchableOpacity>
      </View>

      {/* FOOTER */}
      <TouchableOpacity style={styles.footerRow} onPress={() => navigation.navigate('Settings')}>
        <Text style={styles.footerLeft}>{'⚙'}  Settings</Text>
        <Text style={styles.footerRight}>Hackathon 7.0  NHAI</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080808',
    paddingHorizontal: 22,
    justifyContent: 'space-between',
  },

  // Hero
  hero: {
    marginTop: 68,
    alignItems: 'center',
  },
  glowRing: {
    position: 'absolute',
    top: -20,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(0,200,150,0.08)',
    transform: [{ scale: 1.7 }],
  },
  logoWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#0D2B22',
    borderWidth: 1.5,
    borderColor: '#00C896',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  logoIcon: { fontSize: 28 },
  logo: {
    color: '#FFFFFF',
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: 3,
  },
  tagline: {
    color: '#555',
    fontSize: 12,
    marginTop: 5,
    letterSpacing: 0.8,
  },

  // Status pill
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 18,
    gap: 6,
  },
  pillOffline: { backgroundColor: 'rgba(0,200,150,0.08)', borderColor: '#00C896' },
  pillOnline:  { backgroundColor: 'rgba(0,136,255,0.08)', borderColor: '#0088FF' },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  dotOffline: { backgroundColor: '#00C896' },
  dotOnline:  { backgroundColor: '#0088FF' },
  statusText: { fontSize: 12, fontWeight: '600' },
  textOffline: { color: '#00C896' },
  textOnline:  { color: '#0088FF' },

  // Action cards
  actions: { gap: 12 },

  primaryCard: {
    backgroundColor: '#00C896',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  secondaryCard: {
    backgroundColor: '#111217',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E1E2A',
    paddingHorizontal: 18,
    paddingVertical: 16,
    overflow: 'hidden',
  },
  cardAccentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  cardIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconText: { fontSize: 22 },
  cardText: { flex: 1 },
  cardArrow: {
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 32,
  },

  primaryCardTitle: { color: '#000', fontSize: 18, fontWeight: '800' },
  primaryCardSub:   { color: 'rgba(0,0,0,0.55)', fontSize: 13, marginTop: 2 },
  secondaryCardTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  secondaryCardSub:   { color: '#666', fontSize: 13, marginTop: 2 },

  logRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: {
    backgroundColor: '#FFB020',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
  },
  badgeText: { color: '#000', fontSize: 11, fontWeight: '800' },

  // Footer
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 22,
    paddingHorizontal: 4,
  },
  footerLeft:  { color: '#444', fontSize: 12 },
  footerRight: { color: '#333', fontSize: 12 },
});
