# ZAi-Fi — Implementation Tasks

> **Status legend:** `[ ] TODO` · `[~] IN PROGRESS` · `[x] DONE`
>
> Update the status line of each task as you work. When a task is done, also update `plan.md` phase status.

---

## T01 — Project Scaffold

**Status:** `[x] DONE`

**Objective:** Bootstrap the React Native project with all dependencies installed and folder structure in place.

**Dependencies:** None

**Expected Output:**
- React Native + TypeScript project running on device/emulator
- All npm packages installed (no red screens)
- Folder structure created
- Git initialized

**Completion Criteria:**
- `npx react-native run-android` succeeds
- Metro bundler starts without errors
- Blank app launches on device

---

## T02 — TFLite Model Sourcing + Bundling

**Status:** `[x] DONE`

**Objective:** Source all three TFLite models, validate their sizes, and bundle them into the app's asset directory.

**Dependencies:** T01

**Models to source:**
- BlazeFace (face detection) — ~1 MB — from TensorFlow Hub
- MobileFaceNet (face embedding) — ~5 MB — from open-source repos
- MiniFASNet or Silent-Face anti-spoofing (liveness) — ~3-4 MB — from open-source

**Expected Output:**
- Three `.tflite` files in `assets/models/`
- Total model size confirmed < 20 MB
- Models load without crash (smoke test)

**Completion Criteria:**
- All three files present in assets
- App builds with models bundled
- Basic TFLite load call succeeds in isolation test

---

## T03 — Camera Module

**Status:** `[x] DONE`

**Objective:** Get live camera preview working with frame processor access.

**Dependencies:** T01

**Expected Output:**
- Camera permission granted and handled on Android + iOS
- Live preview visible full-screen
- Frame processor hook available for downstream inference
- Front camera selected by default

**Completion Criteria:**
- Camera opens on app launch
- No ANR or crash during preview
- Frame processor receives frames at ≥ 15 fps

---

## T04 — Face Detection Engine

**Status:** `[x] DONE`

**Objective:** Run BlazeFace on live camera frames and draw bounding box around detected face.

**Dependencies:** T02, T03

**Expected Output:**
- BlazeFace TFLite model loaded at startup
- Frame processor runs detection at ~10 fps (every 3rd frame)
- Bounding box overlay drawn over detected face
- Quality gate: reject if face too small, too blurry, or off-center

**Completion Criteria:**
- Face box visible in real time on device
- Detection latency < 80 ms
- Quality check filters out bad frames before passing to embedding

---

## T05 — Face Embedding Engine

**Status:** `[x] DONE`

**Objective:** Crop the detected face region, preprocess it, and run MobileFaceNet to produce a 128-dim embedding vector.

**Dependencies:** T02, T04

**Expected Output:**
- Face crop extracted from frame using bounding box
- Resize to 112×112, normalize pixel values to [-1, 1]
- MobileFaceNet inference runs and returns float32[128]
- Embedding logged to console for validation

**Completion Criteria:**
- Embedding generated in < 200 ms
- Same face produces similar vectors (cosine similarity > 0.85 across frames)
- Different faces produce dissimilar vectors (cosine similarity < 0.5)

---

## T06 — Cosine Similarity + Threshold Engine

**Status:** `[x] DONE`

**Objective:** Implement the verification math: compute cosine similarity between two embeddings and apply threshold decision.

**Dependencies:** T05

**Expected Output:**
- `cosineSimilarity(a: Float32Array, b: Float32Array): number` function
- `verifyFace(incoming: Float32Array, stored: Float32Array[]): AuthResult` function
- Returns match boolean + confidence score
- Threshold: 0.75 (configurable constant)

**Completion Criteria:**
- Unit testable pure functions
- Correctly returns true for same face, false for different face
- Returns confidence percentage for display

---

## T07 — SQLite Offline Storage

**Status:** `[x] DONE`

**Objective:** Set up SQLite with all tables needed for users, embeddings, attendance, and sync queue.

**Dependencies:** T01

**Schema:**
```sql
users (id, name, created_at)
face_embeddings (id, user_id, embedding BLOB, created_at)
attendance_logs (id, user_id, timestamp, auth_result, confidence, synced)
sync_queue (id, record_type, payload JSON, created_at, retry_count)
```

**Expected Output:**
- SQLite database initialized on first app run
- All tables created with correct schema
- CRUD functions for each table

**Completion Criteria:**
- Database file persists across app restarts
- Can insert and query all tables without errors
- Embeddings round-trip correctly as BLOB (encode/decode)

---

## T08 — User Enrollment Module

**Status:** `[x] DONE`

**Objective:** Build the enrollment flow where a new worker's face is registered.

**Dependencies:** T05, T06, T07

**Flow:**
1. Enter worker name
2. Camera opens → capture 5 stable face frames
3. Generate embedding for each frame
4. Average 5 embeddings into one representative embedding
5. Store user + embedding in SQLite

**Expected Output:**
- Enrollment screen with name input
- Auto-capture progress bar (1/5 → 5/5)
- Confirmation screen on success
- User record in SQLite confirmed

**Completion Criteria:**
- Enrolled user persists after app restart
- Enrollment takes < 15 seconds total
- Average embedding is stable (low variance across captures)

---

## T09 — Liveness Detection Engine

**Status:** `[x] DONE`

**Objective:** Run passive anti-spoofing inference on the face crop before allowing verification to proceed.

**Dependencies:** T02, T04

**Implementation:**
- Load MiniFASNet or Silent-Face TFLite model
- Preprocess face crop for anti-spoofing input (may differ from embedding input)
- Model outputs: real score (0-1)
- Threshold: > 0.7 = live, ≤ 0.7 = spoof

**Expected Output:**
- Liveness check runs after face detection, before embedding
- Returns live/spoof decision with confidence
- Printed photo or screen replay returns spoof result

**Completion Criteria:**
- Real face passes liveness check consistently
- Printed photo fails liveness check
- Liveness check adds < 300 ms to pipeline

---

## T10 — Face Verification Flow

**Status:** `[x] DONE`

**Objective:** Wire the complete authentication pipeline together: detect → liveness → embed → compare → result.

**Dependencies:** T04, T05, T06, T07, T09

**Flow:**
1. Face detected and quality passes
2. Liveness check runs → fail = reject with "Liveness Failed" message
3. Embedding generated
4. Load stored embeddings for all enrolled users
5. Compute similarity against each stored embedding
6. If best match > threshold → AuthResult.success with user name
7. Else → AuthResult.fail

**Expected Output:**
- End-to-end auth in < 1 second
- Auth result clearly returned with matched user or failure reason

**Completion Criteria:**
- Correct user identified after enrollment
- Wrong user correctly rejected
- Liveness correctly gates the flow
- Total pipeline latency < 1 second measured on device

---

## T11 — Attendance Logging

**Status:** `[x] DONE`

**Objective:** Write every authentication attempt (pass or fail) to SQLite attendance_logs.

**Dependencies:** T07, T10

**Expected Output:**
- Every auth event creates a row: user_id / null, timestamp, auth_result, confidence
- Sync status column defaults to false (unsynced)
- Attendance log screen shows last N records

**Completion Criteria:**
- Records persist across restarts
- Records contain correct timestamp and result
- Log screen displays records in reverse-chronological order

---

## T12 — Sync Queue Engine

**Status:** `[x] DONE`

**Objective:** Detect network state and sync unsynced attendance records when connectivity returns.

**Dependencies:** T07, T11

**Expected Output:**
- Network state listener (NetInfo)
- On connect: read all attendance_logs where synced = false
- POST each record to a configurable endpoint (stub URL for demo)
- On success: mark record synced = true
- Retry up to 3 times on failure

**Completion Criteria:**
- Airplane mode on → records accumulate in logs
- Airplane mode off → sync triggers within 5 seconds
- Records marked synced after successful POST
- UI shows sync status update

---

## T13 — Main App UI

**Status:** `[ ] TODO`

**Objective:** Build all screens needed for a coherent demo flow.

**Dependencies:** T08, T10, T11, T12

**Screens:**
- Home: two buttons — "Authenticate" and "Enroll New Worker"
- Auth screen: camera view with liveness overlay, result card (pass/fail)
- Enrollment screen: name input + auto-capture progress
- Attendance log: scrollable list of records with sync status
- Settings: threshold config, model info, offline mode indicator

**Expected Output:**
- All screens navigable
- Auth result screen shows worker name, confidence %, latency
- Offline/online pill in app header

**Completion Criteria:**
- Full demo flow navigable without crashes
- UI reflects real state (offline indicator correct)
- Result screen readable by judge in 2 seconds

---

## T14 — Demo Polish + Performance Display

**Status:** `[ ] TODO`

**Objective:** Add visual elements that make the demo compelling for judges.

**Dependencies:** T13

**Expected Output:**
- Checkmark / X animation on auth result
- "< 1 sec" latency badge on success screen
- Real-time FPS counter on camera view (dev mode)
- Offline badge when no network
- Sync animation when records upload

**Completion Criteria:**
- Demo runs end-to-end in < 3 minutes
- Each judge-facing metric is visible on screen
- No crashes during full demo run × 3 consecutive attempts

---

## Progress Summary

| Task | Name | Status |
|---|---|---|
| T01 | Project Scaffold | `[x] DONE` |
| T02 | TFLite Model Sourcing | `[x] DONE` |
| T03 | Camera Module | `[x] DONE` |
| T04 | Face Detection Engine | `[x] DONE` |
| T05 | Face Embedding Engine | `[x] DONE` |
| T06 | Cosine Similarity Engine | `[x] DONE` |
| T07 | SQLite Offline Storage | `[x] DONE` |
| T08 | User Enrollment Module | `[x] DONE` |
| T09 | Liveness Detection Engine | `[x] DONE` |
| T10 | Face Verification Flow | `[x] DONE` |
| T11 | Attendance Logging | `[x] DONE` |
| T12 | Sync Queue Engine | `[x] DONE` |
| T13 | Main App UI | `[ ] TODO` |
| T14 | Demo Polish | `[ ] TODO` |
