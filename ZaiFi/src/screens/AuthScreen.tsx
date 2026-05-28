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
import { runOnJS, createSynchronizable } from 'react-native-worklets';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { runFaceDetection, ANCHORS, type FaceDetectionResult } from '../engines/faceDetection';
import { checkQuality } from '../engines/qualityGate';
import { runFaceEmbedding } from '../engines/faceEmbedding';
import { runLivenessDetection } from '../engines/livenessDetection';
import { processBlink, initBlinkDetector, resetBlinkDetector } from '../engines/blinkDetection';
import { verifyFace } from '../engines/verification';
import type { StoredEmbedding } from '../types/auth';
import {
  getAllEmbeddings,
  getAllUsers,
  logAttendance,
} from '../storage/database';

// -- Types ---------------------------------------------------------------------

type Phase =
  | 'loading'   // loading embeddings from DB
  | 'no-users'  // no enrolled workers yet
  | 'scanning'  // camera active, waiting for face + quality gate
  | 'blink'     // active liveness: user must blink within 5 s
  | 'result';   // auth result ready

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

// Blink-challenge timeout in milliseconds
const BLINK_TIMEOUT_MS = 5000;

// -- Component -----------------------------------------------------------------

export function AuthScreen({ navigation }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [detectedBox, setDetectedBox] = useState<FaceDetectionResult | null>(null);
  const [result, setResult] = useState<AuthResultState | null>(null);
  // Countdown seconds displayed inside the ring (5 -> 0)
  const [blinkSecondsLeft, setBlinkSecondsLeft] = useState(5);
  const blinkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pre-loaded data -- available to JS callbacks
  const storedEmbeddings = useRef<StoredEmbedding[]>([]);
  const userNames = useRef<Map<string, string>>(new Map());

  // pipelineMode: JSI-backed synchronizable — JS-thread mutations (tryAgain, load)
  // are visible inside the worklet runtime. getDirty() = fast non-blocking read;
  // setBlocking() = atomic cross-thread write from JS or worklet.
  //
  //   'scanning' -> quality gate in progress; first passing frame triggers 'blink'
  //   'blink'    -> active blink challenge running; also checking passive liveness
  //   'done'     -> result obtained; worklet should skip all processing
  const pipelineMode = React.useMemo(
    () => createSynchronizable<'scanning' | 'blink' | 'done'>('scanning'),
    [],
  );
  // blinkTimer is worklet-local (only read/written inside worklet; plain object is fine)
  const blinkTimer = React.useMemo(() => ({ ts: 0 }), []);

  // Blink detector state (shared mutable object, same lifetime as component)
  const blinkState = React.useMemo(() => initBlinkDetector(), []);

  // Throttle: every 3rd frame is processed (~10 fps effective)
  const throttle = React.useMemo(() => ({ count: 0 }), []);

  // FPS tracking
  const fpsState = React.useMemo(() => ({ count: 0, lastTs: Date.now() }), []);
  const [fps, setFps] = useState<number | null>(null);

  // Blink-phase 5-second countdown (smooth bar animation)
  const blinkCountdown = useRef(new Animated.Value(BLINK_TIMEOUT_MS)).current;
  const blinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blinkAnimRef    = useRef<Animated.CompositeAnimation | null>(null);

  // Result card animation
  const cardSlide = useRef(new Animated.Value(120)).current;
  const iconScale = useRef(new Animated.Value(0)).current;

  const { hasPermission, requestPermission } = useCameraPermission();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const blazeface     = useTensorflowModel(require('../assets/models/blazeface_short.tflite'), []);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mobilefacenet = useTensorflowModel(require('../assets/models/mobilefacenet.tflite'), []);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const antispoof     = useTensorflowModel(require('../assets/models/minifasnet_v2.tflite'), []);

  // -- Data loading ------------------------------------------------------------

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
        pipelineMode.setBlocking('scanning');
        setPhase('scanning');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- Result card animation ---------------------------------------------------

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

  // -- JS-thread callbacks (called from worklet via runOnJS) -------------------

  const updateBox = useCallback(
    (box: FaceDetectionResult | null) => { setDetectedBox(box); },
    [],
  );

  const updateFps = useCallback(
    (v: number) => { setFps(v); },
    [],
  );

  /**
   * Called when embedding + liveness score are ready (blink confirmed),
   * or with empty embedding + score <= 0.7 for immediate liveness failures.
   */
  const onAuthResult = useCallback(
    (embArr: number[], livenessScore: number, tStart: number) => {
      // Cancel any pending blink timeout + animations
      if (blinkTimeoutRef.current !== null) {
        clearTimeout(blinkTimeoutRef.current);
        blinkTimeoutRef.current = null;
      }
      if (blinkIntervalRef.current !== null) {
        clearInterval(blinkIntervalRef.current);
        blinkIntervalRef.current = null;
      }
      if (blinkAnimRef.current) {
        blinkAnimRef.current.stop();
        blinkAnimRef.current = null;
      }

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

      const incoming   = new Float32Array(embArr);
      const authResult = verifyFace(incoming, storedEmbeddings.current);
      const userName   = authResult.userId
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

  /**
   * Transition from 'scanning' -> 'blink': show overlay, start countdown + timeout.
   * Called via runOnJS from the worklet on the first quality-passing frame.
   */
  const enterBlinkPhase = useCallback(() => {
    resetBlinkDetector(blinkState);
    setDetectedBox(null);
    setBlinkSecondsLeft(5);
    setPhase('blink');

    // Smooth bar animation: Animated.Value from BLINK_TIMEOUT_MS -> 0
    blinkCountdown.setValue(BLINK_TIMEOUT_MS);
    const anim = Animated.timing(blinkCountdown, {
      toValue: 0,
      duration: BLINK_TIMEOUT_MS,
      useNativeDriver: false,
    });
    blinkAnimRef.current = anim;
    anim.start();

    // Per-second tick for the countdown number in the ring
    let secsLeft = 5;
    blinkIntervalRef.current = setInterval(() => {
      secsLeft -= 1;
      setBlinkSecondsLeft(Math.max(0, secsLeft));
      if (secsLeft <= 0 && blinkIntervalRef.current !== null) {
        clearInterval(blinkIntervalRef.current);
        blinkIntervalRef.current = null;
      }
    }, 1000);

    // Hard timeout: liveness failure if no blink within 5 s
    blinkTimeoutRef.current = setTimeout(() => {
      blinkTimeoutRef.current = null;
      if (blinkAnimRef.current) {
        blinkAnimRef.current.stop();
        blinkAnimRef.current = null;
      }
      if (blinkIntervalRef.current !== null) {
        clearInterval(blinkIntervalRef.current);
        blinkIntervalRef.current = null;
      }
      pipelineMode.setBlocking('done');
      logAttendance(null, false, 0).catch(console.error);
      setResult({
        matched: false,
        confidence: 0,
        latencyMs: BLINK_TIMEOUT_MS,
        failReason: 'liveness',
      });
      setPhase('result');
    }, BLINK_TIMEOUT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- Frame processor (worklet) -----------------------------------------------

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet';

      // FPS counter -- runs on every raw frame before any throttle
      fpsState.count++;
      const nowTs = Date.now();
      if (nowTs - fpsState.lastTs >= 1000) {
        const computed = Math.round(fpsState.count * 1000 / (nowTs - fpsState.lastTs));
        runOnJS(updateFps)(computed);
        fpsState.count = 0;
        fpsState.lastTs = nowTs;
      }

      // Gate: pipeline finished -- drop all frames
      if (pipelineMode.getDirty() === 'done') {
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

      // Face detection + quality gate (needed in both scanning and blink phases)
      const detection = runFaceDetection(frame, bfModel, ANCHORS);
      if (!detection) {
        runOnJS(updateBox)(null);
        frame.dispose();
        return;
      }

      const quality = checkQuality(detection.box, frame.width, frame.height);
      runOnJS(updateBox)(quality.passed ? detection : null);
      if (!quality.passed) {
        frame.dispose();
        return;
      }

      // SCANNING: first quality-passing frame -> enter blink challenge
      if (pipelineMode.getDirty() === 'scanning') {
        pipelineMode.setBlocking('blink');
        runOnJS(enterBlinkPhase)();
        frame.dispose();
        return;
      }

      // BLINK phase: throttle liveness + blink checks to ~5 fps (200 ms gap)
      const now = Date.now();
      if (now - blinkTimer.ts < 200) {
        frame.dispose();
        return;
      }
      blinkTimer.ts = now;

      // Passive MiniFASNet check -- fail immediately if spoofed
      const liveness = runLivenessDetection(frame, detection.box, asModel);
      if (liveness.score <= 0.7) {
        pipelineMode.setBlocking('done');
        runOnJS(onAuthResult)([], liveness.score, now);
        frame.dispose();
        return;
      }

      // Active blink check
      const blinkResult = processBlink(frame, detection, blinkState);
      if (!blinkResult.blinkDetected) {
        frame.dispose();
        return;
      }

      // Blink confirmed -> run embedding
      pipelineState.mode = 'done';
      const tStart  = Date.now();
      const embedding = runFaceEmbedding(frame, detection.box, mfnModel);
      frame.dispose();

      if (embedding) {
        const plain: number[] = [];
        for (let i = 0; i < embedding.length; i++) plain.push(embedding[i]);
        runOnJS(onAuthResult)(plain, liveness.score, tStart);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blazeface.model, mobilefacenet.model, antispoof.model,
     updateBox, updateFps, enterBlinkPhase, onAuthResult],
  );

  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    dropFramesWhileBusy: true,
    onFrame,
  });

  // -- Restart auth ------------------------------------------------------------

  function tryAgain() {
    // Cancel all blink timers + animation
    if (blinkTimeoutRef.current !== null) {
      clearTimeout(blinkTimeoutRef.current);
      blinkTimeoutRef.current = null;
    }
    if (blinkIntervalRef.current !== null) {
      clearInterval(blinkIntervalRef.current);
      blinkIntervalRef.current = null;
    }
    if (blinkAnimRef.current) {
      blinkAnimRef.current.stop();
      blinkAnimRef.current = null;
    }

    // Reset blink state + pipeline
    resetBlinkDetector(blinkState);
    pipelineState.mode         = 'scanning';
    pipelineState.lastBlinkRun = 0;
    throttle.count             = 0;

    setBlinkSecondsLeft(5);
    setDetectedBox(null);
    setResult(null);
    setPhase('scanning');
  }

  // -- Render ------------------------------------------------------------------

  if (phase === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#00C896" />
        <Text style={styles.statusText}>Loading enrolled workers...</Text>
      </View>
    );
  }

  if (phase === 'no-users') {
    return (
      <View style={styles.centered}>
        <Text style={styles.bigIcon}>{'👤'}</Text>
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

  // Interpolate countdown ms -> progress fraction [1->0] for ring sweep
  const ringProgress = blinkCountdown.interpolate({
    inputRange:  [0, BLINK_TIMEOUT_MS],
    outputRange: [0, 1],
  });

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Camera -- keep active during both scanning and blink phases */}
      <Camera
        style={StyleSheet.absoluteFill}
        device="front"
        isActive={phase === 'scanning' || phase === 'blink'}
        outputs={[frameOutput]}
        mirrorMode="auto"
      />

      {/* Face bounding box overlay */}
      {(phase === 'scanning' || phase === 'blink') && detectedBox && (
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
            {modelsReady ? 'Look at the camera' : 'Loading models...'}
          </Text>
          {!modelsReady && (
            <ActivityIndicator color="#00C896" style={{ marginTop: 8 }} />
          )}
        </View>
      )}

      {/* Blink challenge overlay */}
      {phase === 'blink' && (
        <View style={styles.blinkOverlay} pointerEvents="none">
          <View style={styles.ringWrap}>
            <View style={styles.ringTrack} />
            <Animated.View
              style={[
                styles.ringFill,
                { transform: [{ scaleX: ringProgress }] },
              ]}
            />
            <View style={styles.ringCentre}>
              <Text style={styles.countdownNumber}>{blinkSecondsLeft}</Text>
            </View>
          </View>
          <Text style={styles.blinkTitle}>Please Blink</Text>
          <Text style={styles.blinkSub}>Natural blink detected automatically</Text>
        </View>
      )}

      {/* FPS counter (top-right, dev info) */}
      {(phase === 'scanning' || phase === 'blink') && fps !== null && (
        <View style={styles.fpsCounter} pointerEvents="none">
          <Text style={styles.fpsText}>{fps} fps</Text>
        </View>
      )}

      {/* Result card -- animated slide-up */}
      {phase === 'result' && result && (
        <Animated.View
          style={[styles.resultCard, { transform: [{ translateY: cardSlide }] }]}
        >
          {result.matched ? (
            <>
              <Animated.Text
                style={[styles.resultIcon, styles.successColor, { transform: [{ scale: iconScale }] }]}
              >{'✓'}</Animated.Text>
              <Text style={styles.resultName}>{result.userName ?? 'Unknown'}</Text>
              <Text style={styles.resultConf}>
                {Math.round(result.confidence * 100)}% confidence
              </Text>
              <View style={styles.latencyBadge}>
                <Text style={styles.latencyText}>
                  {result.latencyMs < 1000
                    ? `${result.latencyMs} ms`
                    : `${(result.latencyMs / 1000).toFixed(1)} s`}
                </Text>
              </View>
            </>
          ) : result.failReason === 'liveness' ? (
            <>
              <Animated.Text
                style={[styles.resultIcon, styles.warnColor, { transform: [{ scale: iconScale }] }]}
              >{'⚠'}</Animated.Text>
              <Text style={styles.resultTitle}>Liveness Check Failed</Text>
              <Text style={styles.resultSub}>Please use a real face</Text>
            </>
          ) : (
            <>
              <Animated.Text
                style={[styles.resultIcon, styles.failColor, { transform: [{ scale: iconScale }] }]}
              >{'✗'}</Animated.Text>
              <Text style={styles.resultTitle}>Not Recognized</Text>
              <Text style={styles.resultSub}>Face does not match any enrolled worker</Text>
            </>
          )}

          <TouchableOpacity style={styles.btn} onPress={tryAgain}>
            <Text style={styles.btnText}>Try Again</Text>
          </TouchableOpacity>
          {navigation && (
            <TouchableOpacity style={styles.linkBtn} onPress={navigation.goBack}>
              <Text style={styles.linkText}>Back</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      )}
    </View>
  );
}

// -- Styles --------------------------------------------------------------------

const RING_SIZE = 112;

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
  fpsCounter: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  fpsText: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
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
  blinkOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.82)',
    paddingTop: 28,
    paddingBottom: 52,
    alignItems: 'center',
  },
  ringWrap: {
    width:  RING_SIZE,
    height: RING_SIZE,
    marginBottom: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringTrack: {
    position: 'absolute',
    width:  RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 6,
    borderColor: '#2A2A2A',
  },
  ringFill: {
    position: 'absolute',
    width:  RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 6,
    borderColor: '#00C896',
  },
  ringCentre: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width:  RING_SIZE,
    height: RING_SIZE,
  },
  countdownNumber: {
    color: '#FFF',
    fontSize: 38,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  blinkTitle: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  blinkSub: {
    color: '#AAA',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  resultCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0E0E12',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: '#222',
    padding: 32,
    paddingBottom: 52,
    alignItems: 'center',
  },
  resultIcon: {
    fontSize: 56,
    marginBottom: 10,
  },
  successColor: { color: '#00C896' },
  failColor:    { color: '#FF4444' },
  warnColor:    { color: '#FFB020' },
  resultName: {
    color: '#FFF',
    fontSize: 30,
    fontWeight: '800',
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
    color: '#666',
    fontSize: 15,
    marginTop: 6,
  },
  resultSub: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  latencyBadge: {
    backgroundColor: 'rgba(0,200,150,0.1)',
    borderWidth: 1,
    borderColor: '#00C896',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginTop: 14,
  },
  latencyText: {
    color: '#00C896',
    fontSize: 14,
    fontWeight: '700',
  },
});
