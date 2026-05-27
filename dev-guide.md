# ZAi-Fi — Claude Code Development Guide

How to build this project efficiently using Claude Code as your AI pair programmer.

---

## How This Works

You give Claude Code one task at a time from `tasks.md`. Claude Code writes the code, you verify it on device, then you mark the task done and move to the next. At the end of each task, Claude Code also updates `tasks.md` and `plan.md` to reflect progress.

**Claude Code is not a code generator. Treat it as a senior dev sitting next to you.**

---

## The Three Files You Keep Open

| File | Purpose |
|---|---|
| `tasks.md` | What to build next. Check status before every session. |
| `plan.md` | Phase tracking. Update when a phase gate is cleared. |
| `architecture.md` | Reference when Claude Code needs context on the overall design. |

---

## Starting a Session

At the start of every Claude Code session, run this prompt first:

```
Read tasks.md and plan.md. Tell me which tasks are IN PROGRESS or still TODO,
and which phase we are in. Then we will work on the next task.
```

This ensures Claude Code has the full picture before writing any code.

---

## The Task Prompt Pattern

For each task, use this exact structure when prompting Claude Code:

```
We are building ZAi-Fi — an offline facial recognition and liveness detection 
app in React Native with TFLite. Read architecture.md for the full design.

We are now implementing: [TASK NAME] ([TASK ID])

Objective: [paste objective from tasks.md]
Dependencies already done: [list completed tasks]
Expected output: [paste expected output from tasks.md]
Completion criteria: [paste criteria from tasks.md]

Implement this now. Keep it lightweight — no enterprise abstractions.
After completing the code, update tasks.md to mark [TASK ID] as [x] DONE
and update plan.md if this completes a phase gate.
```

---

## Task-by-Task Prompt Guide

### T01 — Project Scaffold

```
We are building ZAi-Fi. Initialize a React Native TypeScript project called 
ZaiFi. Then install these packages in one npm install command:

react-native-vision-camera @tensorflow/tfjs @tensorflow/tfjs-react-native 
@tensorflow/tfjs-tflite react-native-sqlite-storage 
@react-native-community/netinfo react-native-fs 
@react-navigation/native @react-navigation/stack 
react-native-safe-area-context react-native-screens

Create this folder structure under src/:
  src/
    screens/
    engines/
    storage/
    sync/
    assets/models/
    utils/
    types/

After setup, show me the folder structure and confirm Metro starts.
Then mark T01 as [x] DONE in tasks.md.
```

---

### T02 — TFLite Model Sourcing

```
For ZAi-Fi we need three TFLite models placed in src/assets/models/:

1. blazeface_short.tflite — face detection — source from TensorFlow Hub
2. mobilefacenet.tflite — face embedding — 128-dim output
3. minifasnet_v2.tflite — passive anti-spoofing / liveness

Show me where to download each one (direct URLs or repo links).
Verify total size is under 20MB.
Then write a smoke test file src/engines/modelLoader.ts that loads all three 
and logs their input/output shapes.
Mark T02 as [x] DONE in tasks.md.
```

---

### T03 — Camera Module

```
Implement the camera module for ZAi-Fi in React Native using react-native-vision-camera.

Requirements:
- Front camera, 30fps
- Full-screen preview
- Frame processor hook set up (we will attach inference later)
- Camera permissions handled for Android and iOS
- Export a CameraView component ready to accept an onFrame prop

File: src/screens/CameraScreen.tsx
Mark T03 as [x] DONE in tasks.md when done.
```

---

### T04 — Face Detection Engine

```
T01, T02, T03 are done. Now implement the BlazeFace face detection engine for ZAi-Fi.

Read architecture.md for the AI pipeline design.

Requirements:
- Load blazeface_short.tflite (already in assets)
- Attach to VisionCamera frame processor, run every 3rd frame
- Return bounding box for detected face
- Draw bounding box overlay on camera preview
- Quality gate: reject if face area < 10% of frame, or box outside center 60%

Files:
  src/engines/faceDetection.ts   — detection logic
  src/engines/qualityGate.ts     — quality checks
  src/screens/CameraScreen.tsx   — add bounding box overlay

Mark T04 as [x] DONE in tasks.md. Update plan.md Phase 1 to [~] IN PROGRESS.
```

---

### T05 — Face Embedding Engine

```
T04 is done. Implement the MobileFaceNet embedding engine for ZAi-Fi.

Requirements:
- Load mobilefacenet.tflite
- Input: face crop resized to 112x112, normalized to [-1, 1]
- Output: Float32Array of length 128
- Runs after face detection quality gate passes
- Log embedding to console for first 3 frames to validate

File: src/engines/faceEmbedding.ts

Mark T05 as [x] DONE in tasks.md.
```

---

### T06 — Cosine Similarity Engine

```
Implement the cosine similarity and threshold verification logic for ZAi-Fi.

Requirements:
- cosineSimilarity(a: Float32Array, b: Float32Array): number
- verifyFace(incoming: Float32Array, stored: Float32Array[]): AuthResult
- AuthResult type: { matched: boolean, userId: string | null, confidence: number }
- Threshold constant: MATCH_THRESHOLD = 0.75
- Pure functions, no side effects

File: src/engines/verification.ts + src/types/auth.ts

Mark T06 as [x] DONE in tasks.md.
```

---

### T07 — SQLite Storage

```
Implement the SQLite offline storage layer for ZAi-Fi.

Read the schema in architecture.md (SQLite Schema section).

Requirements:
- Initialize DB on app start, create tables if not exist
- CRUD helpers for: users, face_embeddings, attendance_logs, sync_queue
- Embeddings stored as base64-encoded Float32Array blobs
- Helper to encode Float32Array → base64 and decode back

Files:
  src/storage/database.ts      — init + table creation
  src/storage/userStore.ts     — user CRUD
  src/storage/embeddingStore.ts — embedding CRUD
  src/storage/attendanceStore.ts — attendance CRUD
  src/storage/syncQueue.ts     — sync queue CRUD

Mark T07 as [x] DONE in tasks.md.
```

---

### T08 — Enrollment Module

```
T05, T06, T07 are done. Implement the face enrollment flow for ZAi-Fi.

Flow:
1. User enters worker name on enrollment screen
2. Camera opens, captures 5 stable face frames automatically
3. Embedding generated for each frame
4. Average the 5 embeddings into one representative vector
5. Save user + averaged embedding to SQLite
6. Show confirmation screen

Files:
  src/screens/EnrollmentScreen.tsx
  src/engines/enrollment.ts

Mark T08 as [x] DONE in tasks.md.
```

---

### T09 — Liveness Detection

```
Implement the passive liveness detection engine for ZAi-Fi using MiniFASNet.

Requirements:
- Load minifasnet_v2.tflite
- Input: face crop (check MiniFASNet's expected input size — typically 80x80)
- Output: [real_score, fake_score] — threshold real_score > 0.7 = live
- Must run BEFORE embedding generation in the pipeline
- Return: { isLive: boolean, score: number }

File: src/engines/livenessDetection.ts

Also add a visual overlay on CameraScreen: "Liveness Check..." text while running.
Mark T09 as [x] DONE in tasks.md. Update plan.md Phase 3 to [x] DONE.
```

---

### T10 — Full Auth Flow

```
T04, T05, T06, T07, T08, T09 are all done. 
Now wire the complete authentication pipeline for ZAi-Fi.

Pipeline order:
1. Face detected (BlazeFace) + quality gate
2. Liveness check (MiniFASNet) — fail → return AuthResult fail with reason "Liveness Failed"
3. Embedding generated (MobileFaceNet)
4. Load all enrolled embeddings from SQLite (cache in memory)
5. Cosine similarity against all stored embeddings
6. Best match > 0.75 → success with matched user name
7. Else → fail with reason "No Match"
8. Return AuthResult with: matched, userId, userName, confidence, latencyMs

File: src/engines/authPipeline.ts

This is the core. Measure total latency and assert < 1000ms on device.
Mark T10 as [x] DONE in tasks.md. Update plan.md Phase 2 to [x] DONE.
```

---

### T11 — Attendance Logging

```
T07 and T10 are done. Implement attendance logging for ZAi-Fi.

On every AuthResult (pass or fail), write to SQLite attendance_logs:
- user_id (null if no match)
- timestamp (ISO8601)
- auth_result ('pass' | 'fail')
- confidence score
- latency_ms
- synced = false

Wire this into authPipeline.ts so logging is automatic.

File: src/storage/attendanceStore.ts (extend existing)

Mark T11 as [x] DONE in tasks.md.
```

---

### T12 — Sync Queue Engine

```
T07 and T11 are done. Implement the sync queue engine for ZAi-Fi.

Requirements:
- Use @react-native-community/netinfo to detect online/offline
- When online: read attendance_logs WHERE synced = 0
- POST to SYNC_ENDPOINT (env constant, default 'http://localhost:3000/sync')
- On 200 response: update synced = 1 for those records
- On failure: increment retry_count, skip if retry_count > 3
- Batch max 50 records per POST

File: src/sync/syncEngine.ts

Wire NetInfo listener at app startup in App.tsx.
Mark T12 as [x] DONE in tasks.md. Update plan.md Phase 4 to [x] DONE.
```

---

### T13 — Main App UI

```
Core logic (T08–T12) is done. Build the main UI for ZAi-Fi.

Screens needed:
1. HomeScreen — two buttons: "Authenticate" and "Enroll Worker"
2. AuthScreen — camera view + result card (name, confidence %, latency, pass/fail icon)
3. EnrollmentScreen — name input + progress bar (1/5 → 5/5)
4. AttendanceLogScreen — scrollable FlatList, each row: name, time, result, sync badge
5. App.tsx — React Navigation stack wiring all screens

Header: show online/offline pill (green dot = online, grey = offline).

Keep styling minimal — dark background, white text, accent color #00C896.
Mark T13 as [x] DONE in tasks.md.
```

---

### T14 — Demo Polish

```
T13 is done. Add demo polish to ZAi-Fi for the hackathon presentation.

Add:
1. Auth success: animated green checkmark (Animated API, scale + opacity)
2. Auth fail: red X animation
3. Latency badge on success: "Verified in 0.87s" (use real measured latency)
4. Offline indicator: grey pill "OFFLINE MODE" in header when no network
5. Sync animation: pulsing dot on AttendanceLog screen when sync is running
6. Pre-enroll "Demo Worker" user on first app launch if no users exist

Mark T14 as [x] DONE in tasks.md.
Update plan.md Phase 5 to [x] DONE.
Update all Milestones in plan.md to [x] if gates are cleared.
```

---

## After Each Task — Status Update Rule

**Always end a task session with this prompt:**

```
Task [TXX] is complete. 
Update tasks.md: mark T[XX] as [x] DONE.
Update plan.md: mark Phase [N] as [x] DONE if its gate is now cleared.
Update plan.md Milestones table for any milestones now reached.
```

This keeps both files accurate as the source of truth.

---

## Debugging Prompts

**When TFLite model fails to load:**
```
The TFLite model at [path] is failing to load with error: [paste error].
We are using @tensorflow/tfjs-tflite in React Native.
Do not change the model file. Fix the loader code only.
```

**When inference is too slow:**
```
The [model name] inference is taking [Xms]. Target is [Yms].
Read architecture.md Mobile Optimization section.
Enable GPU delegate (Android) and check if XNNPACK is active.
Show me only the delegate configuration change — no other changes.
```

**When camera frame processor crashes:**
```
The VisionCamera frame processor is crashing with: [paste error].
We are running detection every 3rd frame. Do not change the throttling logic.
Fix only the frame processor wiring.
```

**When SQLite embedding round-trip fails:**
```
The float32 embedding is not round-tripping correctly through SQLite BLOB.
We encode via base64. Show me the encode and decode functions and fix the mismatch.
```

---

## Hackathon Day Checklist

Before presenting:

- [ ] Pre-enroll "Demo Worker" face on the presentation device
- [ ] Confirm auth completes in < 1 second (run 5× and check)
- [ ] Confirm liveness rejects a printed photo
- [ ] Confirm airplane mode auth works
- [ ] Confirm airplane mode off triggers sync within 5 seconds
- [ ] Attendance log screen shows populated records
- [ ] Backup device charged and app installed
- [ ] Device screen timeout set to "Never" during demo
- [ ] Device in Do Not Disturb mode

---

## Key Constants (to adjust per environment)

| Constant | Location | Default |
|---|---|---|
| `MATCH_THRESHOLD` | `src/engines/verification.ts` | `0.75` |
| `LIVENESS_THRESHOLD` | `src/engines/livenessDetection.ts` | `0.7` |
| `ENROLLMENT_FRAMES` | `src/engines/enrollment.ts` | `5` |
| `SYNC_ENDPOINT` | `src/sync/syncEngine.ts` | `http://localhost:3000/sync` |
| `SYNC_BATCH_SIZE` | `src/sync/syncEngine.ts` | `50` |
| `FRAME_SKIP` | `src/engines/faceDetection.ts` | `3` |
