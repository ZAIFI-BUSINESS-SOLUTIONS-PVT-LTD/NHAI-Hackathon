# ZAi-Fi — Implementation Order (Phase 1 — COMPLETED)
## Archive

> **This is the original Phase 1 build-order reference. All tasks complete.**
> See [../tasks.md](../tasks.md) for active Phase 2 work.

---

## Critical Path (Phase 1)

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

## Time Actuals (Phase 1)

| Task | Name | Est. | Phase |
|---|---|---|---|
| T01 | Project Scaffold | 2h | Phase 0 |
| T02 | Model Sourcing | 2h | Phase 0 |
| T03 | Camera Module | 2h | Phase 0 |
| T04 | Face Detection | 3h | Phase 1 |
| T05 | Embedding Engine | 3h | Phase 1 |
| T06 | Cosine Similarity | 1h | Phase 2 |
| T07 | SQLite Storage | 2h | Phase 2 |
| T08 | Enrollment Module | 3h | Phase 2 |
| T09 | Liveness Detection | 4h | Phase 3 |
| T10 | Auth Flow | 3h | Phase 2 |
| T11 | Attendance Logging | 1h | Phase 4 |
| T12 | Sync Queue | 2h | Phase 4 |
| T13 | Main App UI | 4h | Phase 5 |
| T14 | Demo Polish | 2h | Phase 5 |
| **Total** | | **34h** | |
