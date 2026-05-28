/**
 * BiometricAuth — ZAi-Fi Public Module API (T18)
 *
 * A clean facade over the ZAi-Fi engines. Integrators call these 5 methods
 * and never touch the underlying TFLite models, SQLite tables, or sync engine.
 *
 * USAGE IN DATALAKE 3.0 (or any React Native app):
 * ──────────────────────────────────────────────────
 *
 *  Step 1 – Wire the navigator once in your App entry (App.tsx):
 *    import { BiometricAuth } from './src/BiometricAuth';
 *    import { navigationRef } from './src/BiometricAuth';   // re-exported below
 *    ...
 *    <NavigationContainer ref={navigationRef}>
 *
 *  Step 2 – Register ZAi-Fi screens in your navigator:
 *    import { EnrollmentScreen } from 'zaifi/src/screens/EnrollmentScreen';
 *    import { AuthScreen }       from 'zaifi/src/screens/AuthScreen';
 *    <Stack.Screen name="ZAiFiEnroll"    component={EnrollmentScreen} />
 *    <Stack.Screen name="ZAiFiAuth"      component={AuthScreen} />
 *
 *  Step 3 – Use the API:
 *    await BiometricAuth.initialize();
 *    const enroll = await BiometricAuth.enroll('Arjun Kumar');
 *    const auth   = await BiometricAuth.authenticate();
 *    const logs   = await BiometricAuth.getAttendanceLogs();
 *    const sync   = await BiometricAuth.syncAndPurge('https://your-api/sync');
 */

import { createRef } from 'react';
import type { NavigationContainerRef, ParamListBase } from '@react-navigation/native';
import { initDatabase } from '../storage/database';
import { getAttendanceLogs as dbGetAttendanceLogs } from '../storage/database';
import { startSyncEngine, runSync, setSyncEndpoint } from '../sync/syncEngine';

// ── Navigation ref ────────────────────────────────────────────────────────────
// Re-export so App.tsx can pass it to <NavigationContainer ref={navigationRef}>

export const navigationRef = createRef<NavigationContainerRef<ParamListBase>>();

// ── Callback registry ─────────────────────────────────────────────────────────
// EnrollmentScreen / AuthScreen call these when they complete. App.tsx must wire
// them up; see the integration pattern at the top of this file.

let _enrollResolve: ((result: EnrollResult) => void) | null = null;
let _authResolve:   ((result: AuthResult)   => void) | null = null;

/** Called by EnrollmentScreen when enrollment succeeds or the user cancels. */
export function _resolveEnroll(result: EnrollResult): void {
  _enrollResolve?.(result);
  _enrollResolve = null;
}

/** Called by AuthScreen when authentication produces a result (pass/fail/timeout). */
export function _resolveAuth(result: AuthResult): void {
  _authResolve?.(result);
  _authResolve = null;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface EnrollResult {
  /** true if the worker was successfully enrolled */
  success: boolean;
  /** The new worker's DB id (present when success = true) */
  userId?: string;
  /** Human-readable failure reason */
  error?: string;
}

export interface AuthResult {
  /** true when the face matched an enrolled worker and liveness passed */
  matched: boolean;
  userId?: string;
  userName?: string;
  /** Cosine similarity score in [0, 1] */
  confidence: number;
  /** Wall-clock milliseconds from camera start to result */
  latencyMs: number;
  failReason?: 'liveness' | 'blink_timeout' | 'no_match';
}

export interface AttendanceRecord {
  id: string;
  userId: string | null;
  /** ISO 8601 string */
  timestamp: string;
  authResult: 'pass' | 'fail';
  confidence: number;
  synced: boolean;
}

// ── Public API ────────────────────────────────────────────────────────────────

export const BiometricAuth = {
  /**
   * Call once at app startup.
   * Opens the SQLite database, runs schema migrations, and starts the background
   * sync engine (which fires automatically when the device comes online).
   *
   * @example
   *   await BiometricAuth.initialize();
   */
  async initialize(): Promise<void> {
    await initDatabase();
    startSyncEngine();
  },

  /**
   * Navigate to the enrollment camera screen and resolve when the user
   * finishes enrolling (or cancels).
   *
   * Requires `navigationRef` to be set on <NavigationContainer> and the
   * 'ZAiFiEnroll' screen to be registered in the host app's navigator.
   *
   * @example
   *   const result = await BiometricAuth.enroll('Arjun Kumar');
   *   if (result.success) console.log('Enrolled userId:', result.userId);
   */
  enroll(name: string): Promise<EnrollResult> {
    return new Promise<EnrollResult>(resolve => {
      _enrollResolve = resolve;
      if (navigationRef.current) {
        // Pass the worker name as a route param so EnrollmentScreen can pre-fill it.
        // EnrollmentScreen must call _resolveEnroll() on completion.
        navigationRef.current.navigate('ZAiFiEnroll', {
          prefillName: name,
          onComplete: _resolveEnroll,
        } as never);
      } else {
        // Navigator not wired up — resolve with an actionable error immediately.
        resolve({
          success: false,
          error:
            'Navigator not initialised. Pass navigationRef to <NavigationContainer ref={navigationRef}>.',
        });
      }
    });
  },

  /**
   * Navigate to the authentication camera screen and resolve when the auth
   * flow completes (pass, fail, or blink timeout).
   *
   * Requires `navigationRef` and the 'ZAiFiAuth' screen registered in the host
   * app's navigator.
   *
   * @example
   *   const auth = await BiometricAuth.authenticate();
   *   if (auth.matched) console.log(`Welcome ${auth.userName} — ${auth.latencyMs}ms`);
   */
  authenticate(): Promise<AuthResult> {
    return new Promise<AuthResult>(resolve => {
      _authResolve = resolve;
      if (navigationRef.current) {
        navigationRef.current.navigate('ZAiFiAuth', {
          onComplete: _resolveAuth,
        } as never);
      } else {
        resolve({
          matched: false,
          confidence: 0,
          latencyMs: 0,
          failReason: 'no_match',
        });
      }
    });
  },

  /**
   * Return all attendance records that have not yet been uploaded to the server.
   * Fully implemented — no navigator required.
   *
   * @example
   *   const logs = await BiometricAuth.getAttendanceLogs();
   *   console.log(`${logs.length} unsynced records`);
   */
  async getAttendanceLogs(): Promise<AttendanceRecord[]> {
    const rows = await dbGetAttendanceLogs(200);
    return rows
      .filter(r => !r.synced)
      .map(r => ({
        id:         r.id,
        userId:     r.userId,
        timestamp:  new Date(r.timestamp).toISOString(),
        authResult: r.authResult ? 'pass' : 'fail',
        confidence: r.confidence,
        synced:     r.synced,
      }));
  },

  /**
   * Set the sync endpoint, trigger an immediate upload of all pending attendance
   * records, and purge synced records from the local SQLite database.
   * Fully implemented — no navigator required.
   *
   * @param endpoint  Full URL of the POST endpoint (e.g. 'https://api.example.com/sync')
   * @returns         Number of records deleted from the device after a successful upload
   *
   * @example
   *   const { purgedCount } = await BiometricAuth.syncAndPurge('https://your-api/sync');
   *   console.log(`${purgedCount} records purged`);
   */
  async syncAndPurge(endpoint: string): Promise<{ purgedCount: number }> {
    setSyncEndpoint(endpoint);
    const { purgedCount } = await runSync();
    return { purgedCount };
  },
} as const;
