# ZAi-Fi — Implementation Order

---

## Critical Path

The fastest route to a working demo follows this dependency chain:

```
T01 Scaffold
    │
    ├──► T03 Camera ──────────────────────────────────┐
    │                                                  │
    └──► T02 Model Sourcing ──► T04 Face Detection ───┤
                                        │              │
                                        ▼              │
                                T05 Embedding          │
                                        │              │
                     T07 SQLite ──►  T08 Enroll ◄──────┘
                                        │
                                   T06 Similarity
                                        │
                                   T09 Liveness
                                        │
                                   T10 Auth Flow
                                        │
                          T11 Attendance Logging
                                        │
                          T12 Sync Queue Engine
                                        │
                             T13 Main App UI
                                        │
                             T14 Demo Polish
```

**Earliest working demo checkpoint: after T10**
At that point you have: enroll a face → verify a face → liveness gate → result on screen.

---

## Exact Build Order

### Step 1 — T01: Project Scaffold
No dependencies. Do this first.

```
npx react-native init ZaiFi --template react-native-template-typescript
```

Install all npm deps in one pass so Metro only restarts once:
```
npm install react-native-vision-camera @tensorflow/tfjs @tensorflow/tfjs-react-native @tensorflow/tfjs-tflite react-native-sqlite-storage @react-native-community/netinfo react-native-fs react-navigation/native react-navigation/stack react-native-safe-area-context react-native-screens
```

---

### Step 2 — T02 + T03 (parallel): Model Sourcing + Camera

Run these in parallel — they have no dependency on each other.

**T02:** Download and validate models:
- BlazeFace: `face_detection_short.tflite` from TF Hub
- MobileFaceNet: `mobilefacenet.tflite` from open-source
- MiniFASNet: `MiniFAS_lite2.tflite` from open-source

Place all in `src/assets/models/`. Verify total < 20 MB.

**T03:** Wire VisionCamera, handle permissions, confirm preview renders.

---

### Step 3 — T04: Face Detection

Requires T02 + T03 complete.

Implement frame processor with BlazeFace. Visual confirmation: bounding box visible on screen. This step is the first "wow moment" for the team.

---

### Step 4 — T07: SQLite (parallel with T04 if possible)

No dependency on camera/inference. Can be built while T04 is being debugged.

Initialize DB, create all tables, write CRUD helpers. Test with dummy inserts.

---

### Step 5 — T05: Face Embedding

Requires T04 complete. Wire MobileFaceNet after BlazeFace, validate embedding output shape and range.

---

### Step 6 — T06: Cosine Similarity

Requires T05. Pure math — fast to implement. Write as standalone utility functions with inline tests.

---

### Step 7 — T08: Enrollment

Requires T05 + T06 + T07. First end-to-end flow that touches all layers. Highest integration risk — allow extra time.

---

### Step 8 — T09: Liveness

Requires T04 (face crop available). Can be partially built in parallel with T05–T08 since it only needs the face crop. Full integration happens at T10.

---

### Step 9 — T10: Full Auth Flow

Requires T04 + T05 + T06 + T07 + T08 + T09.

Wire everything together. This is the highest-value milestone — **demo is possible after this step**.

---

### Step 10 — T11: Attendance Logging

Requires T07 + T10. Low complexity, attach to auth event callback.

---

### Step 11 — T12: Sync Queue

Requires T07 + T11. Implement NetInfo listener, queue drain logic, stub endpoint.

---

### Step 12 — T13: Main App UI

Requires T08 + T10 + T11 + T12. Build navigation and screens around working logic.

---

### Step 13 — T14: Demo Polish

Final step. Add animations, latency display, offline badge. Do not start this until T10 is stable.

---

## Module Dependency Map

| Module | Depends On | Blocking For |
|---|---|---|
| T01 Scaffold | — | Everything |
| T02 Models | T01 | T04, T05, T09 |
| T03 Camera | T01 | T04 |
| T04 Face Detection | T02, T03 | T05, T09 |
| T05 Embedding | T02, T04 | T06, T08 |
| T06 Similarity | T05 | T08, T10 |
| T07 SQLite | T01 | T08, T11 |
| T08 Enrollment | T05, T06, T07 | T10 |
| T09 Liveness | T02, T04 | T10 |
| T10 Auth Flow | T04, T05, T06, T07, T08, T09 | T11, T13 |
| T11 Attendance | T07, T10 | T12, T13 |
| T12 Sync Queue | T07, T11 | T13 |
| T13 Main UI | T08, T10, T11, T12 | T14 |
| T14 Polish | T13 | — |

---

## Parallelization Opportunities

These pairs can be built simultaneously by two developers:

| Parallel Track A | Parallel Track B |
|---|---|
| T02 (model sourcing) | T03 (camera) |
| T04 (detection) | T07 (SQLite) |
| T05 (embedding) | T09 (liveness — early prep) |
| T11 (attendance) | T12 (sync queue) |

---

## What to Cut If Time Runs Short

Priority order for cuts — cut from bottom up:

1. T14 Demo polish — cut animations, keep raw result screen
2. T12 Sync queue — stub it (just log "would sync"), show sync screen as static
3. T09 Liveness — demo without liveness, show as "in pipeline" on architecture slide
4. T13 Settings screen — cut entirely, hardcode config
5. **Never cut:** T04 + T05 + T06 + T08 + T10 — this is the core demo

---

## Time Estimate (Single Developer)

| Task | Estimated Hours |
|---|---|
| T01 Scaffold | 2h |
| T02 Models | 2h |
| T03 Camera | 2h |
| T04 Face Detection | 3h |
| T05 Embedding | 3h |
| T06 Similarity | 1h |
| T07 SQLite | 2h |
| T08 Enrollment | 3h |
| T09 Liveness | 4h |
| T10 Auth Flow | 3h |
| T11 Attendance | 1h |
| T12 Sync Queue | 2h |
| T13 Main UI | 4h |
| T14 Polish | 2h |
| **Total** | **34 hours** |

**With two developers in parallel:** ~20 hours (1.5–2 days of focused work)

**Minimum viable hackathon demo (T01–T10 + T13 basic):** ~22 hours solo, ~14 hours parallel
