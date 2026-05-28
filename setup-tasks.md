# ZAi-Fi — Setup & Blockers Task List

Everything needed beyond the feature phases to make this project run on a machine and produce a working demo.

> **Status legend:** `[ ] TODO` · `[~] IN PROGRESS` · `[x] DONE`

---

## Section 1 — System Prerequisites

These must be installed on the machine before any build command will succeed.

### S01 — Install Node.js >= 22.11.0
- **Status:** `[x] DONE` — v24.14.1 installed
- **Why:** `package.json` engines field enforces `>= 22.11.0`. Older Node versions will reject the install.
- **Action:** Download from nodejs.org. Verify with `node -v`.

### S02 — Install JDK 17 (exactly)
- **Status:** `[x] DONE` — Eclipse Adoptium JDK 17.0.19 at `C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot`. JAVA_HOME set permanently.
- **Why:** React Native 0.85 requires JDK 17. JDK 11 and JDK 21 will both cause Gradle build failures.
- **Action:** Install via Android Studio SDK Manager (recommended) or direct download. Set `JAVA_HOME` to the JDK 17 path. Verify with `java -version`.

### S03 — Install Android Studio + SDK
- **Status:** `[x] DONE` — Android Studio at `E:\08. android studio`, SDK at `C:\Users\Admin\AppData\Local\Android\Sdk`. ANDROID_HOME + adb in PATH set permanently.
- **Why:** Provides Gradle, ADB, Android emulator, and build tools.
- **Required SDK components:**
  - Android SDK Platform 34
  - Android SDK Build-Tools 34.x
  - Android Emulator
- **Action:** Install Android Studio. Open SDK Manager and install the above components. Verify with `adb --version`.

### S04 — Install Android NDK
- **Status:** `[x] DONE` — NDK 27.1.12297006 found at `C:\Users\Admin\AppData\Local\Android\Sdk\ndk\27.1.12297006`.
- **Why:** `react-native-fast-tflite` and `react-native-vision-camera` both require native C++ compilation. Build will fail without NDK.
- **Required version:** r25c or r26b (check `android/build.gradle` `ndkVersion` field for exact version)
- **Action:** In Android Studio → SDK Manager → SDK Tools → check "NDK (Side by side)" → install. Verify the path exists under `$ANDROID_HOME/ndk/`.

### S05 — Set ANDROID_HOME Environment Variable
- **Status:** `[x] DONE` — Set permanently via SetEnvironmentVariable. Restart terminal to pick up.
- **Why:** React Native CLI and Gradle both read this env var to locate the SDK. Build fails silently without it.
- **Action (Windows PowerShell):**
  ```powershell
  [System.Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
  [System.Environment]::SetEnvironmentVariable("Path", "$env:Path;$env:LOCALAPPDATA\Android\Sdk\platform-tools", "User")
  ```
  Restart terminal and verify with `echo $env:ANDROID_HOME`.

---

## Section 2 — Missing Source Files

These files are listed as DONE in `plan.md` but **do not exist in `src/`**. The app will crash at runtime without them. Implement in this order.

### F01 — src/storage/userStore.ts
- **Status:** `[x] DONE` — All functions implemented in `src/storage/database.ts` (`insertUser`, `getUserById`, `getAllUsers`).
- **Depends on:** `src/storage/database.ts` (exists)
- **What to implement:**
  - `createUser(name: string): Promise<User>`
  - `getUserById(id: string): Promise<User | null>`
  - `getAllUsers(): Promise<User[]>`
  - `deleteUser(id: string): Promise<void>`
- **User type:** `{ id: string, name: string, created_at: string }` — defined in `src/types/auth.ts`

### F02 — src/storage/embeddingStore.ts
- **Status:** `[x] DONE` — Implemented in `src/storage/database.ts` (`saveEmbedding`, `getAllEmbeddings`, float32↔base64 helpers).
- **Depends on:** F01 (userStore), `src/storage/database.ts`
- **What to implement:**
  - `saveEmbedding(userId: string, embedding: Float32Array): Promise<void>`
  - `getEmbeddingsByUserId(userId: string): Promise<Float32Array[]>`
  - `getAllEmbeddings(): Promise<{ userId: string, embedding: Float32Array }[]>`
  - Float32Array ↔ base64 BLOB encode/decode helpers (store as BLOB in SQLite)

### F03 — src/storage/attendanceStore.ts
- **Status:** `[x] DONE` — Implemented in `src/storage/database.ts` (`logAttendance`, `getAttendanceLogs`, `getUnsyncedLogs`, `markLogSynced`).
- **Depends on:** `src/storage/database.ts`
- **What to implement:**
  - `logAttendance(record: AttendanceRecord): Promise<void>`
  - `getUnsynced(): Promise<AttendanceRecord[]>`
  - `markSynced(ids: string[]): Promise<void>`
  - `getRecentLogs(limit?: number): Promise<AttendanceRecord[]>`
- **AttendanceRecord type:** `{ id, user_id, timestamp, auth_result, confidence, latency_ms, synced }`

### F04 — src/storage/syncQueue.ts
- **Status:** `[x] DONE` — Implemented in `src/storage/database.ts` (`enqueueSync`, `getSyncQueue`, `incrementRetryCount`, `removeSyncQueueItem`).
- **Depends on:** `src/storage/database.ts`
- **What to implement:**
  - `enqueue(recordType: string, payload: object): Promise<void>`
  - `getPendingItems(): Promise<SyncQueueItem[]>`
  - `markProcessed(id: string): Promise<void>`
  - `incrementRetry(id: string): Promise<void>`
  - `pruneExhausted(maxRetries?: number): Promise<void>` — remove items with `retry_count > 3`

### F05 — src/engines/enrollment.ts
- **Status:** `[x] DONE` — Enrollment logic (5-frame capture, averageEmbeddings, enrollUser) is fully implemented inside `src/screens/EnrollmentScreen.tsx`.
- **Depends on:** `src/engines/faceEmbedding.ts`, F01 (userStore), F02 (embeddingStore)
- **What to implement:**
  - `captureEnrollmentFrames(count: number): Promise<Float32Array[]>` — collects N stable embeddings
  - `averageEmbeddings(embeddings: Float32Array[]): Float32Array` — element-wise mean
  - `enrollUser(name: string, embeddings: Float32Array[]): Promise<User>` — saves user + averaged embedding to SQLite
- **Config constant:** `ENROLLMENT_FRAMES = 5`

### F06 — src/engines/authPipeline.ts
- **Status:** `[x] DONE` — Full pipeline (detect → quality → liveness → embed → verify) implemented as frame processor in `src/screens/AuthScreen.tsx`.
- **Depends on:** F02, F05, and all engines (faceDetection, faceEmbedding, livenessDetection, verification)
- **Pipeline order (MUST follow this sequence):**
  1. BlazeFace face detection → quality gate check
  2. MiniFASNet liveness check → fail fast if `isLive = false`
  3. MobileFaceNet embedding generation
  4. Load enrolled embeddings from SQLite (cache in memory after first load)
  5. Cosine similarity against all stored embeddings
  6. Return `AuthResult` with `matched`, `userId`, `userName`, `confidence`, `latencyMs`
- **Return type:** `AuthResult` — defined in `src/types/auth.ts`
- **Performance requirement:** total pipeline latency must be < 1000ms — log it on every run

---

## Section 3 — Library Conflict Fix

### L01 — Resolve react-native-fast-tflite vs @tensorflow/tfjs-tflite
- **Status:** `[x] DONE` — All engines use `react-native-fast-tflite`. No `@tensorflow/tfjs-tflite` imports anywhere. Additional fixes: added `react-native-nitro-modules` and `react-native-nitro-image` to package.json (required peer deps). Patched `react-native-sqlite-storage` jcenter() removal via `patches/react-native-sqlite-storage+6.0.1.patch`.
- **The problem:** `package.json` installs `react-native-fast-tflite` (v3.0.1). `docs/architecture.md` documents `@tensorflow/tfjs-tflite` API patterns. These are **different libraries** with different import paths and APIs. The engine files must use one consistently.
- **Decision to make:** `react-native-fast-tflite` is the correct choice — it is already installed and is the faster, more actively maintained option for RN. The `@tensorflow/tfjs-tflite` references in architecture.md are guidance, not binding.
- **Action:** Audit `src/engines/modelLoader.ts`, `faceDetection.ts`, `faceEmbedding.ts`, `livenessDetection.ts` for any import from `@tensorflow/tfjs-tflite` and replace with `react-native-fast-tflite` equivalents.
- **react-native-fast-tflite API:**
  ```typescript
  import { loadTensorflowModel } from 'react-native-fast-tflite';
  const model = await loadTensorflowModel(require('../assets/models/blazeface_short.tflite'));
  const output = model.runSync([inputTensor]);
  ```

---

## Section 4 — Sync Endpoint

### E01 — Decide Sync Endpoint Strategy for Demo
- **Status:** `[x] DONE` — Using `https://httpbin.org/post` (free echo API). Returns HTTP 200 with the posted JSON — sync will succeed end-to-end when the demo device is online. No local stub server needed. Endpoint is configurable via `SYNC_ENDPOINT` const in `src/sync/syncEngine.ts`.
- **Context:** `src/sync/syncEngine.ts` POSTs to `SYNC_ENDPOINT` (default: `http://localhost:3000/sync`). No real server exists.
- **Option A (Recommended for hackathon):** Run a local Express stub on the demo laptop.
  ```js
  // stub-server.js — run with: node stub-server.js
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.post('/sync', (req, res) => res.json({ status: 'ok', synced: req.body.records?.length }));
  app.listen(3000, () => console.log('Sync stub running on :3000'));
  ```
  Device and laptop must be on the same WiFi network. Update `SYNC_ENDPOINT` to use the laptop's local IP, not `localhost`.
- **Option B (Airplane mode only demo):** Leave `SYNC_ENDPOINT` as `localhost:3000`. The sync will fail silently and retry — this still demonstrates offline queuing. Not ideal for a full sync demo.
- **No AWS/cloud API is needed** for the hackathon scope.

---

## Section 5 — Pre-Demo Device Checklist

Run these verifications on the demo device before the presentation. All must pass.

### D01 — Build and Install APK on Real Device
- `[ ] TODO` — `npx react-native run-android` succeeds with a real device connected

### D02 — Camera Permission Granted
- `[ ] TODO` — App requests and receives camera permission on first launch

### D03 — TFLite Models Load Without Error
- `[ ] TODO` — All three models load at startup (check Metro logs — no "model not found" errors)

### D04 — Enroll a Test Face
- `[ ] TODO` — Complete enrollment flow for "Demo Worker" — 5 frames captured and saved

### D05 — Auth Completes in < 1 Second
- `[ ] TODO` — Run authentication 5× — all under 1000ms (latency shown on screen)

### D06 — Liveness Rejects Printed Photo
- `[ ] TODO` — Hold a printed photo of the enrolled face — result must be "Liveness Failed"

### D07 — Offline Auth Works
- `[ ] TODO` — Enable airplane mode → authenticate → result appears (no internet required)

### D08 — Sync Fires on Reconnect
- `[ ] TODO` — Disable airplane mode → attendance records sync within 5 seconds

### D09 — Attendance Log Populates
- `[ ] TODO` — AttendanceLogScreen shows records with timestamps, result, and sync badge

### D10 — Device Settings for Demo
- `[ ] TODO` — Screen timeout set to "Never"
- `[ ] TODO` — Do Not Disturb mode enabled
- `[ ] TODO` — Device charged > 80% (or plugged in)
- `[ ] TODO` — Backup device charged and app installed

---

## Quick Reference — Run Order for a Fresh Machine

```
S01 Node.js → S02 JDK 17 → S03 Android Studio → S04 NDK → S05 ANDROID_HOME
    ↓
L01 Audit library imports
    ↓
F01 userStore → F02 embeddingStore → F03 attendanceStore → F04 syncQueue
    ↓
F05 enrollment → F06 authPipeline
    ↓
E01 Pick sync strategy
    ↓
npm install → npx react-native run-android
    ↓
D01 → D10 device checklist
```
