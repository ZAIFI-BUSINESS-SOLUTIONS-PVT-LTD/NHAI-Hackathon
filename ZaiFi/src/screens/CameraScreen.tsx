import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  Camera,
  useCameraPermission,
  useFrameOutput,
  type Frame,
} from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import { useTensorflowModel } from 'react-native-fast-tflite';
import {
  runFaceDetection,
  ANCHORS,
  type FaceDetectionResult,
} from '../engines/faceDetection';
import { checkQuality } from '../engines/qualityGate';

export type { Frame };

interface Props {
  onFaceDetected?: (result: FaceDetectionResult | null) => void;
}

export function CameraScreen({ onFaceDetected }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const blazeface = useTensorflowModel(require('../assets/models/blazeface_short.tflite'), ['android-gpu']);

  const [detectedBox, setDetectedBox] = useState<FaceDetectionResult | null>(null);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  const updateBox = useRunOnJS(
    (result: FaceDetectionResult | null) => {
      setDetectedBox(result);
      onFaceDetected?.(result);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onFaceDetected],
  );

  const throttle = React.useMemo(() => ({ count: 0 }), []);

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet';
      throttle.count = (throttle.count + 1) % 3;
      if (throttle.count !== 0) {
        frame.dispose();
        return;
      }

      const model = blazeface.model;
      if (!model) {
        frame.dispose();
        return;
      }

      const result = runFaceDetection(frame, model, ANCHORS);

      if (result) {
        const quality = checkQuality(result.box, frame.width, frame.height);
        updateBox(quality.passed ? result : null);
      } else {
        updateBox(null);
      }

      frame.dispose();
    },
    [blazeface.model, throttle, updateBox],
  );

  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    dropFramesWhileBusy: true,
    onFrame,
  });

  if (!hasPermission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permissionText}>Camera permission required</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <Camera
        style={StyleSheet.absoluteFill}
        device="front"
        isActive={true}
        outputs={[frameOutput]}
        mirrorMode="auto"
      />
      {detectedBox && (
        <View
          pointerEvents="none"
          style={[
            styles.boundingBox,
            {
              left:   `${detectedBox.box.x * 100}%`,
              top:    `${detectedBox.box.y * 100}%`,
              width:  `${detectedBox.box.width * 100}%`,
              height: `${detectedBox.box.height * 100}%`,
            },
          ]}
        />
      )}
      {blazeface.state === 'loading' && (
        <View style={styles.loadingBadge} pointerEvents="none">
          <Text style={styles.loadingText}>Loading model…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  permissionText: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  boundingBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#00C896',
    borderRadius: 4,
  },
  loadingBadge: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  loadingText: {
    color: '#fff',
    fontSize: 13,
  },
});
