// ==================== MODEL REGISTRY ====================
// Single source of truth for available models.
// Add or remove entries here; the admin UI dropdowns update automatically.

import { JobBackend } from '../types';

export interface ModelOption {
  id: string;
  label: string;
  description: string;
  backend: JobBackend | JobBackend[]; // which backend(s) this model runs on
}

export interface VoiceOption {
  id: string;
  label: string;
  ttsModel: string; // which TTS model this voice belongs to
  description: string;
  sampleUrl?: string;
}

// ==================== LLM MODELS ====================

export const LLM_MODELS: ModelOption[] = [
  // Local models — primary
  {
    id: 'lmstudio-local',
    label: 'LM Studio (Local)',
    description: 'Run any model via LM Studio on your Mac',
    backend: 'local',
  },
  {
    id: 'ollama-local',
    label: 'Ollama (Local)',
    description: 'Run any model via Ollama on your Mac',
    backend: 'local',
  },
  // API models (Gemini)
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    description: 'Google, fast and free, excellent quality',
    backend: 'api',
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    description: 'Google, best quality, free tier available',
    backend: 'api',
  },
];

// ==================== TTS MODELS ====================

export const TTS_MODELS: ModelOption[] = [
  // Local TTS
  {
    id: 'qwen3-base',
    label: 'Qwen3 Base Clone',
    description: 'Local voice cloning using sample_voices reference pairs',
    backend: 'local',
  },
  {
    id: 'dms',
    label: 'Kyutai DMS TTS 1.6B',
    description: 'Kyutai delayed-streams TTS (GPU recommended)',
    backend: 'local',
  },
  // API TTS
  {
    id: 'gemini-tts-flash',
    label: 'Gemini TTS Flash',
    description: 'Google Gemini 2.5 Flash TTS, free tier',
    backend: 'api',
  },
  {
    id: 'gemini-tts-pro',
    label: 'Gemini TTS Pro',
    description: 'Google Gemini 2.5 Pro TTS, higher quality',
    backend: 'api',
  },
];

// ==================== VOICES ====================

export const TTS_VOICES: VoiceOption[] = [
  // DMS voices (Kyutai)
  {
    id: 'expresso/ex03-ex01_happy_001_channel1_334s.wav',
    label: 'Nolan',
    ttsModel: 'dms',
    description: 'Kyutai DMS voice (Expresso, happy)',
    sampleUrl: 'https://huggingface.co/kyutai/tts-voices/resolve/main/expresso/ex03-ex01_happy_001_channel1_334s.wav',
  },
  {
    id: 'expresso/ex03-ex01_calm_001_channel1_1143s.wav',
    label: 'Gavin',
    ttsModel: 'dms',
    description: 'Kyutai DMS voice (Expresso, calm)',
    sampleUrl: 'https://huggingface.co/kyutai/tts-voices/resolve/main/expresso/ex03-ex01_calm_001_channel1_1143s.wav',
  },
  {
    id: 'vctk/p226_023.wav',
    label: 'Hugo',
    ttsModel: 'dms',
    description: 'Kyutai DMS voice (VCTK)',
    sampleUrl: 'https://huggingface.co/kyutai/tts-voices/resolve/main/vctk/p226_023.wav',
  },
  {
    id: 'vctk/p225_023.wav',
    label: 'Mila',
    ttsModel: 'dms',
    description: 'Kyutai DMS voice (VCTK)',
    sampleUrl: 'https://huggingface.co/kyutai/tts-voices/resolve/main/vctk/p225_023.wav',
  },
  {
    id: 'vctk/p227_023.wav',
    label: 'Simon',
    ttsModel: 'dms',
    description: 'Kyutai DMS voice (VCTK)',
    sampleUrl: 'https://huggingface.co/kyutai/tts-voices/resolve/main/vctk/p227_023.wav',
  },
  {
    id: 'vctk/p228_023.wav',
    label: 'Noa',
    ttsModel: 'dms',
    description: 'Kyutai DMS voice (VCTK)',
    sampleUrl: 'https://huggingface.co/kyutai/tts-voices/resolve/main/vctk/p228_023.wav',
  },
  {
    id: 'vctk/p229_023.wav',
    label: 'Luna',
    ttsModel: 'dms',
    description: 'Kyutai DMS voice (VCTK)',
    sampleUrl: 'https://huggingface.co/kyutai/tts-voices/resolve/main/vctk/p229_023.wav',
  },
  {
    id: 'vctk/p230_023.wav',
    label: 'Eva',
    ttsModel: 'dms',
    description: 'Kyutai DMS voice (VCTK)',
    sampleUrl: 'https://huggingface.co/kyutai/tts-voices/resolve/main/vctk/p230_023.wav',
  },
  {
    id: 'vctk/p231_023.wav',
    label: 'Iris',
    ttsModel: 'dms',
    description: 'Kyutai DMS voice (VCTK)',
    sampleUrl: 'https://huggingface.co/kyutai/tts-voices/resolve/main/vctk/p231_023.wav',
  },
  {
    id: 'vctk/p232_023.wav',
    label: 'Leo',
    ttsModel: 'dms',
    description: 'Kyutai DMS voice (VCTK)',
    sampleUrl: 'https://huggingface.co/kyutai/tts-voices/resolve/main/vctk/p232_023.wav',
  },
  {
    id: 'vctk/p233_023.wav',
    label: 'Aria',
    ttsModel: 'dms',
    description: 'Kyutai DMS voice (VCTK)',
    sampleUrl: 'https://huggingface.co/kyutai/tts-voices/resolve/main/vctk/p233_023.wav',
  },
  {
    id: 'vctk/p234_023.wav',
    label: 'Nora',
    ttsModel: 'dms',
    description: 'Kyutai DMS voice (VCTK)',
    sampleUrl: 'https://huggingface.co/kyutai/tts-voices/resolve/main/vctk/p234_023.wav',
  },
  // Qwen3 Base cloned voices
  {
    id: 'declutter_the_mind_7s',
    label: 'Declutter Sample (7s)',
    ttsModel: 'qwen3-base',
    description: 'Clone voice from sample_voices/declutter_the_mind_7s.wav',
  },
  {
    id: 'laura_qwen',
    label: 'Laura Qwen',
    ttsModel: 'qwen3-base',
    description: 'Clone voice from sample_voices/laura_qwen.wav',
  },
  // Gemini TTS voices
  {
    id: 'gemini-default',
    label: 'Gemini Default',
    ttsModel: 'gemini-tts-flash',
    description: 'Default Gemini TTS voice',
  },
  {
    id: 'gemini-default-pro',
    label: 'Gemini Default',
    ttsModel: 'gemini-tts-pro',
    description: 'Default Gemini Pro TTS voice',
  },
];

// ==================== HELPERS ====================

function matchesBackend(
  modelBackend: JobBackend | JobBackend[],
  target: JobBackend
): boolean {
  if (Array.isArray(modelBackend)) {
    return modelBackend.includes(target);
  }
  return modelBackend === target;
}

export function getLLMModelsForBackend(backend: JobBackend): ModelOption[] {
  return LLM_MODELS.filter((m) => matchesBackend(m.backend, backend));
}

export function getTTSModelsForBackend(backend: JobBackend): ModelOption[] {
  return TTS_MODELS.filter((m) => matchesBackend(m.backend, backend));
}

export function getVoicesForTTSModel(ttsModelId: string): VoiceOption[] {
  return TTS_VOICES.filter((v) => v.ttsModel === ttsModelId);
}

export function getDefaultLLMModel(backend: JobBackend = 'local'): string {
  const models = getLLMModelsForBackend(backend);
  return models.length > 0 ? models[0].id : LLM_MODELS[0].id;
}

export function getDefaultTTSModel(backend: JobBackend = 'local'): string {
  const models = getTTSModelsForBackend(backend);
  return models.length > 0 ? models[0].id : TTS_MODELS[0].id;
}

export function getDefaultVoice(ttsModelId: string): string {
  const voices = getVoicesForTTSModel(ttsModelId);
  return voices.length > 0 ? voices[0].id : '';
}

export function getVoiceLabelById(voiceId: string): string {
  const voice = TTS_VOICES.find((v) => v.id === voiceId);
  return voice?.label ?? voiceId;
}
