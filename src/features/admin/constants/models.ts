/**
 * Model and voice registry for content factory execution.
 *
 * ARCHITECTURAL ROLE:
 * This is the single source of truth for available ML models (LLM + TTS) and voices.
 * The registry decouples model availability from UI components via config-driven patterns.
 *
 * DESIGN PATTERNS:
 * - Configuration as Code: Models defined declaratively; UI auto-generates dropdowns
 * - Backend abstraction: JobBackend enum allows swapping execution environments without code changes
 * - Voice profiles: VoiceOption bundles voice ID, metadata, and sample assets for preview
 *
 * WORKFLOW:
 * 1. Admin selects backend (local/api)
 * 2. getLLMModelsForBackend() returns available LLM models
 * 3. Admin selects LLM model -> getTTSModelsForBackend() filters TTS models
 * 4. Admin selects TTS model -> getVoicesForTTSModel() filters voices
 * 5. Voice preview plays sampleAsset (local) or sampleUrl (remote)
 */

import { JobBackend } from '../types';

/**
 * Describes an ML model (LLM or TTS) and its deployment target(s).
 * Models are backend-agnostic; filtering by backend happens at render time.
 */
export interface ModelOption {
  id: string;
  label: string;
  description: string;
  backend: JobBackend | JobBackend[]; // which backend(s) this model runs on
}

/**
 * Describes a voice asset available for a specific TTS model.
 * Voices are grouped by ttsModel to enforce compatibility.
 * Samples (sampleAsset or sampleUrl) allow users to preview before selection.
 */
export interface VoiceOption {
  id: string;
  label: string;
  ttsModel: string; // which TTS model this voice belongs to
  description: string;
  sampleUrl?: string;
  sampleAsset?: number; // require() result for local samples
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
    label: 'John',
    ttsModel: 'qwen3-base',
    description: 'Clone voice from sample_voices/declutter_the_mind_7s.wav',
    sampleAsset: require('../../../../sample_voices/declutter_the_mind_7s.wav'),
  },
  {
    id: 'laura_qwen',
    label: 'Laura',
    ttsModel: 'qwen3-base',
    description: 'Clone voice from sample_voices/laura_qwen.wav',
    sampleAsset: require('../../../../sample_voices/laura_qwen.wav'),
  },
  {
    id: 'daniel_16s',
    label: 'Daniel',
    ttsModel: 'qwen3-base',
    description: 'Clone voice from sample_voices/daniel_16s.wav',
    sampleAsset: require('../../../../sample_voices/daniel_16s.wav'),
  },
];

// ==================== HELPERS ====================

/**
 * Normalize backend matching logic (single or multi-backend models).
 * Enables models to optionally support multiple backends.
 */
function matchesBackend(
  modelBackend: JobBackend | JobBackend[],
  target: JobBackend
): boolean {
  if (Array.isArray(modelBackend)) {
    return modelBackend.includes(target);
  }
  return modelBackend === target;
}

/** Retrieve LLM models compatible with a given backend. */
export function getLLMModelsForBackend(backend: JobBackend): ModelOption[] {
  return LLM_MODELS.filter((m) => matchesBackend(m.backend, backend));
}

/** Retrieve TTS models compatible with a given backend. */
export function getTTSModelsForBackend(backend: JobBackend): ModelOption[] {
  return TTS_MODELS.filter((m) => matchesBackend(m.backend, backend));
}

/** Retrieve voices available for a specific TTS model. */
export function getVoicesForTTSModel(ttsModelId: string): VoiceOption[] {
  return TTS_VOICES.filter((v) => v.ttsModel === ttsModelId);
}

/** Get the first available LLM model for a backend (safe default). */
export function getDefaultLLMModel(backend: JobBackend = 'local'): string {
  const models = getLLMModelsForBackend(backend);
  return models.length > 0 ? models[0].id : LLM_MODELS[0].id;
}

/** Get the first available TTS model for a backend (safe default). */
export function getDefaultTTSModel(backend: JobBackend = 'local'): string {
  const models = getTTSModelsForBackend(backend);
  return models.length > 0 ? models[0].id : TTS_MODELS[0].id;
}

/** Get the first available voice for a TTS model (safe default). */
export function getDefaultVoice(ttsModelId: string): string {
  const voices = getVoicesForTTSModel(ttsModelId);
  return voices.length > 0 ? voices[0].id : '';
}

/** Look up voice display label by ID. Returns ID as fallback if not found. */
export function getVoiceLabelById(voiceId: string): string {
  const voice = TTS_VOICES.find((v) => v.id === voiceId);
  return voice?.label ?? voiceId;
}
