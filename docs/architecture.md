# ZAi-Fi — Architecture

---

## App Architecture

```
┌──────────────────────────────────────────┐
│           React Native App               │
│                                          │
│  ┌─────────────┐  ┌────────────────────┐ │
│  │  Screens /  │  │   Navigation       │ │
│  │  UI Layer   │  │   (React Navigation│ │
│  └──────┬──────┘  └────────────────────┘ │
│         │                                │
│  ┌──────▼──────────────────────────────┐ │
│  │         Business Logic Layer        │ │
│  │  AuthEngine  EnrollEngine  SyncEngine│ │
│  └──────┬──────────────┬───────────────┘ │
│         │              │                 │
│  ┌──────▼──────┐ ┌─────▼─────────────┐  │
│  │ Inference   │ │  Data Layer       │  │
│  │ Layer       │ │  SQLite           │  │
│  │ (TFLite)    │ │  (WAL mode)       │  │
│  └──────┬──────┘ └───────────────────┘  │
│         │                               │
│  ┌──────▼──────────────────────────────┐ │
│  │  Hardware Layer                     │ │
│  │  Camera (VisionCamera)  NetInfo     │ │
│  └─────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

---

## AI Pipeline

```
Camera Frame (30 fps)
        │
        ▼  [Frame Processor — throttle to every 3rd frame]
┌───────────────────┐
│  BlazeFace TFLite │  ~1MB model
│  Input: 128×128   │  Latency: ~50ms
│  Output: bbox[]   │
└────────┬──────────┘
         │  face bounding box
         ▼
┌───────────────────┐
│  Quality Gate     │  synchronous check — no model
│  - min face size  │  Latency: < 5ms
│  - center check   │
│  - blur estimate  │
└────────┬──────────┘
         │  valid face crop
         ▼
┌───────────────────────┐
│  MiniFASNet TFLite    │  ~3MB model
│  Liveness / Anti-spoof│  Latency: ~150ms
│  Input: 80×80×3       │
│  Output: real score   │
└────────┬──────────────┘
         │  score > 0.7 → live
         ▼
┌───────────────────────┐
│  MobileFaceNet TFLite │  ~5MB model
│  Input: 112×112×3     │  Latency: ~150ms
│  Output: float32[128] │
└────────┬──────────────┘
         │  embedding vector
         ▼
┌───────────────────────┐
│  Cosine Similarity    │  pure JS
│  vs stored embeddings │  Latency: < 5ms
│  threshold: 0.75      │
└────────┬──────────────┘
         │
         ▼
   AuthResult { matched: bool, user: string, confidence: number, latencyMs: number }
```

**Total pipeline latency target: < 500ms inference + < 500ms UI = < 1 second perceived**

---

## Liveness Pipeline

### Primary: Passive Anti-Spoofing (MiniFASNet)

```
Face Crop (from BlazeFace bbox)
        │
        ▼  resize to 80×80, normalize [0,1]
┌──────────────────────────────┐
│  MiniFASNet v2 TFLite        │
│  - Learns texture features   │
│  - Distinguishes 3D face     │
│    from 2D print/screen      │
│  Output: [real_prob, fake_prob]│
└──────────────┬───────────────┘
               │
       real_prob > 0.7?
          │          │
         YES         NO
          │          │
     proceed    → reject: "Liveness Failed"
```

### Secondary (Demo Enhancement): Active Blink Prompt

```
Show overlay: "Please Blink"
        │
        ▼
Track eye aspect ratio via face landmarks
(MediaPipe FaceMesh or landmark model)
        │
        ▼
EAR drops below 0.2 for 2+ frames → blink detected
        │
        ▼
Proceed to embedding (after passive check also passes)
```

**Hackathon recommendation:** Ship passive only, add blink prompt UI as visual overlay
to make liveness check feel interactive to judges even if passive model does the real work.

---

## Offline Storage Flow

```
AuthEvent fired
        │
        ▼
┌──────────────────────────────┐
│  attendance_logs INSERT      │
│  {                           │
│    user_id,                  │
│    timestamp: ISO8601,       │
│    auth_result: 'pass'|'fail'│
│    confidence: 0.89,         │
│    synced: false             │
│  }                           │
└──────────────┬───────────────┘
               │
       isOnline?
          │          │
         YES         NO
          │          │
     immediate    stays in DB
     sync attempt  (synced=false)
          │
     success → synced=true
     failure → retry queue
```

### SQLite Schema

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE face_embeddings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  embedding BLOB NOT NULL,  -- float32[128] as binary
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE attendance_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,              -- null if auth failed (no match)
  timestamp TEXT NOT NULL,
  auth_result TEXT NOT NULL, -- 'pass' | 'fail'
  confidence REAL,
  latency_ms INTEGER,
  synced INTEGER DEFAULT 0   -- 0=false, 1=true
);

CREATE TABLE sync_queue (
  id TEXT PRIMARY KEY,
  record_type TEXT NOT NULL, -- 'attendance'
  payload TEXT NOT NULL,     -- JSON string
  created_at TEXT NOT NULL,
  retry_count INTEGER DEFAULT 0
);
```

---

## Sync Flow

```
NetInfo event: connectionType !== 'none'
        │
        ▼
SELECT * FROM attendance_logs WHERE synced = 0
        │
        ▼
Batch (max 50 records per request)
        │
        ▼
POST /api/sync/attendance
{
  device_id: string,
  records: AttendanceRecord[]
}
        │
    success?
       │          │
      YES         NO
       │          │
synced=1       retry_count++
               if retry_count > 3 → drop + log error
```

**AWS Sync (future scope):** API Gateway → Lambda → DynamoDB
**Demo stub:** Local Express server or mock endpoint returning 200

---

## Mobile Optimization Approach

### TFLite Acceleration
- Android: Enable GPU delegate via `GpuDelegate` — 2-3x speedup on Mali/Adreno GPUs
- iOS: Enable Metal delegate — 2-4x speedup on Apple Neural Engine
- Fallback: NNAPI delegate on Android if GPU delegate unavailable
- Final fallback: CPU with 4-thread XNNPACK

### Memory Management
- Load all three TFLite models once at `AppState` active
- Keep models in module-level references (never reload per-frame)
- Store embeddings in memory Map after first DB load per session
- Clear frame buffers explicitly after each inference to avoid GC pressure

### Frame Processing
- VisionCamera frame processor runs on separate JS thread
- Detection every 3rd frame (10 fps effective)
- Embedding only when face is stable (2 consecutive frames with bbox overlap > 0.85)
- Skip inference if previous result < 500ms ago (debounce)

### Battery Optimization
- Throttle camera to 15 fps when no face detected
- Resume 30 fps when face enters frame
- Pause inference when app goes to background

---

## React Native + TensorFlow Lite Integration Flow

```
npm: @tensorflow/tfjs-react-native
     react-native-fs
     react-native-vision-camera
          │
          ▼
┌─────────────────────────────────────┐
│  app startup (App.tsx)              │
│  await tf.ready()                   │
│  await tf.setBackend('rn-webgl')    │
│  OR use @tensorflow/tfjs-tflite     │
│  for direct TFLite file loading     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  loadTFLiteModel(modelAssetPath)    │
│  returns: TFLiteModel instance      │
│  called once per model at startup   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  VisionCamera useFrameProcessor     │
│  plugin — runs on JSI (C++ bridge)  │
│  passes pixel buffer to TFLite      │
│  without JS serialization overhead  │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  TFLite inference result            │
│  passed back to JS via worklet      │
│  triggers React state update        │
│  → UI renders result                │
└─────────────────────────────────────┘
```

### Key Libraries

| Library | Purpose | Size impact |
|---|---|---|
| `react-native-vision-camera` | Camera + frame processor | ~2 MB |
| `@tensorflow/tfjs-react-native` | TF.js runtime on RN | ~8 MB |
| `@tensorflow/tfjs-tflite` | Direct TFLite file loading | bundled above |
| `react-native-sqlite-storage` | SQLite offline DB | ~1 MB |
| `@react-native-community/netinfo` | Network state | < 0.5 MB |
| `react-native-fs` | Read model assets | < 0.5 MB |

### Model Loading Pattern

```typescript
// Load once at app start, reuse everywhere
let blazeface: TFLiteModel | null = null;
let mobilefacenet: TFLiteModel | null = null;
let minifasnet: TFLiteModel | null = null;

async function initModels() {
  blazeface = await loadTFLiteModel(require('./assets/models/blazeface.tflite'));
  mobilefacenet = await loadTFLiteModel(require('./assets/models/mobilefacenet.tflite'));
  minifasnet = await loadTFLiteModel(require('./assets/models/minifasnet.tflite'));
}
```

---

## Hardware & Platform Requirements

| Requirement | Minimum | Recommended |
|---|---|---|
| **Android** | API 24 (Android 7.0) | API 30+ (Android 11) |
| **iOS** | iOS 12.0 | iOS 15+ |
| **RAM** | 3 GB | 4 GB+ |
| **Processor** | Octa-core 1.8 GHz (Cortex-A53 class) | Snapdragon 6xx / Apple A12+ |
| **Camera** | 8 MP front-facing | 12 MP front-facing |
| **Storage** | 50 MB free (app + models) | 100 MB+ |
| **React Native** | 0.73+ | 0.85+ (tested) |

**iOS note:** Deployment target set to iOS 12.0 (`platform :ios, '12.0'` in Podfile,
`IPHONEOS_DEPLOYMENT_TARGET = 12.0` in Xcode project). Metal delegate available from
iOS 11; Camera frame processor requires iOS 12+.
