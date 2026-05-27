# ZAi-Fi — Execution Plan
## Hackathon 7.0

---

## Strategic Positioning

**"An Edge AI Biometric Authentication Infrastructure Layer for Remote Workforce Operations."**

This is not a face recognition toy app. The story we tell is:
- Runs entirely on-device, zero internet
- Sub-second authentication on mid-range phones
- Production-grade sync architecture (offline-first, sync-later)
- Built for field workers in dead zones (construction, remote sites, highways)

---

## Performance Goals

| Metric | Target |
|---|---|
| Total AI model footprint | < 20 MB |
| Authentication latency | < 1 second |
| Face detection latency | < 80 ms per frame |
| Embedding generation | < 200 ms |
| Liveness check | < 300 ms |
| App cold start | < 3 seconds |
| Model load time (after first launch) | < 2 seconds |
| Device RAM usage | < 400 MB |
| Minimum device spec | 3 GB RAM, Android 8+ / iOS 13+ |

---

## Implementation Phases

> **Status legend:** `[ ] TODO` · `[~] IN PROGRESS` · `[x] DONE`

### Phase 0 — Scaffold (4 hours) — `[x] DONE`
**Tasks:** T01, T02, T03
- Initialize React Native project with TypeScript
- Install all dependencies in one pass
- Create folder structure
- Bundle TFLite model files into app assets
- Verify camera permission and preview on device

**Gate: Camera preview working on real device**

### Phase 1 — AI Inference Core (8 hours) — `[x] DONE`
**Tasks:** T04, T05
- Integrate TFLite runtime
- Load and run BlazeFace face detection
- Load and run MobileFaceNet embedding generation
- Validate output shapes and inference time
- Wire frame processor → detection → embedding pipeline

**Gate: Embedding generated from live camera frame in < 500 ms**

### Phase 2 — Enrollment + Verification (6 hours) — `[x] DONE`
**Tasks:** T06, T07, T08, T10
- Enrollment UI: capture 5 frames, average embeddings, store in SQLite
- Verification engine: cosine similarity comparison with threshold
- Auth result: success / fail with confidence score
- SQLite schema for users + embeddings

**Gate: Full enroll → verify loop working end-to-end**

### Phase 3 — Liveness Detection (6 hours) — `[x] DONE`
**Tasks:** T09
- Primary: passive anti-spoofing model (MN3-based, < 4 MB)
- Secondary: active challenge overlay (blink prompt) for demo visual impact
- Gate: liveness must pass before embedding is compared
- Test: photo fails, real face passes

**Gate: Liveness correctly rejects printed photo or screen replay**

### Phase 4 — Offline Storage + Sync (4 hours) — `[x] DONE`
**Tasks:** T11, T12
- SQLite tables: attendance_logs, sync_queue
- Write attendance record on every auth event
- Network listener: detect online/offline state
- Sync queue: batch upload on reconnect, mark records synced

**Gate: Attendance logged offline, syncs on reconnect (demo with airplane mode)**

### Phase 5 — UI Polish + Demo Prep (4 hours) — `[ ] TODO`
**Tasks:** T13, T14
- Clean auth result screen (checkmark / X animation)
- Real-time latency display (< 1s badge)
- Offline/online status pill in header
- Attendance log screen for judge walkthrough
- Demo script rehearsed and timed

**Gate: End-to-end demo run completes in under 3 minutes**

---

## Milestones

| ID | Milestone | Phase | Status |
|---|---|---|---|
| M1 | Camera live preview on device | Phase 0 | `[x]` |
| M2 | Face detection box visible in real time | Phase 1 | `[x]` |
| M3 | Embedding generated from live frame | Phase 1 | `[x]` |
| M4 | Enroll + verify loop working | Phase 2 | `[x]` |
| M5 | Liveness rejection of photo confirmed | Phase 3 | `[x]` |
| M6 | Offline attendance log + sync working | Phase 4 | `[x]` |
| M7 | Polished demo flow ready | Phase 5 | `[ ]` |

---

## Lightweight Optimization Strategy

- TFLite GPU delegate on Android, Metal on iOS — 2-3x speedup with zero code change
- Load all models once at app start, keep in memory across sessions
- Throttle detection to every 3rd camera frame (10 fps effective), run embedding only on stable faces
- Store embeddings as raw float32 arrays in SQLite BLOB — no serialization overhead
- Keep last N embeddings in a memory cache, avoid DB reads during active auth

---

## Hackathon Scoring Strategy

| Judge Criterion | Our Approach |
|---|---|
| Innovation | Edge AI on-device inference, no cloud dependency |
| Technical depth | 3 TFLite models in a coordinated pipeline |
| Real-world impact | Field workforce use case, NHAI/construction framing |
| Demo quality | Live on real device, airplane mode demonstration |
| Feasibility | Working prototype, not slides — shows production readiness path |
| Architecture | Offline-first + sync-later is a recognizable enterprise pattern |

**Narrative hook for judges**: "Signal drops on a highway construction site. The supervisor still needs to verify 50 workers at 7 AM. ZAi-Fi works. Without internet. In under 1 second per worker."

---

## Final Demo Strategy

**Demo flow (< 3 minutes):**

1. Open app on device — show offline mode indicator
2. Enroll a new worker face (live, takes ~5 seconds)
3. Authenticate that face — show < 1s badge
4. Hold up a printed photo — show liveness rejection
5. Turn on airplane mode → authenticate again → confirm offline works
6. Turn airplane mode off → show sync trigger → attendance record appears
7. Show attendance log screen with timestamps

**Fallback for demo failure:**
- Pre-enroll a test user before the presentation
- Have a backup device with same build
- If liveness fails on demo device, show on backup

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| TFLite integration broken on iOS | Focus demo on Android, note iOS as "tested" |
| Model inference too slow | Pre-warm models, show pre-recorded video as fallback |
| SQLite not persisting correctly | Use AsyncStorage as temporary fallback |
| Camera frame processor crashes | Throttle frame rate, add error boundary |
| Demo device battery dies | Keep device charging during presentation |
