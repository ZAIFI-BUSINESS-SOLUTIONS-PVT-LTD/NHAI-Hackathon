import { loadTensorflowModel, type TfliteModel } from 'react-native-fast-tflite';

export interface LoadedModels {
  blazeface: TfliteModel;
  mobilefacenet: TfliteModel;
  antispoof: TfliteModel;
}

let _models: LoadedModels | null = null;

export async function loadAllModels(): Promise<LoadedModels> {
  if (_models) return _models;

  console.log('[ModelLoader] Loading all TFLite models...');
  const t0 = Date.now();

  const [blazeface, mobilefacenet, antispoof] = await Promise.all([
    loadTensorflowModel(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../assets/models/blazeface_short.tflite'),
      ['android-gpu'],
    ),
    loadTensorflowModel(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../assets/models/mobilefacenet.tflite'),
      ['android-gpu'],
    ),
    loadTensorflowModel(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../assets/models/minifasnet_v2.tflite'),
      ['android-gpu'],
    ),
  ]);

  logModelShapes('blazeface', blazeface);
  logModelShapes('mobilefacenet', mobilefacenet);
  logModelShapes('antispoof', antispoof);

  console.log(`[ModelLoader] All models loaded in ${Date.now() - t0}ms`);

  _models = { blazeface, mobilefacenet, antispoof };
  return _models;
}

function logModelShapes(name: string, model: TfliteModel): void {
  const inputs = model.inputs.map(t => `${t.name}:${t.dataType}[${t.shape}]`).join(', ');
  const outputs = model.outputs.map(t => `${t.name}:${t.dataType}[${t.shape}]`).join(', ');
  console.log(`[ModelLoader] ${name} → in: [${inputs}]  out: [${outputs}]`);
}

export function getModels(): LoadedModels {
  if (!_models) throw new Error('Models not loaded — call loadAllModels() first');
  return _models;
}
