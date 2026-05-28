# ZAi-Fi — Implementation Tasks (Phase 2)
## Hackathon 7.0 Compliance Gap Closure — T15–T21

> **Status legend:** `[ ] TODO` · `[~] IN PROGRESS` · `[x] DONE`
>
> Phase 1 tasks (T01–T14, all DONE) are archived in [v1/tasks.md](v1/tasks.md).
> Update status inline as you work. When a task is done, update the milestone
> table in [plan.md](plan.md) too.

---

## T15 — Eye Keypoint + Blink Signal Engine

**Status:** `[x] DONE`
**Phase:** 6 — Active Liveness Challenge
**Estimated time:** 2.5 hours
**Dependencies:** T04 (BlazeFace face detection already wired)

### Objective
Extract eye region data from camera frames using BlazeFace's existing keypoint output
and produce a reliable blink signal without adding a new TFLite model.

### Background
BlazeFace outputs 6 face keypoints. Indices 1 and 3 are the right-eye and left-eye
centers in normalised [0,1] screen coordinates. We use these to locate a small eye
ROI in the raw pixel buffer and track intensity over time to detect a genuine blink.

### Implementation

**File to create:** `ZaiFi/src/engines/blinkDetection.ts`

```typescript
// Public API this file must export:
initBlinkDetector(): BlinkDetectorState
processBlink(
  frame: Frame,
  eyeLeft: { x: number; y: number },   // from BlazeFace keypoints
  eyeRight: { x: number; y: number },
  state: BlinkDetectorState
): { blinkDetected: boolean; updatedState: BlinkDetectorState }
resetBlinkDetector(state: BlinkDetectorState): BlinkDetectorState
```

**Algorithm:**
1. Crop a 30×15 px region centred on each eye keypoint from the YUV/RGB frame buffer
2. Compute mean luminance of the cropped region (sum of R+G+B / 3 / pixel count)
3. Maintain a rolling 7-frame window of luminance values per eye
4. Blink condition: luminance drops ≥ 25% below the window baseline for 2+ consecutive
   frames, then recovers above baseline — this is the open→close→open pattern
5. Return `blinkDetected = true` on confirmed pattern; reset window after detection

**Why this approach:**
- Zero extra model weight
- Runs in < 3 ms per frame (pure arithmetic on a 30×15 region)
- False-positive resistant: requires both drop AND recovery, not just a dark frame

**Fallback (implement only if primary is unreliable on device):**
Source `face_landmark_with_attention.tflite` (~3 MB, MediaPipe) and compute
classic EAR from the 6-point eye model (indices 33,133,160,158,144,153 for left eye).

### Expected Output
- `blinkDetection.ts` exports the three functions above
- Unit test: feed a sequence of mock luminance values, verify detection triggers correctly
- On-device test: console logs blink event within 1 second of a natural blink

### Completion Criteria
- Blink event fires within 1 second of a real blink on at least 3 test subjects
- No false positive when subject holds eyes open and still for 5 seconds
- No false positive from printed photo held steady

---

## T16 — Active Blink Challenge Gate (AuthScreen)

**Status:** `[x] DONE`
**Phase:** 6 — Active Liveness Challenge
**Estimated time:** 3.5 hours
**Dependencies:** T15, T09 (MiniFASNet passive liveness)

### Objective
Wire the blink detection engine into AuthScreen as a hard gate before the embedding
step. Display a clear "Please Blink" prompt with a countdown, and integrate the result
into the existing auth result UI.

### Auth Flow After This Task

```
Face detected + quality passed
        │
        ▼ (NEW phase: 'blink')
MiniFASNet passive check (runs in background)
        │
Show "Please Blink" overlay + 5 second countdown
        │
        ├── Blink detected AND passive score > 0.7
        │       │
        │       ▼
        │   Proceed to embedding → verify → result
        │
        ├── Passive score ≤ 0.7 (spoof texture detected)
        │       │
        │       ▼
        │   Immediate "Liveness Failed" — no need to wait for blink
        │
        └── 5 second timeout (no blink)
                │
                ▼
            "Liveness Failed — Please use a real face"
```

### Changes Required

**`ZaiFi/src/screens/AuthScreen.tsx`**

1. Add `'blink'` to the `Phase` type union
2. Add `blinkState` ref (holds `BlinkDetectorState`)
3. Add `blinkTimeoutRef` (NodeJS.Timeout for the 5 s countdown)
4. In the frame processor worklet:
   - When quality passes AND not already in blink/result phase → transition to `'blink'`
   - While in `'blink'` phase: run `processBlink()` on every processed frame
   - On `blinkDetected`: cancel timeout → proceed to liveness + embedding
   - On passive score ≤ 0.7: cancel timeout → fire `onAuthResult` with liveness failure
5. In `tryAgain()`: call `resetBlinkDetector()` and clear the timeout ref
6. Add `BlinkOverlay` component (inline or separate file):
   - Animated "Please Blink" text + eye icon
   - Countdown ring (5 → 0 seconds using `Animated.timing`)
   - Green "✓" flash on blink detected (200 ms) before transitioning

**`ZaiFi/src/screens/EnrollmentScreen.tsx`**
- No change. Enrollment captures embeddings directly; blink challenge only applies to authentication.

### Expected Output
- AuthScreen has a visible "Please Blink" overlay that appears after face is detected
- Countdown timer counts down from 5
- Real face: blink within countdown → proceeds to auth result as before
- Printed photo: countdown expires → "Liveness Failed" result card

### Completion Criteria
- Real face blink triggers within average 2 seconds across 5 test subjects
- Printed photo consistently times out (0 false blink detections on 5 test photo trials)
- Total auth latency still < 1.5 seconds from blink detection to result (within 1s after blink)
- No regressions: existing `no-users`, `loading`, permission, and result states all still work

---

## T17 — Sync Purge After Successful Upload

**Status:** `[x] DONE`
**Phase:** 7 — Sync & Purge
**Estimated time:** 1.5 hours
**Dependencies:** T12 (sync queue engine)

### Objective
After a successful sync batch POST, delete the uploaded records from SQLite.
The hackathon spec uses the word "purge" explicitly — `synced = 1` is not enough.

### Changes Required

**`ZaiFi/src/storage/database.ts`**

Add two new functions:
```typescript
purgeSyncedAttendanceLogs(): Promise<number>
// DELETE FROM attendance_logs WHERE synced = 1
// Returns count of deleted rows

clearProcessedSyncQueue(ids: string[]): Promise<void>
// DELETE FROM sync_queue WHERE id IN (...)
```

**`ZaiFi/src/engines/syncEngine.ts`** (or wherever T12 sync logic lives)

After a successful POST response (status 200/201):
1. Call `purgeSyncedAttendanceLogs()` — delete the uploaded records
2. Call `clearProcessedSyncQueue(batchIds)` — remove the batch from queue
3. Emit a sync-complete event (or call a passed callback) with `{ purgedCount: number }`

Cache the last 10 records in React state before purging so the attendance log
screen is not blank immediately during the demo — show the records with a
"Synced ✓" badge, then fade them out after 2 seconds.

**`ZaiFi/src/screens/HomeScreen.tsx` (or AttendanceLogScreen)**

- Handle the post-purge empty state: show "All attendance records synced and cleared" message
- Show a toast or banner "X records synced & purged" immediately after sync completes

### Completion Criteria
- `SELECT COUNT(*) FROM attendance_logs WHERE synced = 1` returns 0 after sync
- `SELECT COUNT(*) FROM sync_queue` returns 0 after sync
- Attendance log screen shows correct empty state, no crash
- Demo: airplane mode off → sync animation → "Purged N records" → log clears

---

## T18 — BiometricAuth Public Module API

**Status:** `[x] DONE`
**Phase:** 8 — Datalake 3.0 Integration Layer
**Estimated time:** 3 hours
**Dependencies:** T10, T11, T12

### Objective
Wrap the core ZAi-Fi engines behind a clean, minimal public API so that Datalake 3.0
(or any React Native app) can integrate biometric auth in < 30 lines of code.

### Implementation

**File to create:** `ZaiFi/src/BiometricAuth/index.ts`

```typescript
export interface EnrollResult {
  success: boolean;
  userId?: string;
  error?: string;
}

export interface AuthResult {
  matched: boolean;
  userId?: string;
  userName?: string;
  confidence: number;
  latencyMs: number;
  failReason?: 'liveness' | 'blink_timeout' | 'no_match';
}

export interface AttendanceRecord {
  id: string;
  userId: string | null;
  timestamp: string;
  authResult: 'pass' | 'fail';
  confidence: number;
  synced: boolean;
}

export const BiometricAuth = {
  // Call once at app startup — loads TFLite models and opens SQLite DB
  initialize(): Promise<void>,

  // Opens enrollment camera flow; resolves when enrollment completes or user cancels
  enroll(name: string): Promise<EnrollResult>,

  // Opens auth camera flow; resolves with result when auth completes (pass/fail/timeout)
  authenticate(): Promise<AuthResult>,

  // Returns all attendance records not yet synced
  getAttendanceLogs(): Promise<AttendanceRecord[]>,

  // Triggers an immediate sync attempt; purges after success
  syncAndPurge(endpoint: string): Promise<{ purgedCount: number }>,
}
```

**Design constraints:**
- All screens (AuthScreen, EnrollmentScreen) remain as they are — `BiometricAuth`
  is a facade that navigates to them internally or abstracts them as headless logic
- If full headless mode is too complex in time, document the navigation integration
  pattern instead (show how Datalake 3.0 calls `navigation.navigate('ZAiFiAuth')`)
- The key deliverable for scoring is the documented API surface, not necessarily
  a fully headless implementation

### Completion Criteria
- `BiometricAuth/index.ts` exists and exports all 5 methods with correct TypeScript types
- `initialize()` and `getAttendanceLogs()` are fully implemented and callable
- `enroll()` and `authenticate()` navigate to the existing screens (wiring complete)
- No TypeScript errors in the module file

---

## T19 — Datalake 3.0 Integration Guide

**Status:** `[x] DONE`
**Phase:** 8 — Datalake 3.0 Integration Layer
**Estimated time:** 1.5 hours
**Dependencies:** T18

### Objective
Produce a clear technical document that shows — in concrete code — how to drop ZAi-Fi
into an existing React Native app like Datalake 3.0.

### File to create: `docs/INTEGRATION.md`

**Document must include:**

1. **Prerequisites** — React Native version, npm install command, native config steps
   (Android `build.gradle` changes, iOS Podfile changes, camera permission strings)

2. **Quick Start (< 30 lines)** — A complete working example:
   ```typescript
   import { BiometricAuth } from 'zaifi';

   // In your app entry point
   await BiometricAuth.initialize();

   // Enroll a worker
   const result = await BiometricAuth.enroll('Arjun Kumar');

   // Authenticate
   const auth = await BiometricAuth.authenticate();
   if (auth.matched) {
     console.log(`Welcome ${auth.userName} — ${auth.latencyMs}ms`);
   }

   // Sync attendance
   await BiometricAuth.syncAndPurge('https://your-api/sync');
   ```

3. **Architecture diagram** — ASCII or image showing ZAi-Fi as a module inside Datalake 3.0

4. **Performance characteristics** — model sizes, latency numbers, RAM usage

5. **Offline behaviour** — what happens with no network, when sync triggers

### Completion Criteria
- Document is clear enough for a developer unfamiliar with ZAi-Fi to integrate it
- Quick Start example compiles without errors
- Architecture diagram included

---

## T20 — Performance Benchmarks Documentation

**Status:** `[x] DONE`
**Phase:** 9 — Validation & Compliance
**Estimated time:** 2 hours
**Dependencies:** T16 (blink gate), T17 (purge)

### Objective
Run a structured test protocol on a real device and document results.
This evidences the >95% accuracy claim and addresses the Indian demographics requirement.

### Test Protocol

Run on a real Android mid-range device (3-4 GB RAM). Log all results.

**Test Suite A — Same-person verification accuracy**
- Subjects: minimum 5 people with diverse skin tones (document each)
- Per subject: enroll once → authenticate 5 times (different angles/distances)
- Record: similarity score each attempt, pass/fail, latency
- Target: ≥ 95% of attempts match correctly

**Test Suite B — Cross-person rejection (no false positives)**
- 5 pairs of different people
- Attempt to auth Person B after enrolling only Person A
- Record: similarity score, should all be below threshold (0.75)
- Target: 0 false acceptances

**Test Suite C — Lighting conditions**
- 3 subjects, 3 lighting conditions: indoor normal, bright window (outdoor sim), dim
- Same enroll-once → authenticate methodology
- Document any failures

**Test Suite D — Anti-spoofing (passive + active)**
- 3 printed photos, 3 phone screen replays
- All should fail either passive MiniFASNet OR blink timeout
- Record which gate caught each attempt

**Test Suite E — Blink detection reliability**
- 5 subjects: time from prompt appearance to blink detected
- 3 attempts per subject
- Target: detected within 3 seconds average

### File to create: `docs/benchmarks.md`

Include: device specs, OS version, test date, raw result table, accuracy percentage,
failure analysis, and a brief note on MobileFaceNet training data diversity.

### Completion Criteria
- `benchmarks.md` exists with all 5 test suites documented
- Overall accuracy ≥ 95% (or failure cases clearly analysed)
- Anti-spoofing pass rate 100% across test samples

---

## T21 — iOS 12 Deployment Target Fix

**Status:** `[x] DONE`
**Phase:** 9 — Validation & Compliance
**Estimated time:** 0.5 hours
**Dependencies:** None

### Objective
The hackathon spec requires iOS 12+. The project currently targets iOS 13+. Update
all relevant config files to declare iOS 12 compatibility.

### Changes Required

1. **`ZaiFi/ios/Podfile`**
   ```ruby
   # Change:
   platform :ios, '13.0'
   # To:
   platform :ios, '12.0'
   ```

2. **`ZaiFi/ios/ZaiFi.xcodeproj/project.pbxproj`**
   Search and replace `IPHONEOS_DEPLOYMENT_TARGET = 13.0` → `12.0` (all occurrences)

3. **`docs/architecture.md`** — Update the hardware requirements table
   (change iOS 13+ → iOS 12+)

4. **`CLAUDE.md`** — Update the constraints section iOS target if listed

### Completion Criteria
- `pod install` succeeds with `platform :ios, '12.0'`
- Xcode build target shows iOS 12.0 without warnings
- No deprecated API errors that block the build

---

## Progress Summary

| Task | Name | Phase | Est. | Status |
|---|---|---|---|---|
| T15 | Eye Keypoint + Blink Signal Engine | 6 | 2.5h | `[x] DONE` |
| T16 | Active Blink Challenge Gate (AuthScreen) | 6 | 3.5h | `[x] DONE` |
| T17 | Sync Purge After Successful Upload | 7 | 1.5h | `[x] DONE` |
| T18 | BiometricAuth Public Module API | 8 | 3.0h | `[x] DONE` |
| T19 | Datalake 3.0 Integration Guide | 8 | 1.5h | `[x] DONE` |
| T20 | Performance Benchmarks Documentation | 9 | 2.0h | `[x] DONE` |
| T21 | iOS 12 Deployment Target Fix | 9 | 0.5h | `[x] DONE` |
| | **Phase 2 Total** | | **~14.5h** | |

---

## Critical Path (Phase 2)

```
T15 Blink Signal Engine
        │
        ▼
T16 Blink Challenge Gate ──────────────────────────────────┐
                                                            │
T17 Sync Purge ─────────────────────────────────────────── ┤
                                                            │
T18 Module API                                              │
        │                                                   │
        ▼                                                   │
T19 Integration Guide ─────────────────────────────────────┤
                                                            │
T20 Benchmarks ─────────────────────────────────────────── ┤
                                                            │
T21 iOS Fix ────────────────────────────────────────────────┘
                                                            │
                                                            ▼
                                               M15: Full Compliance Demo
                                               Deadline: 05 June 2026
```

**T15 → T16 is the only hard sequential dependency.**
T17, T18→T19, T20, T21 can all be developed in parallel with T15/T16.
