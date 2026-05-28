import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { runOnJS } from 'react-native-worklets';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { runFaceDetection, ANCHORS } from '../engines/faceDetection';
import { checkQuality } from '../engines/qualityGate';
import { runFaceEmbedding } from '../engines/faceEmbedding';
import { insertUser, saveEmbedding } from '../storage/database';

const CAPTURE_TARGET = 5;
const CAPTURE_INTERVAL_MS = 800;

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
  const [phase, setPhase] = useState<Phase>('input');
  const [name, setName] = useState('');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  const collectedEmbeddings = useRef<Float32Array[]>([]);
  // Mutable object shared with the worklet closure for capture control.
  // Using useMemo (same pattern as CameraScreen throttle) keeps the reference stable.
  const captureState = React.useMemo(
    () => ({ active: false, lastCapture: 0 }),
    [],
  );
  const throttle = React.useMemo(() => ({ count: 0 }), []);

  const { hasPermission, requestPermission } = useCameraPermission();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const blazeface = useTensorflowModel(require('../assets/models/blazeface_short.tflite'), []);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mobilefacenet = useTensorflowModel(require('../assets/models/mobilefacenet.tflite'), []);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // Handle async DB save when phase transitions to 'saving'
  useEffect(() => {
    if (phase !== 'saving') return;
    (async () => {
      try {
        const avg = averageEmbeddings(collectedEmbeddings.current);
        const user = await insertUser(name.trim());
        await saveEmbedding(user.id, avg);
        setPhase('success');
      } catch (err) {
        setErrorMsg((err as Error).message ?? 'Failed to save enrollment');
        setPhase('error');
      }
    })();
  // name is intentionally captured when phase becomes 'saving' and won't change mid-save
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Receives embedding array from the worklet thread (called via runOnJS)
  const onEmbeddingCaptured = useCallback(
    (arr: number[]) => {
      collectedEmbeddings.current.push(new Float32Array(arr));
      const count = collectedEmbeddings.current.length;
      setProgress(count);
      if (count >= CAPTURE_TARGET) {
        captureState.active = false;
        setPhase('saving');
      }
    },
    // Stable deps: captureState is useMemo, setPhase/setProgress are stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet';
      if (!captureState.active) {
        frame.dispose();
        return;
      }

      // Process every 3rd frame (~10 fps effective)
      throttle.count = (throttle.count + 1) % 3;
      if (throttle.count !== 0) {
        frame.dispose();
        return;
      }

      const bfModel = blazeface.model;
      const mfnModel = mobilefacenet.model;
      if (!bfModel || !mfnModel) {
        frame.dispose();
        return;
      }

      const detection = runFaceDetection(frame, bfModel, ANCHORS);
      if (!detection) {
        frame.dispose();
        return;
      }

      const quality = checkQuality(detection.box, frame.width, frame.height);
      if (!quality.passed) {
        frame.dispose();
        return;
      }

      // Enforce minimum gap between captures for embedding variety
      const now = Date.now();
      if (now - captureState.lastCapture < CAPTURE_INTERVAL_MS) {
        frame.dispose();
        return;
      }
      captureState.lastCapture = now;

      const embedding = runFaceEmbedding(frame, detection.box, mfnModel);
      frame.dispose();

      if (embedding) {
        // Convert typed array to plain array for cross-thread transfer
        const plain: number[] = [];
        for (let i = 0; i < embedding.length; i++) plain.push(embedding[i]);
        runOnJS(onEmbeddingCaptured)(plain);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blazeface.model, mobilefacenet.model, onEmbeddingCaptured],
  );

  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    dropFramesWhileBusy: true,
    onFrame,
  });

  function startCapture() {
    collectedEmbeddings.current = [];
    captureState.active = true;
    captureState.lastCapture = 0;
    setProgress(0);
    setPhase('capturing');
  }

  function resetToInput() {
    captureState.active = false;
    collectedEmbeddings.current = [];
    setProgress(0);
    setErrorMsg('');
    setPhase('input');
  }

  // ── Input phase ───────────────────────────────────────────────
  if (phase === 'input') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Enroll New Worker</Text>
        <Text style={styles.label}>Worker Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter full name"
          placeholderTextColor="#666"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          returnKeyType="done"
        />
        <TouchableOpacity
          style={[styles.btn, !name.trim() && styles.btnDisabled]}
          onPress={startCapture}
          disabled={!name.trim()}
        >
          <Text style={styles.btnText}>Start Enrollment</Text>
        </TouchableOpacity>
        {navigation && (
          <TouchableOpacity style={styles.linkBtn} onPress={navigation.goBack}>
            <Text style={styles.linkText}>← Back</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ── Saving phase ──────────────────────────────────────────────
  if (phase === 'saving') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#00C896" />
        <Text style={styles.statusText}>Saving enrollment…</Text>
      </View>
    );
  }

  // ── Success phase ─────────────────────────────────────────────
  if (phase === 'success') {
    return (
      <View style={styles.container}>
        <Text style={styles.bigIcon}>✓</Text>
        <Text style={styles.title}>Enrolled!</Text>
        <Text style={styles.statusText}>{name} has been registered.</Text>
        <TouchableOpacity style={styles.btn} onPress={resetToInput}>
          <Text style={styles.btnText}>Enroll Another</Text>
        </TouchableOpacity>
        {navigation && (
          <TouchableOpacity style={styles.linkBtn} onPress={navigation.goBack}>
            <Text style={styles.linkText}>← Back to Home</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ── Error phase ───────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <View style={styles.container}>
        <Text style={[styles.bigIcon, styles.errorColor]}>✗</Text>
        <Text style={styles.title}>Enrollment Failed</Text>
        <Text style={styles.errorText}>{errorMsg}</Text>
        <TouchableOpacity style={styles.btn} onPress={resetToInput}>
          <Text style={styles.btnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Capturing phase ───────────────────────────────────────────
  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.statusText}>Camera permission required</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const modelsReady =
    blazeface.state === 'loaded' && mobilefacenet.state === 'loaded';

  return (
    <View style={StyleSheet.absoluteFill}>
      <Camera
        style={StyleSheet.absoluteFill}
        device="front"
        isActive
        outputs={[frameOutput]}
        mirrorMode="auto"
      />
      <View style={styles.captureOverlay} pointerEvents="none">
        <Text style={styles.captureName}>{name}</Text>
        <Text style={styles.captureCount}>
          {progress} / {CAPTURE_TARGET}
        </Text>
        {/* Flex-based progress bar — no percentage string needed */}
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { flex: progress }]} />
          <View style={{ flex: Math.max(CAPTURE_TARGET - progress, 0) }} />
        </View>
        <Text style={styles.captureHint}>
          {modelsReady
            ? 'Keep your face centred and still'
            : 'Loading models…'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  label: {
    color: '#AAAAAA',
    fontSize: 14,
    alignSelf: 'flex-start',
    marginBottom: 8,
    marginTop: 24,
  },
  input: {
    width: '100%',
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 10,
    padding: 14,
    color: '#FFF',
    fontSize: 16,
    marginBottom: 24,
  },
  btn: {
    backgroundColor: '#00C896',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: {
    opacity: 0.35,
  },
  btnText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  linkBtn: {
    marginTop: 20,
  },
  linkText: {
    color: '#888',
    fontSize: 15,
  },
  statusText: {
    color: '#CCC',
    fontSize: 16,
    marginTop: 16,
    textAlign: 'center',
  },
  bigIcon: {
    color: '#00C896',
    fontSize: 64,
    marginBottom: 8,
  },
  errorColor: {
    color: '#FF4444',
  },
  errorText: {
    color: '#FF6666',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  // Camera / capture overlay
  captureOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.78)',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 48,
    alignItems: 'center',
  },
  captureName: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  captureCount: {
    color: '#00C896',
    fontSize: 36,
    fontWeight: '700',
    marginBottom: 14,
  },
  barTrack: {
    flexDirection: 'row',
    width: '100%',
    height: 8,
    backgroundColor: '#333',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 12,
  },
  barFill: {
    backgroundColor: '#00C896',
    borderRadius: 4,
  },
  captureHint: {
    color: '#AAA',
    fontSize: 13,
  },
});
