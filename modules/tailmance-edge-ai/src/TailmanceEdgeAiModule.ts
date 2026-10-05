import { requireOptionalNativeModule } from 'expo';

export type EdgeAiCategory={
  label:string;
  displayName:string|null;
  score:number;
  index:number;
};

export type EdgeAiNativeResult={
  runtime:'coreml-vision'|'mediapipe-tasks-vision';
  modelSha256:string;
  categories:EdgeAiCategory[];
};

type NativeEdgeAiModule={
  isRuntimeAvailableAsync():Promise<boolean>;
  clearModelCacheAsync():Promise<boolean>;
  sha256FileAsync(fileUri:string):Promise<string>;
  classifyImageAsync(modelUri:string,expectedSha256:string,imageUri:string,maxResults:number,scoreThreshold:number):Promise<EdgeAiNativeResult>;
};

export default requireOptionalNativeModule<NativeEdgeAiModule>('TailmanceEdgeAi');
