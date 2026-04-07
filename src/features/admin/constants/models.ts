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
  {
    id: 'lmstudio-local',
    label: 'LM Studio (Local)',
    description: 'Run any model via LM Studio on your Mac',
    backend: 'local',
  },
];

// ==================== TTS MODELS ====================

export const TTS_MODELS: ModelOption[] = [
  {
    id: 'qwen3-base',
    label: 'Qwen3 Base Clone',
    description: 'Local voice cloning using sample_voices reference pairs',
    backend: 'local',
  },
];

// ==================== VOICES ====================

export const TTS_VOICES: VoiceOption[] = [
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
