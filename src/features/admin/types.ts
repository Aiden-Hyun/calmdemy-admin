import { Timestamp } from 'firebase/firestore';

// ==================== JOB STATUS ====================

export type JobStatus =
  | 'pending'
  | 'llm_generating'
  | 'qa_formatting'
  | 'image_generating'
  | 'tts_pending'
  | 'tts_converting'
  | 'post_processing'
  | 'uploading'
  | 'publishing'
  | 'paused'
  | 'completed'
  | 'failed';

export const JOB_STATUS_ORDER: JobStatus[] = [
  'pending',
  'llm_generating',
  'qa_formatting',
  'image_generating',
  'tts_pending',
  'tts_converting',
  'post_processing',
  'uploading',
  'publishing',
  'paused',
  'completed',
];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending: 'Pending',
  llm_generating: 'Generating Script',
  qa_formatting: 'Formatting',
  image_generating: 'Generating Image',
  tts_pending: 'Waiting for TTS',
  tts_converting: 'Converting to Audio',
  post_processing: 'Processing Audio',
  uploading: 'Uploading',
  publishing: 'Publishing',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
};

// ==================== JOB BACKEND ====================

export type JobBackend = 'local' | 'api';

/** Backends selectable in the admin UI. */
export const AVAILABLE_BACKENDS: JobBackend[] = ['local', 'api'];

export const BACKEND_LABELS: Record<JobBackend, string> = {
  local: 'Local',
  api: 'API',
};

export const BACKEND_DESCRIPTIONS: Record<JobBackend, string> = {
  local: 'Runs on your Mac (LM Studio / Qwen3)',
  api: 'Uses remote API',
};

// ==================== CONTENT TYPES ====================

export type FactoryContentType =
  | 'guided_meditation'
  | 'sleep_meditation'
  | 'bedtime_story'
  | 'emergency_meditation'
  | 'course_session'
  | 'course'
  | 'full_subject'
  | 'album'
  | 'sleep_sound'
  | 'white_noise'
  | 'music'
  | 'asmr'
  | 'series';

export const CONTENT_TYPE_LABELS: Record<FactoryContentType, string> = {
  guided_meditation: 'Guided Meditation',
  sleep_meditation: 'Sleep Meditation',
  bedtime_story: 'Bedtime Story',
  emergency_meditation: 'Emergency Meditation',
  course_session: 'Course Session',
  course: 'Full Course (9 audio)',
  full_subject: 'Full Subject',
  album: 'Album',
  sleep_sound: 'Sleep Sound',
  white_noise: 'White Noise',
  music: 'Music',
  asmr: 'ASMR',
  series: 'Series',
};

// ==================== COURSE REGENERATION ====================

export type CourseRegenerationMode = 'audio_only' | 'script_and_audio';

export interface CourseRegenerationRequest {
  active: boolean;
  mode: CourseRegenerationMode;
  targetSessionCodes: string[];
  requiresPublishApproval: boolean;
  awaitingScriptApproval?: boolean;
  scriptApprovedBy?: string;
  scriptApprovedAt?: Timestamp;
  previousAudioBySession?: Record<string, string>;
  requestedBy?: string;
  requestedAt?: Timestamp;
}

export interface ScriptApprovalRequest {
  enabled: boolean;
  awaitingApproval?: boolean;
  scriptApprovedBy?: string;
  scriptApprovedAt?: Timestamp;
  requestedBy?: string;
  requestedAt?: Timestamp;
}

export interface SubjectPlanApprovalRequest {
  enabled: boolean;
  awaitingApproval?: boolean;
  approvedBy?: string;
  approvedAt?: Timestamp;
  requestedBy?: string;
  requestedAt?: Timestamp;
}

export interface SubjectLevelCounts {
  l100: number;
  l200: number;
  l300: number;
  l400: number;
}

export type SubjectCourseLevel = 100 | 200 | 300 | 400;

export interface SubjectPlanCourse {
  sequence: number;
  level: SubjectCourseLevel;
  code: string;
  title: string;
  description: string;
  learningGoals?: string[];
  prerequisites?: string[];
  childJobId?: string;
  childStatus?: JobStatus;
  childError?: string;
}

export interface SubjectPlan {
  subjectId: string;
  subjectLabel: string;
  overview?: string;
  courses: SubjectPlanCourse[];
}

export interface SubjectChildCounts {
  pending: number;
  running: number;
  completed: number;
  failed: number;
}

export type TimingStatus = 'exact' | 'legacy' | 'unavailable';

export interface CourseTtsProgress {
  mode?: 'chunk_words';
  percent?: number;
  completedChunks?: number;
  totalChunks?: number;
  completedWords?: number;
  totalWords?: number;
  completedSessions?: number;
  totalSessions?: number;
}

// ==================== JOB PARAMS ====================

export interface ContentJobParams {
  topic: string;
  duration_minutes: number;
  style?: string;
  technique?: string;
  themes?: string[];
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  category?: string;
  customInstructions?: string;

  // Course-specific params (only when contentType === 'course')
  courseCode?: string;
  courseTitle?: string;
  subjectId?: string;
  subjectLabel?: string;
  subjectColor?: string;
  subjectIcon?: string;
  targetAudience?: 'beginner' | 'intermediate';
  tone?: 'gentle' | 'energetic' | 'very calm';

  // Full-subject params (only when contentType === 'full_subject')
  levelCounts?: SubjectLevelCounts;
  courseCount?: number;
}

// ==================== CONTENT JOB ====================

export interface ContentJob {
  id: string;
  status: JobStatus;

  // Execution backends (independent per component)
  llmBackend: JobBackend;
  ttsBackend: JobBackend;

  // What to create
  contentType: FactoryContentType;
  params: ContentJobParams;

  // Model selection
  llmModel: string;
  ttsModel: string;
  ttsVoice: string;

  // Title — admin can set manually; if empty, LLM auto-generates one
  title?: string;

  // Publishing control
  autoPublish: boolean;

  // Pipeline outputs (filled as pipeline progresses)
  generatedScript?: string;
  formattedScript?: string;
  generatedTitle?: string;
  audioPath?: string;
  audioDurationSec?: number;
  publishedContentId?: string;
  imagePrompt?: string;
  imagePath?: string;
  thumbnailUrl?: string;
  imageModel?: string;
  generateThumbnailDuringRun?: boolean;
  thumbnailGenerationRequested?: boolean;
  lastCompletedStage?: JobStatus;
  failedStage?: JobStatus;
  resumeAvailable?: boolean;
  errorCode?: string;
  jobRunId?: string;
  runAttempt?: number;
  runWorkerId?: string;
  runWorkerRole?: string;
  runStartedAt?: Timestamp;
  runContinuedAt?: Timestamp;
  runEndedAt?: Timestamp;
  lastRunStatus?: 'running' | 'completed' | 'failed';
  publishInProgress?: boolean;
  publishLeaseOwner?: string;
  publishLeaseExpiresAt?: Timestamp;
  engine?: 'v1' | 'v2';
  v2JobId?: string;
  v2RunId?: string;
  v2Locked?: boolean;
  v2DispatchError?: string;
  v2DispatchedBy?: string;
  v2DispatchedAt?: Timestamp;
  scriptApproval?: ScriptApprovalRequest;
  parentJobId?: string;

  // Course-specific outputs
  courseProgress?: string;         // e.g. "Script 3/9", "Audio 5/9"
  coursePlan?: Record<string, any>;
  courseRawScripts?: Record<string, string>;
  courseFormattedScripts?: Record<string, string>;
  courseAudioResults?: Record<string, { storagePath: string; durationSec: number }>;
  coursePreviewSessions?: Array<{
    code: string;
    label: string;
    title: string;
    order: number;
    audioPath: string;
    durationSec: number;
  }>;
  courseScriptApproval?: ScriptApprovalRequest;
  courseRegeneration?: CourseRegenerationRequest;
  courseSessionIds?: string[];     // published session doc IDs
  courseId?: string;               // published course doc ID

  // Full-subject outputs
  subjectProgress?: string;
  subjectPlan?: SubjectPlan;
  subjectPlanApproval?: SubjectPlanApprovalRequest;
  childJobIds?: string[];
  childCounts?: SubjectChildCounts;
  pauseRequested?: boolean;
  pausedAt?: Timestamp;
  launchCursor?: number;
  maxActiveChildCourses?: number;
  ttsProgress?: CourseTtsProgress;

  // Timing
  timingStatus?: TimingStatus;
  effectiveElapsedMs?: number;
  effectiveWorkerMs?: number;
  reuseCreditMs?: number;
  wastedWorkerMs?: number;
  queueLatencyMs?: number;
  parallelismFactor?: number;
  timingComputedAt?: Timestamp;
  timingVersion?: number;
  activeRunElapsedMs?: number;

  // Metadata
  error?: string;
  deleteRequested?: boolean;
  deleteRequestedAt?: Timestamp;
  deleteInProgress?: boolean;
  deleteError?: string;
  deleteErrorCode?: string;

  // Watchdog tracking
  watchdogResetCount?: number;
  lastWatchdogResetAt?: Timestamp;
  lastWatchdogReason?: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  startedAt?: Timestamp;
  ttsPendingAt?: Timestamp;
  completedAt?: Timestamp;
  createdBy: string;
}

// ==================== FACTORY V2 ENGINE STATE ====================

export type FactoryJobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type JobExecutionRunState = 'running' | 'completed' | 'failed';

export interface FactoryJobSummary {
  currentStep?: string;
  lastRunStatus?: JobExecutionRunState;
  lastRunId?: string;
  failedStep?: string;
  errorCode?: string;
  subjectState?: string;
  launchCursor?: number;
}

export interface FactoryJob {
  id: string;
  jobType?: 'single_content' | 'course' | 'subject';
  currentState?: FactoryJobState;
  currentRunId?: string;
  summary?: FactoryJobSummary;
  runtime?: Record<string, any>;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface FactoryJobRun {
  id: string;
  jobId?: string;
  runNumber?: number;
  state?: JobExecutionRunState;
  trigger?: string;
  startedAt?: Timestamp;
  endedAt?: Timestamp;
  failedStep?: string;
  errorCode?: string;
  updatedAt?: Timestamp;
}

export type JobExecutionStatusSource = 'content_job' | 'factory_job' | 'mixed';

export interface JobExecutionView {
  effectiveStatus: JobStatus;
  effectiveRunStatus?: JobExecutionRunState;
  statusSource: JobExecutionStatusSource;
  engineCurrentState?: FactoryJobState;
  engineRunId?: string;
  engineStepName?: string;
  projectionDrift: string[];
  isProjectionDrifted: boolean;
}

// ==================== STEP TIMELINE ====================

export type JobStepTimelineSource = 'v2';

export interface JobStepTimelineEntry {
  id: string;
  source: JobStepTimelineSource;
  jobId: string;
  runId?: string;
  stepName: string;
  shardKey?: string;
  workerId?: string;
  queueId?: string;
  state: string;
  eventType?: string;
  attempt?: number;
  nextAttempt?: number;
  retryDelaySec?: number;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: Timestamp;
  endedAt?: Timestamp;
  updatedAt?: Timestamp;
  timestamp?: Timestamp;
}

// ==================== LOCAL DRAFTS ====================

export interface ContentDraft {
  id: string;
  contentType: FactoryContentType;

  // Common fields
  title: string;
  topic: string;
  duration: number;
  style: string;
  technique: string;
  difficulty: string;
  customInstructions: string;
  imagePrompt: string;
  autoPublish: boolean;

  // Course fields
  courseCode: string;
  courseTitle: string;
  subjectId: string;
  targetAudience: string;
  tone: string;
  generateThumbnailDuringRun: boolean;
  requireScriptApprovalBeforeTts: boolean;
  levelCounts: SubjectLevelCounts;
  requireSubjectPlanApproval: boolean;

  // Model configuration
  llmBackend: JobBackend;
  ttsBackend: JobBackend;
  llmModel: string;
  ttsModel: string;
  ttsVoice: string;

  // Metadata
  createdAt: number;
  updatedAt: number;
}

// ==================== WORKER STATUS ====================

export interface WorkerStatus {
  id: string;
  workerId?: string;
  workerType?: 'local';
  stackId?: string;
  pid?: number | null;
  capabilityKeys?: string[];
  jobId?: string | null;
  currentQueueId?: string | null;
  currentStepRunId?: string | null;
  currentRunId?: string | null;
  currentStepName?: string | null;
  currentShardKey?: string | null;
  currentStepAttempt?: number | null;
  currentStepStartedAt?: Timestamp;
  currentStepHeartbeatAt?: Timestamp;
  currentStepDeadlineAt?: Timestamp;
  currentCapabilityKey?: string | null;
  currentRequiredTtsModel?: string | null;
  currentProgressDetail?: string | null;
  lastHeartbeat?: Timestamp;
  updatedAt?: Timestamp;
  pollIntervalSec?: number;
}

export interface ActiveJobWorker {
  workerId: string;
  stackId: string;
  jobId: string;
  currentQueueId?: string;
  currentRunId?: string;
  currentStepName?: string;
  currentShardKey?: string;
  currentProgressDetail?: string;
  currentRequiredTtsModel?: string;
  lastHeartbeat?: Timestamp;
}

// ==================== WORKER CONTROL ====================

export type WorkerDesiredState = 'auto' | 'running' | 'stopped';
export type WorkerRuntimeState = 'running' | 'stopped' | 'starting' | 'stopping';

export interface WorkerControl {
  id: string;
  desiredState?: WorkerDesiredState;
  idleTimeoutMin?: number;
  currentState?: WorkerRuntimeState;
  workerPid?: number | null;
  lastAction?: string;
  lastError?: string | null;
  lastChangeAt?: Timestamp;
  requestedBy?: string;
  requestedAt?: Timestamp;
}

// ==================== WORKER STACKS ====================

export interface WorkerStackStatus {
  id: string;
  role?: string;
  venv?: string;
  enabled?: boolean;
  dispatch?: boolean;
  acceptNonTtsSteps?: boolean;
  ttsModels?: string[];
  pid?: number;
  logPath?: string;
  lastUpdatedAt?: Timestamp;
  heartbeat?: WorkerStatus | null;
}

// ==================== WORKER LOG TAILS ====================

export interface WorkerLogEntry {
  timestamp?: string;
  level?: string;
  logger?: string;
  message: string;
  raw?: string;
  job_id?: string;
  stage?: string;
  content_type?: string;
  model_id?: string;
  error?: string;
}

export interface WorkerLogTail {
  id: string;
  stackId: string;
  stackRole?: string;
  pid?: number | null;
  source?: string;
  lineCount?: number;
  lines: WorkerLogEntry[];
  updatedAt?: Timestamp;
}

// ==================== FACTORY METRICS ====================

export interface FactoryMetrics {
  id: string; // YYYY-MM-DD
  completed_total?: number;
  failed_total?: number;
  completed_by_type?: Record<string, number>;
  failed_by_type?: Record<string, number>;
  failed_by_stage?: Record<string, number>;
  duration_sec_sum?: number;
  duration_sec_count?: number;
  effective_elapsed_sec_sum?: number;
  effective_elapsed_sec_count?: number;
  effective_worker_sec_sum?: number;
  effective_worker_sec_count?: number;
  reuse_credit_sec_sum?: number;
  wasted_worker_sec_sum?: number;
  queue_latency_sec_sum?: number;
  queue_latency_sec_count?: number;
  last_error?: string;
  lastUpdatedAt?: Timestamp;
}

// ==================== CREATE JOB INPUT ====================

export interface CreateJobInput {
  llmBackend: JobBackend;
  ttsBackend: JobBackend;
  contentType: FactoryContentType;
  params: ContentJobParams;
  llmModel: string;
  ttsModel: string;
  ttsVoice: string;
  title?: string;
  imagePrompt?: string;
  autoPublish: boolean;
  generateThumbnailDuringRun?: boolean;
  requireScriptApprovalBeforeTts?: boolean;
  requireSubjectPlanApproval?: boolean;
}
