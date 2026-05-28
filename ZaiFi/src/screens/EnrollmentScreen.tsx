import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  StyleSheet,
  Text,
  TextInput,
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
import { runFaceDetection, ANCHORS } from '../engines/faceDetection';
import { checkQuality } from '../engines/qualityGate';
import { runFaceEmbedding } from '../engines/faceEmbedding';
import { insertUser, saveEmbedding } from '../storage/database';

const CAPTURE_TARGET = 5;
const CAPTURE_INTERVAL_MS = 800;
const { width: SW, height: SH } = Dimensions.get('window');
const OVAL_W = SW * 0.72;
const OVAL_H = OVAL_W * 1.28;

function averageEmbeddings(embeddings: Float32Array[]): Float32Array {
  const size = embeddings[0].length;
  const result = new Float32Array(size);
  for (const emb of embeddings) {
    for (let i = 0; i < size; i++) result[i] += emb[i];
  }
  for (let i = 0; i < size; i++) result[i] /= embeddings.length;
  return result;
}

type Phase = 'input' | 'capturing' | 'saving' | 'success' | 'error';

interface Props {
  navigation?: { goBack: () => void };
}

export function EnrollmentScreen({ navigation }: Props) {
  const [phase, setPhase]           = useState<Phase>('input');
  const [name, setName]             = useState('');
  const [progress, setProgress]     = useState(0);
  const [errorMsg, setErrorMsg]     = useState('');
  const [faceDetected, setFaceDetected] = useState(false);

  // Animations
  const ovalPulse   = useRef(new Animated.Value(1)).current;
  const ovalOpacity = useRef(new Animated.Value(0.5)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const pulseLoop   = useRef<Animated.CompositeAnimation | null>(null);

  const collectedEmbeddings = useRef<Float32Array[]>([]);
  // createSynchronizable creates a true JSI-backed cross-thread value.
  // getDirty() / setBlocking() work from both JS thread and worklet thread.
  // No captureState.active needed — camera unmounting stops the worklet naturally.
  const manualTrigger = React.useMemo(() => createSynchronizable<boolean>(false), []);
  // wState is worklet-local; only the worklet reads/writes lastCapture.
  const wState   = React.useMemo(() => ({ lastCapture: 0 }), []);
  const throttle = React.useMemo(() => ({ count: 0 }), []);

  const { hasPermission, requestPermission } = useCameraPermission();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const blazeface     = useTensorflowModel(require('../assets/models/blazeface_short.tflite'), []);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mobilefacenet = useTensorflowModel(require('../assets/models/mobilefacenet.tflite'), []);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // Pulse animation when face is detected
  useEffect(() => {
    if (faceDetected) {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ovalPulse,   { toValue: 1.03, duration: 600, useNativeDriver: true }),
            Animated.timing(ovalOpacity, { toValue: 1,    duration: 600, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ovalPulse,   { toValue: 1,    duration: 600, useNativeDriver: true }),
            Animated.timing(ovalOpacity, { toValue: 0.75, duration: 600, useNativeDriver: true }),
          ]),
        ]),
      );
      pulseLoop.current.start();
    } else {
      pulseLoop.current?.stop();
      Animated.parallel([
        Animated.timing(ovalPulse,   { toValue: 1,   duration: 200, useNativeDriver: true }),
        Animated.timing(ovalOpacity, { toValue: 0.4, duration: 200, useNativeDriver: true }),
      ]).start();
    }
    return () => pulseLoop.current?.stop();
  }, [faceDetected, ovalPulse, ovalOpacity]);

  // DB save on 'saving' phase
  useEffect(() => {
    if (phase !== 'saving') return;
    (async () => {
      try {
        const avg  = averageEmbeddings(collectedEmbeddings.current);
        const user = await insertUser(name.trim());
        await saveEmbedding(user.id, avg);
        // Animate success icon
        Animated.spring(successScale, { toValue: 1, useNativeDriver: true, bounciness: 12 }).start();
        setPhase('success');
      } catch (err) {
        setErrorMsg((err as Error).message ?? 'Failed to save enrollment');
        setPhase('error');
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const onEmbeddingCaptured = useCallback(
    (arr: number[]) => {
      // Guard: ignore extras that arrive before the camera unmounts
      if (collectedEmbeddings.current.length >= CAPTURE_TARGET) return;
      collectedEmbeddings.current.push(new Float32Array(arr));
      const count = collectedEmbeddings.current.length;
      setProgress(count);
      if (count >= CAPTURE_TARGET) {
        setPhase('saving');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onFaceUpdate = useCallback((detected: boolean) => {
    setFaceDetected(detected);
  }, []);

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet';
      throttle.count = (throttle.count + 1) % 3;
      if (throttle.count !== 0) { frame.dispose(); return; }

      const bfModel  = blazeface.model;
      const mfnModel = mobilefacenet.model;
      if (!bfModel || !mfnModel) { frame.dispose(); return; }

      const detection = runFaceDetection(frame, bfModel, ANCHORS);
      const quality   = detection
        ? checkQuality(detection.box, frame.width, frame.height)
        : { passed: false };
      runOnJS(onFaceUpdate)(quality.passed);

      // No active flag needed — camera is only rendered during 'capturing' phase.
      // getDirty() reads from the JSI-backed synchronizable (true cross-thread).
      const forceCapture = manualTrigger.getDirty();
      if (forceCapture) {
        // Reset immediately so button can be tapped again
        manualTrigger.setBlocking(false);
      } else if (!quality.passed) {
        frame.dispose();
        return;
      }

      const now = Date.now();
      if (!forceCapture && now - wState.lastCapture < CAPTURE_INTERVAL_MS) {
        frame.dispose();
        return;
      }
      wState.lastCapture = now;

      // Use detected box if available; fall back to centre-crop (60% of frame)
      const box = detection
        ? detection.box
        : { x: 0.2, y: 0.1, width: 0.6, height: 0.8 };

      const embedding = runFaceEmbedding(frame, box, mfnModel);
      frame.dispose();

      if (embedding) {
        const plain: number[] = [];
        for (let i = 0; i < embedding.length; i++) plain.push(embedding[i]);
        runOnJS(onEmbeddingCaptured)(plain);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blazeface.model, mobilefacenet.model, onEmbeddingCaptured, onFaceUpdate],
  );

  const frameOutput = useFrameOutput({ pixelFormat: 'rgb', dropFramesWhileBusy: true, onFrame });

  function startCapture() {
    collectedEmbeddings.current = [];
    manualTrigger.setBlocking(false); // clear any stale trigger from previous session
    setProgress(0);
    setFaceDetected(false);
    setPhase('capturing');
  }

  function resetToInput() {
    manualTrigger.setBlocking(false);
    collectedEmbeddings.current = [];
    successScale.setValue(0);
    setProgress(0);
    setFaceDetected(false);
    setErrorMsg('');
    setPhase('input');
  }

  const modelsReady = blazeface.state === 'loaded' && mobilefacenet.state === 'loaded';

  // -----------------------------------------------------------------------------
  // INPUT PHASE
  // -----------------------------------------------------------------------------
  if (phase === 'input') {
    return (
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.inputHeader}>
          <View style={styles.iconCircle}>
            <Text style={styles.iconText}>👤</Text>
          </View>
          <Text style={styles.inputTitle}>Enroll New Worker</Text>
          <Text style={styles.inputSubtitle}>
            Enter the worker's name then position{'\n'}their face in the camera frame
          </Text>
        </View>

        {/* Steps */}
        <View style={styles.steps}>
          {['Enter Name', 'Scan Face', 'Done'].map((s, i) => (
            <View key={s} style={styles.step}>
              <View style={[styles.stepDot, i === 0 && styles.stepDotActive]}>
                <Text style={[styles.stepNum, i === 0 && styles.stepNumActive]}>{i + 1}</Text>
              </View>
              <Text style={[styles.stepLabel, i === 0 && styles.stepLabelActive]}>{s}</Text>
              {i < 2 && <View style={styles.stepLine} />}
            </View>
          ))}
        </View>

        {/* Input card */}
        <View style={styles.inputCard}>
          <Text style={styles.inputLabel}>Worker Full Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Arjun Kumar"
            placeholderTextColor="#555"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            returnKeyType="done"
            autoFocus
          />
          <TouchableOpacity
            style={[styles.startBtn, !name.trim() && styles.startBtnDisabled]}
            onPress={startCapture}
            disabled={!name.trim()}
            activeOpacity={0.85}
          >
            <Text style={styles.startBtnText}>
              {name.trim() ? `Start Enrollment for ${name.trim().split(' ')[0]}` : 'Start Enrollment'}
            </Text>
          </TouchableOpacity>
        </View>

        {navigation && (
          <TouchableOpacity style={styles.backBtn} onPress={navigation.goBack}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // -----------------------------------------------------------------------------
  // SAVING PHASE
  // -----------------------------------------------------------------------------
  if (phase === 'saving') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#00C896" />
        <Text style={styles.savingText}>Saving biometric profile…</Text>
        <Text style={styles.savingSubText}>This only takes a moment</Text>
      </View>
    );
  }

  // -----------------------------------------------------------------------------
  // SUCCESS PHASE
  // -----------------------------------------------------------------------------
  if (phase === 'success') {
    return (
      <View style={styles.container}>
        <Animated.View style={[styles.successCircle, { transform: [{ scale: successScale }] }]}>
          <Text style={styles.successCheckmark}>✓</Text>
        </Animated.View>
        <Text style={styles.successTitle}>Enrolled!</Text>
        <Text style={styles.successName}>{name}</Text>
        <Text style={styles.successSub}>
          Biometric profile saved.{'\n'}Ready for offline authentication.
        </Text>
        <TouchableOpacity style={styles.startBtn} onPress={resetToInput}>
          <Text style={styles.startBtnText}>Enroll Another Worker</Text>
        </TouchableOpacity>
        {navigation && (
          <TouchableOpacity style={styles.backBtn} onPress={navigation.goBack}>
            <Text style={styles.backText}>← Back to Home</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // -----------------------------------------------------------------------------
  // ERROR PHASE
  // ------------------------------------------------------------------------------------------------------------------------------
  if (phase === 'error') {
    return (
      <View style={styles.container}>
        <View style={styles.errorCircle}>
          <Text style={styles.errorX}>X</Text>
        </View>
        <Text style={styles.errorTitle}>Enrollment Failed</Text>
        <Text style={styles.errorMsg}>{errorMsg}</Text>
        <TouchableOpacity style={styles.startBtn} onPress={resetToInput}>
          <Text style={styles.startBtnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // CAMERA PERMISSION
  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.permText}>Camera permission required</Text>
        <TouchableOpacity style={styles.startBtn} onPress={requestPermission}>
          <Text style={styles.startBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // CAPTURING PHASE
  const ovalColor = faceDetected ? '#00C896' : 'rgba(255,255,255,0.45)';

  return (
    <View style={StyleSheet.absoluteFill}>
      <Camera
        style={StyleSheet.absoluteFill}
        device="front"
        isActive
        outputs={[frameOutput]}
        mirrorMode="auto"
      />
      <View style={styles.vignetteTop} pointerEvents="none" />
      <View style={styles.ovalWrap} pointerEvents="none">
        <Animated.View
          style={[styles.ovalGuide, { borderColor: ovalColor, opacity: ovalOpacity, transform: [{ scale: ovalPulse }] }]}
        />
        <View style={[styles.corner, styles.cornerTL, { borderColor: ovalColor }]} />
        <View style={[styles.corner, styles.cornerTR, { borderColor: ovalColor }]} />
        <View style={[styles.corner, styles.cornerBL, { borderColor: ovalColor }]} />
        <View style={[styles.corner, styles.cornerBR, { borderColor: ovalColor }]} />
      </View>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.topName}>{name}</Text>
          <Text style={styles.topHint}>
            {!modelsReady ? 'Loading AI models...' : faceDetected ? 'Face detected - hold still' : 'Align face in the oval'}
          </Text>
        </View>
        <TouchableOpacity style={styles.cancelBtn} onPress={resetToInput} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.bottomPanel}>
        <View style={styles.dotsRow}>
          {Array.from({ length: CAPTURE_TARGET }).map((_, i) => (
            <View key={i} style={[styles.dot, i < progress && styles.dotFilled, i === progress && faceDetected && styles.dotNext]} />
          ))}
        </View>
        <Text style={styles.captureLabel}>
          {progress === 0 ? 'Capturing biometric data...' : progress < CAPTURE_TARGET ? `${progress} of ${CAPTURE_TARGET} samples captured` : 'Processing...'}
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${(progress / CAPTURE_TARGET) * 100}%` as any }]} />
        </View>
        <TouchableOpacity
          style={[styles.captureBtn, !faceDetected && styles.captureBtnDim]}
          onPress={() => { manualTrigger.setBlocking(true); }}
          activeOpacity={0.75}
        >
          <Text style={styles.captureBtnText}>
            {'TAP TO CAPTURE  ' + (progress + 1) + '/' + CAPTURE_TARGET}
          </Text>
        </TouchableOpacity>
        <Text style={styles.bottomHint}>
          {faceDetected ? 'Or stay still - captures automatically' : 'Move closer or improve lighting'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A', alignItems: 'center', justifyContent: 'center', padding: 28 },
  inputHeader: { alignItems: 'center', marginBottom: 28 },
  iconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#0D2B22', borderWidth: 1, borderColor: '#00C896', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  iconText: { fontSize: 32 },
  inputTitle: { color: '#FFF', fontSize: 24, fontWeight: '800', letterSpacing: 0.3 },
  inputSubtitle: { color: '#666', fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  steps: { flexDirection: 'row', alignItems: 'center', marginBottom: 28 },
  step: { flexDirection: 'row', alignItems: 'center' },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#333', alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: '#00C896', borderColor: '#00C896' },
  stepNum: { color: '#555', fontSize: 12, fontWeight: '700' },
  stepNumActive: { color: '#000' },
  stepLabel: { color: '#444', fontSize: 11, marginLeft: 6, marginRight: 4 },
  stepLabelActive: { color: '#00C896' },
  stepLine: { width: 24, height: 1, backgroundColor: '#222', marginHorizontal: 4 },
  inputCard: { width: '100%', backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 16, padding: 20, marginBottom: 8 },
  inputLabel: { color: '#888', fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 10 },
  input: { backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 10, padding: 14, color: '#FFF', fontSize: 17, marginBottom: 16 },
  startBtn: { backgroundColor: '#00C896', borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  startBtnDisabled: { opacity: 0.3 },
  startBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
  backBtn: { marginTop: 20 },
  backText: { color: '#555', fontSize: 14 },
  savingText: { color: '#FFF', fontSize: 18, fontWeight: '600', marginTop: 20 },
  savingSubText: { color: '#555', fontSize: 14, marginTop: 6 },
  successCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#0D2B22', borderWidth: 2, borderColor: '#00C896', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  successCheckmark: { color: '#00C896', fontSize: 48, fontWeight: '700' },
  successTitle: { color: '#FFF', fontSize: 26, fontWeight: '800', marginBottom: 4 },
  successName: { color: '#00C896', fontSize: 18, fontWeight: '600', marginBottom: 12 },
  successSub: { color: '#666', fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 28 },
  errorCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#2B0D0D', borderWidth: 2, borderColor: '#FF4444', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  errorX: { color: '#FF4444', fontSize: 48, fontWeight: '700' },
  errorTitle: { color: '#FFF', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  errorMsg: { color: '#FF6666', fontSize: 14, textAlign: 'center', marginBottom: 24 },
  permText: { color: '#AAA', fontSize: 16, marginBottom: 20 },
  vignetteTop: { position: 'absolute', top: 0, left: 0, right: 0, height: SH * 0.18, backgroundColor: 'rgba(0,0,0,0.55)' },
  ovalWrap: { position: 'absolute', top: SH * 0.13, alignSelf: 'center', width: OVAL_W, height: OVAL_H, alignItems: 'center', justifyContent: 'center' },
  ovalGuide: { width: OVAL_W, height: OVAL_H, borderRadius: OVAL_W / 2, borderWidth: 2.5, position: 'absolute' },
  corner: { position: 'absolute', width: 28, height: 28 },
  cornerTL: { top: -1, left: -1, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 6 },
  cornerTR: { top: -1, right: -1, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
  cornerBL: { bottom: -1, left: -1, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: -1, right: -1, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: 52, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: 'rgba(0,0,0,0.6)' },
  topName: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  topHint: { color: '#AAA', fontSize: 13, marginTop: 3 },
  cancelBtn: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  cancelText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  bottomPanel: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(10,10,10,0.92)', paddingTop: 22, paddingBottom: 44, paddingHorizontal: 28, alignItems: 'center', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  dotsRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#2A2A2A', borderWidth: 1.5, borderColor: '#3A3A3A' },
  dotFilled: { backgroundColor: '#00C896', borderColor: '#00C896' },
  dotNext: { borderColor: '#00C896', backgroundColor: 'transparent' },
  captureLabel: { color: '#FFF', fontSize: 16, fontWeight: '600', marginBottom: 14 },
  progressTrack: { width: '100%', height: 4, backgroundColor: '#1E1E1E', borderRadius: 2, overflow: 'hidden', marginBottom: 10 },
  progressFill: { height: '100%', backgroundColor: '#00C896', borderRadius: 2 },
  bottomHint: { color: '#555', fontSize: 12, textAlign: 'center', marginTop: 10 },
  captureBtn: { width: '100%', backgroundColor: '#00C896', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 4, marginTop: 6 },
  captureBtnDim: { backgroundColor: '#1A3A2E', opacity: 0.6 },
  captureBtnText: { color: '#000', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
});
