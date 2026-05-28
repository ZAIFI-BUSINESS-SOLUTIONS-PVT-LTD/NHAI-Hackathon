# ZAi-Fi — Datalake 3.0 Integration Guide

> **Version:** Phase 8 (T19) · **Last updated:** May 2026
> Integrating ZAi-Fi adds fully-offline biometric face authentication and attendance
> logging to any React Native application in under 30 lines of code.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Quick Start](#2-quick-start)
3. [Architecture Diagram](#3-architecture-diagram)
4. [API Reference](#4-api-reference)
5. [Performance Characteristics](#5-performance-characteristics)
6. [Offline Behaviour & Sync](#6-offline-behaviour--sync)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Prerequisites

### React Native version

ZAi-Fi requires **React Native ≥ 0.73** (tested on 0.85.3) with the New Architecture
enabled (`newArchEnabled=true` in `android/gradle.properties`).

### npm install

```bash
npm install zaifi
# peer deps (skip any already installed in your host app)
npm install react-native-vision-camera@^5.0.10 \
            react-native-fast-tflite@^3.0.1 \
            react-native-sqlite-storage@^6.0.1 \
            react-native-worklets@^0.9.1 \
            @react-navigation/native@^7.2.5 \
            @react-navigation/stack@^7.9.3
```

### Android — `android/build.gradle`

```groovy
android {
    defaultConfig {
        minSdkVersion 24          // required for TFLite GPU delegate
        targetSdkVersion 36
        compileSdkVersion 36
    }
}
```

Add camera permission to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

### iOS — `ios/Podfile`

```ruby
platform :ios, '12.0'

# Required for TFLite Metal delegate
pod 'TensorFlowLiteSwift', '~> 2.14'
```

Then run:

```bash
bundle exec pod install
```

Add to `ios/<AppName>/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>ZAi-Fi needs the camera to verify worker identity.</string>
```

---

## 2. Quick Start

The complete integration — under 30 lines:

```typescript
// App.tsx (Datalake 3.0 entry point)
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

import { BiometricAuth, navigationRef } from 'zaifi/src/BiometricAuth';
import { EnrollmentScreen } from 'zaifi/src/screens/EnrollmentScreen';
import { AuthScreen }       from 'zaifi/src/screens/AuthScreen';

// Your existing Datalake 3.0 screens
import { DashboardScreen } from './src/screens/DashboardScreen';

const Stack = createStackNavigator();

export default function App() {
  useEffect(() => {
    // Step 1 — initialise once at startup
    BiometricAuth.initialize();
  }, []);

  return (
    // Step 2 — pass the navigationRef so BiometricAuth can open its screens
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator>
        {/* Your existing screens */}
        <Stack.Screen name="Dashboard" component={DashboardScreen} />

        {/* ZAi-Fi screens — register with these exact names */}
        <Stack.Screen name="ZAiFiEnroll" component={EnrollmentScreen}
          options={{ title: 'Enroll Worker' }} />
        <Stack.Screen name="ZAiFiAuth"   component={AuthScreen}
          options={{ title: 'Verify Identity' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

```typescript
// Anywhere in your Datalake 3.0 codebase:
import { BiometricAuth } from 'zaifi/src/BiometricAuth';

// Enroll a new field worker
const enroll = await BiometricAuth.enroll('Arjun Kumar');
if (enroll.success) {
  console.log(`Enrolled — userId: ${enroll.userId}`);
}

// Authenticate at a checkpoint
const auth = await BiometricAuth.authenticate();
if (auth.matched) {
  console.log(`Welcome ${auth.userName} — verified in ${auth.latencyMs}ms`);
} else {
  console.warn(`Auth failed: ${auth.failReason}`);
}

// Fetch unsynced attendance records
const logs = await BiometricAuth.getAttendanceLogs();
console.log(`${logs.length} records pending upload`);

// Upload & purge when back online
const { purgedCount } = await BiometricAuth.syncAndPurge('https://api.datalake.in/attendance/sync');
console.log(`${purgedCount} records uploaded and cleared from device`);
```

---

## 3. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Datalake 3.0 App                                 │
│                                                                         │
│   App.tsx                                                               │
│   ├── BiometricAuth.initialize()   ← opens SQLite, starts sync engine  │
│   └── <NavigationContainer ref={navigationRef}>                         │
│           ├── DashboardScreen      (your existing screen)               │
│           ├── ZAiFiEnroll ─────────────────────────────┐               │
│           └── ZAiFiAuth  ─────────────────────────┐   │               │
│                                                   │   │               │
│   Your feature code                               │   │               │
│   ├── BiometricAuth.enroll(name) ─────────────────┼───┘               │
│   ├── BiometricAuth.authenticate() ───────────────┘                    │
│   ├── BiometricAuth.getAttendanceLogs()                                 │
│   └── BiometricAuth.syncAndPurge(url)                                   │
│                                                                         │
└───────────────────────────┬─────────────────────────────────────────────┘
                            │  facade (T18: BiometricAuth/index.ts)
┌───────────────────────────▼─────────────────────────────────────────────┐
│                        ZAi-Fi Module                                    │
│                                                                         │
│  ┌─────────────────────┐   ┌──────────────────────────────────────────┐ │
│  │   EnrollmentScreen  │   │              AuthScreen                  │ │
│  │  (camera + capture) │   │  scanning → blink challenge → result     │ │
│  └────────┬────────────┘   └──────────────────┬───────────────────────┘ │
│           │                                   │                         │
│  ┌────────▼───────────────────────────────────▼───────────────────────┐ │
│  │                      Engine Layer                                  │ │
│  │  BlazeFace        MobileFaceNet     MiniFASNet      BlinkDetector  │ │
│  │  (detection)      (embedding)       (liveness)      (active)       │ │
│  │  ~600 KB          ~1.9 MB           ~1.0 MB         < 1 KB         │ │
│  └────────────────────────────┬───────────────────────────────────────┘ │
│                               │                                         │
│  ┌────────────────────────────▼───────────────────────────────────────┐ │
│  │                    Storage Layer (SQLite)                          │ │
│  │  users · face_embeddings · attendance_logs · sync_queue           │ │
│  └────────────────────────────┬───────────────────────────────────────┘ │
│                               │                                         │
│  ┌────────────────────────────▼───────────────────────────────────────┐ │
│  │               Sync Engine (background, auto-purge)                │ │
│  │  NetInfo listener → POST batch → purgeSyncedAttendanceLogs()      │ │
│  └────────────────────────────┬───────────────────────────────────────┘ │
│                               │                                         │
└───────────────────────────────┼─────────────────────────────────────────┘
                                │  HTTPS POST (when online)
                    ┌───────────▼────────────┐
                    │   Datalake 3.0 Backend │
                    │  /attendance/sync      │
                    └────────────────────────┘
```

---

## 4. API Reference

### `BiometricAuth.initialize(): Promise<void>`

Opens the SQLite database (creating tables on first run) and starts the background
sync engine. Must be called once before any other method. Safe to call on every app
launch — schema creation is idempotent.

### `BiometricAuth.enroll(name: string): Promise<EnrollResult>`

Opens the `ZAiFiEnroll` screen. The camera captures 5 face embeddings, averages them,
and stores the result under the given worker name. Resolves when enrollment succeeds
or the user navigates away.

```typescript
interface EnrollResult {
  success: boolean;
  userId?: string;   // present when success = true
  error?: string;
}
```

### `BiometricAuth.authenticate(): Promise<AuthResult>`

Opens the `ZAiFiAuth` screen. Runs the full pipeline: face detection → quality gate →
passive liveness (MiniFASNet) → active blink challenge → embedding comparison.
Resolves with the outcome.

```typescript
interface AuthResult {
  matched: boolean;
  userId?: string;
  userName?: string;
  confidence: number;      // cosine similarity, 0–1
  latencyMs: number;       // wall-clock ms from camera start to result
  failReason?: 'liveness' | 'blink_timeout' | 'no_match';
}
```

### `BiometricAuth.getAttendanceLogs(): Promise<AttendanceRecord[]>`

Returns all attendance records not yet uploaded to the server, newest first (up to 200).

```typescript
interface AttendanceRecord {
  id: string;
  userId: string | null;
  timestamp: string;              // ISO 8601
  authResult: 'pass' | 'fail';
  confidence: number;
  synced: boolean;
}
```

### `BiometricAuth.syncAndPurge(endpoint: string): Promise<{ purgedCount: number }>`

Sets the upload endpoint, POSTs all pending attendance records one-by-one (with up to
3 retries each), then DELETEs successfully uploaded records from the local database.
Returns the count of purged records. If offline or all POSTs fail, `purgedCount` is 0
and local records are preserved.

---

## 5. Performance Characteristics

| Metric                        | Value                          | Notes                                      |
|-------------------------------|--------------------------------|--------------------------------------------|
| **Total AI footprint**        | ~3.5 MB                        | BlazeFace 600 KB + MobileFaceNet 1.9 MB + MiniFASNet 1.0 MB |
| **Authentication latency**    | < 1 second                     | From first camera frame to result on mid-range device |
| **Face verification accuracy**| > 95%                          | Cosine similarity threshold 0.75           |
| **Blink detection latency**   | < 2 seconds average            | Pure luminance arithmetic, no extra model  |
| **Min RAM (Android)**         | 3 GB device                    | Tested on Redmi Note / Realme class        |
| **Min Android SDK**           | API 24 (Android 7.0)           | Required by TFLite GPU delegate            |
| **Min iOS**                   | iOS 12.0                       | Metal delegate available from iOS 11       |
| **SQLite DB size (1000 logs)**| ~150 KB                        | Per attendance record ≈ 150 bytes          |
| **Blink detection CPU cost**  | < 3 ms / frame                 | 30×15 px luminance window, no model        |
| **MobileFaceNet embedding**   | 128-dimension Float32          | Cosine similarity comparison ~0.01 ms      |

---

## 6. Offline Behaviour & Sync

ZAi-Fi is designed **offline-first**. The internet is never required for
authentication, enrollment, or attendance logging.

### What works with no network

- Face enrollment (stored in local SQLite)
- Authentication (embeddings compared locally)
- Liveness detection (both passive MiniFASNet and active blink — fully on-device)
- Attendance logging (written to `attendance_logs` table with `synced = 0`)

### What requires network

- Uploading attendance records to your backend (`syncAndPurge`)

### Automatic sync

When `initialize()` is called, the sync engine subscribes to `NetInfo`. The moment
the device reconnects to the internet, it automatically POSTs all `synced = 0`
records in chronological order. After a successful upload, records are **purged from
the device** (not just flagged) — keeping the local DB lean for long field deployments.

### Sync retry logic

Each record is retried up to **3 times** with an 800 ms back-off before being counted
as failed. Failed records remain in the DB and are retried on the next connectivity
event. This means no attendance data is ever silently dropped.

### Demo scenario

```
1. Device in airplane mode  →  Authenticate 5 workers
2. attendance_logs: 5 rows, all synced = 0
3. Turn airplane mode off   →  sync engine fires automatically
4. POST × 5 succeed (httpbin.org/post in dev; your endpoint in prod)
5. purgeSyncedAttendanceLogs() deletes all 5 rows
6. AttendanceLogScreen shows "✅ All Records Synced — 5 records synced and cleared"
```

---

## 7. Troubleshooting

**`Navigator not initialised` error from enroll() / authenticate()**
Pass the exported `navigationRef` to `<NavigationContainer ref={navigationRef}>` in
your App.tsx and ensure the `ZAiFiEnroll` / `ZAiFiAuth` screens are registered.

**Camera permission denied on Android**
Call `PermissionsAndroid.request(CAMERA)` before calling `authenticate()`, or let
`AuthScreen` / `EnrollmentScreen` handle it (they request permission automatically on mount).

**Models fail to load (`blazeface.state === 'error'`)**
Ensure `react-native-fast-tflite` native modules are linked. Run `npx react-native
clean` then rebuild. On Android, check that `abiFilters` includes `arm64-v8a`.

**Low accuracy on dark skin tones**
MobileFaceNet was trained on a mixed-demographic dataset. Ensure good frontal
lighting (≥ 50 lux). The quality gate rejects frames with luminance < 40 — ensure
the enrollment and authentication environments have similar lighting conditions.

**Sync never fires automatically**
Verify `startSyncEngine()` was called (done inside `initialize()`). Check that
`@react-native-community/netinfo` native module is linked. On iOS simulator,
NetInfo may not fire — test on a real device or call `BiometricAuth.syncAndPurge(url)`
manually after toggling airplane mode.
