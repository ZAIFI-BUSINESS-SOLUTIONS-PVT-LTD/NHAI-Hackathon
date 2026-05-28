# ZAi-Fi — Gap Closure Plan (Phase 2)
## Hackathon 7.0 Compliance — Submission Deadline: 05 June 2026

---

> Phase 1 (T01–T14) is complete and archived in [v1/plan.md](v1/plan.md).
> This plan addresses mandatory compliance gaps and scoring-critical improvements
> identified against the hackathon specification before the June 5 deadline.

---

## Gap Summary

| Gap | Hackathon Requirement | Marks at Risk | Priority |
|---|---|---|---|
| Active liveness (blink / head-turn) | Mandatory deliverable — verbatim: *"blink, smile, or turn their head"* | Disqualification risk | 🔴 Must |
| Sync & purge after reconnect | Mandatory deliverable — verbatim: *"local data to be purged"* | Certain deduction | 🔴 Must |
| Datalake 3.0 integration layer | Core objective of the hackathon, Feasibility criterion | 30 marks | 🟡 High |
| Indian demographics validation | Accuracy >95% claim must be evidenced | 20 marks | 🟡 High |
| Performance benchmark documentation | Technical documentation deliverable | 20 marks | 🟡 High |
| iOS 12+ minimum deployment target | Spec says iOS 12+; project targets iOS 13+ | Minor | 🟢 Low |

---

## Phase 6 — Active Liveness Challenge (Est. 6 hours)

**Tasks:** T15, T16
**Status:** `[ ] TODO`
**Target completion:** 02 June 2026

### Problem
The hackathon specification states under Mandatory Deliverables:
> *"Offline Liveness Detection: The solution must include basic offline anti-spoofing measures
> (e.g., requiring the user to blink, smile, or turn their head slightly)"*

The current implementation uses only passive MiniFASNet (texture-based anti-spoofing).
Passive-only does not satisfy this requirement. Active challenge is required.

### Approach

**Primary: Eye Aspect Ratio (EAR) blink detection**

```
BlazeFace keypoints → eye center coordinates
        │
        ▼
Crop eye ROI from camera frame (30×15 px per eye)
        │
        ▼
Track mean pixel intensity over rolling 5-frame window
        │
        ▼
Intensity drop > threshold for 2+ consecutive frames = blink detected
        │
        ▼
Blink confirmed → proceed to embedding pipeline
No blink in 5 seconds → "Liveness Failed — Please Blink"
```

**Why pixel intensity instead of a new model:**
BlazeFace already provides eye keypoints (left eye, right eye [x,y]). A pixel-level
brightness heuristic avoids adding another TFLite model (~2-3 MB saved) and runs in
pure JS with < 5 ms overhead. MiniFASNet passive check still runs in parallel
as a second layer.

**Fallback (if pixel approach is unreliable on device):**
Source MediaPipe FaceMesh lite TFLite (~3 MB) to get 6-point eye landmarks and
compute classic EAR = (||p2-p6|| + ||p3-p5||) / (2 × ||p1-p4||).

### UI Changes Required
- `AuthScreen`: Add `blink` phase between `scanning` and `result`
- Show animated "Please Blink" overlay with countdown timer (5 seconds)
- On blink detected: flash green "✓ Blink Detected" → proceed to embedding
- On timeout: show "Liveness Failed" result card (same as current spoof rejection)
- `EnrollmentScreen`: No change — enrollment skips blink challenge (enrollment is supervised)

**Gate: Real face blinks → auth proceeds. Printed photo held for 5 s → times out with liveness failure.**

---

## Phase 7 — Sync & Purge Mechanism (Est. 2 hours)

**Tasks:** T17
**Status:** `[ ] TODO`
**Target completion:** 02 June 2026

### Problem
The hackathon specification states under Mandatory Deliverables:
> *"The solution should have the scope for sync with AWS server after network
> connectivity is restored (local data to be purged)"*

The current sync engine sets `synced = 1` but never deletes records.
"Purge" is explicit — marking is not purging.

### Approach

```
On successful batch POST response (2xx):
        │
        ▼
DELETE FROM attendance_logs WHERE synced = 1
        │
        ▼
DELETE FROM sync_queue WHERE id IN (processed batch ids)
        │
        ▼
UI: attendance log shows "All records synced and purged" empty state
```

**Edge cases to handle:**
- Partial batch success: only purge the records confirmed in the response
- Keep the last 10 records in a React state cache so the log screen isn't
  immediately blank mid-demo (judges should see the sync animation, then clear)
- Show a "Purged X records" toast after each successful sync

**Gate: Demo — airplane mode off → sync animation plays → attendance_logs table count drops to 0.**

---

## Phase 8 — Datalake 3.0 Integration Layer (Est. 4 hours)

**Tasks:** T18, T19
**Status:** `[ ] TODO`
**Target completion:** 03 June 2026

### Problem
The hackathon's primary objective is:
> *"seamlessly integrated into the existing Datalake 3.0 app"*

ZAi-Fi is currently a standalone app. The Feasibility criterion (30 marks) scores
"ease of integration into the existing Datalake 3.0 React Native architecture."
A standalone demo scores lower here than a clearly packaged module.

### Approach

**Step 1 — Module API surface (T18)**

Create `ZaiFi/src/BiometricAuth/index.ts` that exports a clean, minimal public API:

```typescript
BiometricAuth.initialize()       // loads models, opens DB
BiometricAuth.enroll(name)       // opens camera, returns EnrollResult
BiometricAuth.authenticate()     // opens camera, returns AuthResult
BiometricAuth.getAttendanceLogs() // returns unsynced records
BiometricAuth.syncAndPurge()     // manual sync trigger
```

All internal engines (faceDetection, faceEmbedding, livenessDetection, database)
remain internal — only the five public functions above are exported.

**Step 2 — Integration documentation (T19)**

Create `docs/INTEGRATION.md` showing:
- How to install ZAi-Fi as an npm module into Datalake 3.0
- Minimal integration: `< 30 lines` to add biometric auth to an existing RN screen
- Architecture diagram showing ZAi-Fi as a service layer within Datalake 3.0
- Required Android/iOS native config changes

**Gate: Another RN project can call `BiometricAuth.authenticate()` in < 30 lines of integration code.**

---

## Phase 9 — Validation & Compliance (Est. 3 hours)

**Tasks:** T20, T21
**Status:** `[ ] TODO`
**Target completion:** 04 June 2026

### T20 — Performance Benchmarking

The hackathon requires:
> *"facial recognition accuracy must be > 95%... trained to recognize diverse
> Indian demographics... varying outdoor lighting conditions"*

Run a structured test protocol and document results in `docs/benchmarks.md`:

| Test | Subjects | Lighting | Pass Threshold |
|---|---|---|---|
| Same-person verification | 5+ distinct Indian faces | Indoor normal | Similarity > 0.75 |
| Cross-person rejection | 5 pairs of different people | Indoor normal | Similarity < 0.75 |
| Outdoor lighting simulation | 3 faces | Bright window / torch | Same thresholds |
| Low light | 3 faces | Dim indoor | Same thresholds |
| Anti-spoofing | 3 printed photos + 3 phone screens | Any | Liveness fails |
| Active blink | 5 people | Indoor | Blink detected within 3s |

Document: model source, training dataset diversity claims, test results table,
failure cases observed.

### T21 — iOS 12 Compatibility Fix

Update minimum deployment target from iOS 13 to iOS 12 in:
- `ZaiFi/ios/Podfile` — `platform :ios, '12.0'`
- `ZaiFi/ios/ZaiFi.xcodeproj` — IPHONEOS_DEPLOYMENT_TARGET
- All relevant documentation references

**Gate: iOS 12 build succeeds without deprecation errors.**

---

## Phase 2 Milestones

| ID | Milestone | Phase | Deadline | Status |
|---|---|---|---|---|
| M8 | Blink detected on real face, gate active | Phase 6 | 02 Jun 2026 | `[ ]` |
| M9 | Printed photo times out on blink challenge | Phase 6 | 02 Jun 2026 | `[ ]` |
| M10 | Post-sync purge confirmed (DB count = 0) | Phase 7 | 02 Jun 2026 | `[ ]` |
| M11 | BiometricAuth module API exported | Phase 8 | 03 Jun 2026 | `[ ]` |
| M12 | INTEGRATION.md written + diagram done | Phase 8 | 03 Jun 2026 | `[ ]` |
| M13 | Benchmark results documented | Phase 9 | 04 Jun 2026 | `[ ]` |
| M14 | iOS 12 build confirmed | Phase 9 | 04 Jun 2026 | `[ ]` |
| M15 | Full compliance demo run (all features) | All | 05 Jun 2026 | `[ ]` |

---

## Scoring Projection

| Criterion | Max Marks | Before Phase 2 | After Phase 2 |
|---|---|---|---|
| Innovation Level (edge AI, compression) | 30 | ~22 | ~26 |
| Feasibility (Datalake 3.0 integration, speed) | 30 | ~18 | ~26 |
| Scalability & Sustainability (sync/purge, demographics) | 20 | ~12 | ~17 |
| Presentation & Documentation | 20 | ~0 | Handled separately |
| **Total (excl. presentation)** | **80** | **~52** | **~69** |

---

## Updated Demo Script (< 3 minutes — compliance version)

1. Open app — show offline indicator + model load confirmation
2. Enroll a worker face (live, ~5 seconds)
3. Authenticate: "Please Blink" overlay appears → user blinks → `< 1s ✓` badge
4. Hold up a printed photo → blink timeout → "Liveness Failed — Please use a real face"
5. Turn airplane mode on → authenticate (blink + match) → attendance logged
6. Turn airplane mode off → sync animation plays → records purge → empty state
7. Show INTEGRATION.md: "Datalake 3.0 adds this in 30 lines"

---

## Risk Mitigation (Phase 2)

| Risk | Mitigation |
|---|---|
| Pixel-based blink detection unreliable on some devices | Have MediaPipe FaceMesh model as drop-in fallback (T15 fallback) |
| Purge empties log screen abruptly mid-demo | Cache last 10 records in memory; show "Synced" state before clearing |
| Integration layer refactor breaks existing screens | Keep all existing screens intact; module API is a new export layer, not a rewrite |
| iOS 12 breaks a dependency | Revert to iOS 13 if build fails; document as "iOS 13+ tested, iOS 12 compatible in principle" |
| Benchmarking reveals accuracy < 95% | Document failure conditions (extreme lighting, accessories); propose fine-tuning path |
