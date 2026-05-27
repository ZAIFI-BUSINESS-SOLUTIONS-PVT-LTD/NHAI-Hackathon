import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Camera,
  useCameraPermission,
  useFrameOutput,
  type Frame,
} from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { runFaceDetection, ANCHORS, type FaceDetectionResult } from '../engines/faceDetection';
import { checkQuality } from '../engines/qualityGate';
import { runFaceEmbedding } from '../engines/faceEmbedding';
import { runLivenessDetection } from '../engines/livenessDetection';
import { verifyFace } from '../engines/verification';
import type { StoredEmbedding } from '../types/auth';
import {
  getAllEmbeddings,
  getAllUsers,
  logAttendance,
} from '../storage/database';

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase =
  | 'loading'     // loading embeddings from DB
  | 'no-users'    // no enrolled workers yet
  | 'scanning'    // camera active, waiting for face
  | 'result';     // auth result ready

interface AuthResultState {
  matched: boolean;
  userName?: string;
  confidence: number;
  latencyMs: number;
  failReason?: 'liveness' | 'no_match';
}

interface Props {
  navigation?: { goBack: () => void; navigate: (screen: string) => void };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AuthScreen({ navigation }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [detectedBox, setDetectedBox] = useState<FaceDetectionResult | null>(null);
  const [result, setResult] = useState<AuthResultState | null>(null);

  // Pre-loaded data — available to JS callbacks
  const storedEmbeddings = useRef<StoredEmbedding[]>([]);
  const userNames = useRef<Map<string, string>>(new Map());

  // Shared mutable state for worklet control (same pattern as CameraScreen throttle)
  const captureState = React.useMemo(
    () => ({ active: false, lastRun: 0 }),
    [],
  );
  const throttle = React.useMemo(() => ({ count: 0 }), []);

  // FPS tracking — mutable object readable from worklet closure
  const fpsState = React.useMemo(() => ({ count: 0, lastTs: Date.now() }), []);
  const [fps, setFps] = useState<number | null>(null);

  // Result card animation
  const cardSlide  = useRef(new Animated.Value(120)).current;
  const iconScale  = useRef(new Animated.Value(0)).current;

  const { hasPermission, requestPermission } = useCameraPermission();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const blazeface    = useTensorflowModel(require('../assets/models/blazeface_short.tflite'), ['android-gpu']);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mobilefacenet = useTensorflowModel(require('../assets/models/mobilefacenet.tflite'), ['android-gpu']);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const antispoof    = useTensorflowModel(require('../assets/models/minifasnet_v2.tflite'), ['android-gpu']);

  // ── Data loading ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    (async () => {
      const [embeddings, users] = await Promise.all([
        getAllEmbeddings(),
        getAllUsers(),
      ]);

      storedEmbeddings.current = embeddings;
      userNames.current = new Map(users.map(u => [u.id, u.name]));

      if (embeddings.length === 0) {
        setPhase('no-users');
      } else {
        captureState.active = true;
        setPhase('scanning');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Result card animation ─────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== 'result') return;
    cardSlide.setValue(120);
    iconScale.setValue(0);
    Animated.parallel([
      Animated.spring(cardSlide, {
        toValue: 0,
        tension: 70,
        friction: 9,
        useNativeDriver: true,
      }),
      Animated.spring(iconScale, {
        toValue: 1,
        tension: 55,
        friction: 6,
        delay: 160,
        useNativeDriver: true,
      }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── JS-thread callbacks (called from worklet) ─────────────────────────────

  const updateBox = useRunOnJS(
    (box: FaceDetectionResult | null) => { setDetectedBox(box); },
    [],
  );

  const updateFps = useRunOnJS(
    (v: number) => { setFps(v); },
    [],
  );

  // Called when worklet obtains a full embedding + liveness score
  const onAuthResult = useRunOnJS(
    (embArr: number[], livenessScore: number, tStart: number) => {
      const incoming = new Float32Array(embArr);
      const latencyMs = Date.now() - tStart;

      if (livenessScore < 0.7) {
        logAttendance(null, false, livenessScore).catch(console.error);
        setResult({
          matched: false,
          confidence: livenessScore,
          latencyMs,
          failReason: 'liveness',
        });
        setPhase('result');
        return;
      }

      const authResult = verifyFace(incoming, storedEmbeddings.current);
      const userName = authResult.userId
        ? userNames.current.get(authResult.userId)
        : undefined;

      logAttendance(authResult.userId, authResult.matched, authResult.confidence)
        .catch(console.error);

      setResult({
        matched: authResult.matched,
        userName,
        confidence: authResult.confidence,
        latencyMs,
        failReason: authResult.matched ? undefined : 'no_match',
      });
      setPhase('result');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── Frame processor (worklet) ─────────────────────────────────────────────

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet';

      // FPS counter — runs on every raw frame before any throttle
      fpsState.count++;
      const nowTs = Date.now();
      if (nowTs - fpsState.lastTs >= 1000) {
        const computed = Math.round(fpsState.count * 1000 / (nowTs - fpsState.lastTs));
        updateFps(computed);
        fpsState.count = 0;
        fpsState.lastTs = nowTs;
      }

      if (!captureState.active) {
        frame.dispose();
        return;
      }

      // ~10 fps effective
      throttle.count = (throttle.count + 1) % 3;
      if (throttle.count !== 0) {
        frame.dispose();
        return;
      }

      const bfModel  = blazeface.model;
      const mfnModel = mobilefacenet.model;
      const asModel  = antispoof.model;

      if (!bfModel || !mfnModel || !asModel) {
        frame.dispose();
        return;
      }

      // Minimum 1.5 s between full pipeline runs to avoid hammering the result
      const now = Date.now();
      if (now - captureState.lastRun < 1500) {
        // Still detect face + update overlay, skip embedding
        const det = runFaceDetection(frame, bfModel, ANCHORS);
        if (det) {
          const q = checkQuality(det.box, frame.width, frame.height);
          updateBox(q.passed ? det : null);
        } else {
          updateBox(null);
        }
        frame.dispose();
        return;
      }

      const detection = runFaceDetection(frame, bfModel, ANCHORS);
      if (!detection) {
        updateBox(null);
        frame.dispose();
        return;
      }

      const quality = checkQuality(detection.box, frame.width, frame.height);
      updateBox(quality.passed ? detection : null);
      if (!quality.passed) {
        frame.dispose();
        return;
      }

      // Lock pipeline — only one run at a time
      captureState.lastRun = now;
      captureState.active  = false;

      const tStart = Date.now();

      // Liveness check
      const liveness = runLivenessDetection(frame, detection.box, asModel);

      if (!liveness.isLive) {
        // Send result immediately — no embedding needed
        const plain: number[] = [];
        onAuthResult(plain, liveness.score, tStart);
        frame.dispose();
        return;
      }

      // Embedding
      const embedding = runFaceEmbedding(frame, detection.box, mfnModel);
      frame.dispose();

      if (embedding) {
        const plain: number[] = [];
        for (let i = 0; i < embedding.length; i++) plain.push(embedding[i]);
        onAuthResult(plain, liveness.score, tStart);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blazeface.model, mobilefacenet.model, antispoof.model, updateFps],
  );

  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    dropFramesWhileBusy: true,
    onFrame,
  });

  // ── Restart auth ──────────────────────────────────────────────────────────

  function tryAgain() {
    setDetectedBox(null);
    setResult(null);
    captureState.active  = true;
    captureState.lastRun = 0;
    setPhase('scanning');
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#00C896" />
        <Text style={styles.statusText}>Loading enrolled workers…</Text>
      </View>
    );
  }

  if (phase === 'no-users') {
    return (
      <View style={styles.centered}>
        <Text style={styles.bigIcon}>👤</Text>
        <Text style={styles.title}>No Workers Enrolled</Text>
        <Text style={styles.statusText}>
          Enroll a worker before attempting authentication.
        </Text>
        {navigation && (
          <TouchableOpacity
            style={styles.btn}
            onPress={() => navigation.navigate('Enroll')}
          >
            <Text style={styles.btnText}>Enroll New Worker</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.statusText}>Camera permission required</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const modelsReady =
    blazeface.state === 'loaded' &&
    mobilefacenet.state === 'loaded' &&
    antispoof.state === 'loaded';

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Camera — always mounted so models stay warm */}
      <Camera
        style={StyleSheet.absoluteFill}
        device="front"
        isActive={phase === 'scanning'}
        outputs={[frameOutput]}
        mirrorMode="auto"
      />

      {/* Face bounding box */}
      {phase === 'scanning' && detectedBox && (
        <View
          pointerEvents="none"
          style={[
            styles.boundingBox,
            {
              left:   `${detectedBox.box.x * 100}%` as unknown as number,
              top:    `${detectedBox.box.y * 100}%` as unknown as number,
              width:  `${detectedBox.box.width * 100}%` as unknown as number,
              height: `${detectedBox.box.height * 100}%` as unknown as number,
            },
          ]}
        />
      )}

      {/* Scanning overlay */}
      {phase === 'scanning' && (
        <View style={styles.scanOverlay} pointerEvents="none">
          <Text style={styles.scanText}>
            {modelsReady ? 'Look at the camera' : 'Loading models…'}
          </Text>
          {!modelsReady && (
            <ActivityIndicator color="#00C896" style={{ marginTop: 8 }} />
          )}
        </View>
      )}

      {/* Result card */}
      {phase === 'result' && result && (
        <View style={styles.resultCard}>
          {result.matched ? (
            <>
              <Text style={[styles.resultIcon, styles.successColor]}>✓</Text>
              <Text style={styles.resultName}>{result.userName ?? 'Unknown'}</Text>
              <Text style={styles.resultConf}>
                {Math.round(result.confidence * 100)}% confidence
              </Text>
              <View style={styles.latencyBadge}>
                <Text style={styles.latencyText}>
                  {result.latencyMs < 1000
                    ? `${result.latencyMs}ms`
                    : `${(result.latencyMs / 1000).toFixed(1)}s`}
                </Text>
              </View>
            </>
          ) : result.failReason === 'liveness' ? (
            <>
              <Text style={[styles.resultIcon, styles.warnColor]}>⚠</Text>
              <Text style={styles.resultTitle}>Liveness Check Failed</Text>
              <Text style={styles.resultSub}>Please use a real face</Text>
            </>
          ) : (
            <>
              <Text style={[styles.resultIcon, styles.failColor]}>✗</Text>
              <Text style={styles.resultTitle}>Not Recognized</Text>
              <Text style={styles.resultSub}>Face does not match any enrolled worker</Text>
            </>
          )}

          <TouchableOpacity style={styles.btn} onPress={tryAgain}>
            <Text style={styles.btnText}>Try Again</Text>
          </TouchableOpacity>
          {navigation && (
            <TouchableOpacity style={styles.linkBtn} onPress={navigation.goBack}>
              <Text style={styles.linkText}>← Back</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  title: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  statusText: {
    color: '#AAA',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 12,
  },
  bigIcon: {
    fontSize: 56,
    marginBottom: 12,
  },
  btn: {
    backgroundColor: '#00C896',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
    marginTop: 24,
  },
  btnText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  linkBtn: {
    marginTop: 16,
  },
  linkText: {
    color: '#888',
    fontSize: 15,
  },
  // Camera overlay
  boundingBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#00C896',
    borderRadius: 4,
  },
  scanOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingVertical: 24,
    paddingBottom: 48,
    alignItems: 'center',
  },
  scanText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '500',
  },
  // Result card
  resultCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0F0F0F',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 32,
    paddingBottom: 48,
    alignItems: 'center',
  },
  resultIcon: {
    fontSize: 64,
    marginBottom: 8,
  },
  successColor: { color: '#00C896' },
  failColor:    { color: '#FF4444' },
  warnColor:    { color: '#FFB020' },
  resultName: {
    color: '#FFF',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  resultTitle: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  resultConf: {
    color: '#888',
    fontSize: 16,
    marginTop: 6,
  },
  resultSub: {
    color: '#888',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
  },
  latencyBadge: {
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#00C896',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
    marginTop: 12,
  },
  latencyText: {
    color: '#00C896',
    fontSize: 13,
    fontWeight: '600',
  },
});
