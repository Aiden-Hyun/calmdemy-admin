/**
 * ARCHITECTURAL ROLE:
 * Central type definitions for the Content Manager feature. This module serves as the single source of truth
 * for all TypeScript interfaces and types used across the content-manager feature, establishing a clear contract
 * between data layers, hooks, and UI components.
 *
 * DESIGN PATTERNS:
 * - **Nominal Type Unions**: Uses TypeScript union types (ContentManagerCollection, ContentManagerAccess) to create
 *   strongly-typed domain models that prevent string type confusion at compile-time.
 * - **Configuration Objects as Types**: Filter states and form values are typed as interfaces, allowing type-safe
 *   serialization and state management in Redux/Zustand patterns.
 * - **Audit Trail Pattern**: ContentManagerAuditEntry captures before/after values and metadata, enabling change
 *   tracking and regulatory compliance workflows.
 * - **Discriminated Unions**: Uses status and collection fields to distinguish different content types and states.
 *
 * KEY DEPENDENCIES:
 * - Firebase Timestamp for date serialization
 * - Global app types for ContentReportStatus and ReportCategory
 *
 * CONSUMERS:
 * - Data layer (repositories, search, edit config) for data modeling
 * - Hooks (useContentManager) for state management
 * - UI components and screens for prop typing
 * - API contracts between client and backend
 */

import { Timestamp } from 'firebase/firestore';
import { ContentJob } from '@features/admin/types';
import { ContentReportStatus, ReportCategory } from '@/types';

/**
 * Union type representing all supported content collections in the app.
 * Used to scope queries, apply collection-specific logic, and validate content types.
 * Each collection maps to a Firestore collection and has unique metadata/editing rules.
 *
 * DESIGN NOTE:
 * - Nominal type union (string literal types combined with |) enables compile-time exhaustiveness checking
 *   on switch statements and type guards (e.g., isContentManagerCollection() below)
 * - Adding a new collection requires updates to: CONTENT_MANAGER_COLLECTIONS array, CONTENT_MANAGER_COLLECTION_LABELS map,
 *   edit config, normalizers in contentManagerRepository, and UI filter options
 */
export type ContentManagerCollection =
  | 'guided_meditations'
  | 'sleep_meditations'
  | 'bedtime_stories'
  | 'emergency_meditations'
  | 'courses'
  | 'course_sessions'
  | 'albums'
  | 'sleep_sounds'
  | 'background_sounds'
  | 'white_noise'
  | 'music'
  | 'asmr'
  | 'series'
  | 'breathing_exercises'
  | 'meditation_programs';

export type ContentManagerAccess = 'free' | 'premium';

export type ContentManagerTypeFilter = 'all' | ContentManagerCollection;

export interface ContentPreviewRoute {
  pathname:
    | '/meditation/[id]'
    | '/sleep/meditation/[id]'
    | '/sleep/[id]'
    | '/emergency/[id]'
    | '/course/[id]'
    | '/course/session/[id]'
    | '/album/[id]'
    | '/sleep-sounds'
    | '/music/[id]'
    | '/series/[id]'
    | '/breathing';
  params: Record<string, string> & {
    id: string;
  };
}

export type ContentManagerThumbnailFilter = 'all' | 'missing_or_web';

export interface ContentManagerFilterState {
  query: string;
  type: ContentManagerTypeFilter;
  access: 'all' | ContentManagerAccess;
  thumbnail: ContentManagerThumbnailFilter;
}

export interface ContentManagerItemSummary {
  id: string;
  collection: ContentManagerCollection;
  typeLabel: string;
  title: string;
  description?: string;
  identifier: string;
  code?: string;
  access: ContentManagerAccess;
  durationMinutes?: number;
  thumbnailUrl?: string;
  previewRoute: ContentPreviewRoute;
}

export interface ContentManagerMetadataField {
  label: string;
  value: string;
  monospace?: boolean;
}

export type ContentManagerFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'multiselect';

export interface ContentManagerEditFieldOption {
  value: string;
  label: string;
}

export interface ContentManagerEditFieldDefinition {
  name: string;
  label: string;
  type: ContentManagerFieldType;
  required?: boolean;
  options?: ContentManagerEditFieldOption[];
  placeholder?: string;
  helperText?: string;
}

export type ContentManagerEditableValue = string | number | string[] | null;

export type ContentManagerEditableValues = Record<string, ContentManagerEditableValue>;

export type ContentManagerEditFormValue = string | string[];

export type ContentManagerEditFormValues = Record<string, ContentManagerEditFormValue>;

export interface ContentManagerAuditEntry {
  id: string;
  actorUid: string;
  actorEmail?: string;
  reason: string;
  changedFields: string[];
  before: ContentManagerEditableValues;
  after: ContentManagerEditableValues;
  createdAt?: Timestamp;
}

export interface ContentManagerSaveResult {
  changed: boolean;
  changedFields: string[];
}

export type ContentManagerReportsTypeFilter =
  | 'all'
  | 'unsupported'
  | ContentManagerCollection;

export interface ContentManagerReportsFilterState {
  query: string;
  status: 'all' | ContentReportStatus;
  type: ContentManagerReportsTypeFilter;
  category: 'all' | ReportCategory;
}

export interface ContentManagerRelation {
  label: string;
  collection: ContentManagerCollection;
  id: string;
  title: string;
  code?: string;
}

export interface ContentManagerSupportedReportLink {
  collection: ContentManagerCollection;
  contentId: string;
  reportId: string;
}

export interface ContentManagerReportSummary {
  id: string;
  contentId: string;
  contentType: string;
  category: ReportCategory;
  description?: string;
  status: ContentReportStatus;
  reportedAt?: Timestamp;
  resolutionNote?: string;
  resolvedAt?: Timestamp;
  resolvedByUid?: string;
  resolvedByEmail?: string;
  isSupported: boolean;
  supportedLink?: ContentManagerSupportedReportLink;
  contentTitle?: string;
  contentIdentifier?: string;
  contentCollection?: ContentManagerCollection;
  contentTypeLabel?: string;
  thumbnailUrl?: string;
}

export interface ContentManagerReportContext {
  reports: ContentManagerReportSummary[];
  selectedReport: ContentManagerReportSummary | null;
}

export interface ContentManagerRepairActionAvailability {
  job: ContentJob | null;
  sessionCode?: string;
  canOpenFactoryJob: boolean;
  canRegenerateAudioOnly: boolean;
  canRegenerateScriptAndAudio: boolean;
  canGenerateThumbnail: boolean;
  message?: string;
}

export interface ContentManagerItemDetail extends ContentManagerItemSummary {
  metadata: ContentManagerMetadataField[];
  relations: ContentManagerRelation[];
  editableFields: ContentManagerEditFieldDefinition[];
  editableValues: ContentManagerEditableValues;
}

export const CONTENT_MANAGER_COLLECTION_LABELS: Record<ContentManagerCollection, string> = {
  guided_meditations: 'Guided Meditation',
  sleep_meditations: 'Sleep Meditation',
  bedtime_stories: 'Bedtime Story',
  emergency_meditations: 'Emergency Meditation',
  courses: 'Course',
  course_sessions: 'Course Session',
  albums: 'Album',
  sleep_sounds: 'Sleep Sound',
  background_sounds: 'Background Sound',
  white_noise: 'White Noise',
  music: 'Music',
  asmr: 'ASMR',
  series: 'Series',
  breathing_exercises: 'Breathing Exercise',
  meditation_programs: 'Meditation Program',
};

export const CONTENT_MANAGER_COLLECTIONS: ContentManagerCollection[] = [
  'guided_meditations',
  'sleep_meditations',
  'bedtime_stories',
  'emergency_meditations',
  'courses',
  'course_sessions',
  'albums',
  'sleep_sounds',
  'background_sounds',
  'white_noise',
  'music',
  'asmr',
  'series',
  'breathing_exercises',
  'meditation_programs',
];

export const CONTENT_MANAGER_DEFAULT_FILTERS: ContentManagerFilterState = {
  query: '',
  type: 'all',
  access: 'all',
  thumbnail: 'all',
};

export const CONTENT_MANAGER_DEFAULT_REPORT_FILTERS: ContentManagerReportsFilterState = {
  query: '',
  status: 'open',
  type: 'all',
  category: 'all',
};

export const CONTENT_MANAGER_REPORT_STATUS_LABELS: Record<
  ContentReportStatus,
  string
> = {
  open: 'Open',
  resolved: 'Resolved',
};

export const CONTENT_MANAGER_REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  audio_issue: 'Audio Issue',
  wrong_content: 'Wrong Content',
  inappropriate: 'Inappropriate',
  other: 'Other',
};

/**
 * Returns true if the thumbnail URL is from a free stock image site (unsplash,
 * pexels, pixabay, etc.) rather than a generated/uploaded image hosted on
 * Firebase Storage or similar owned infrastructure.
 */
export function isWebStockThumbnail(url: string | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('unsplash.com') ||
    lower.includes('pexels.com') ||
    lower.includes('pixabay.com') ||
    lower.includes('stocksnap.io') ||
    lower.includes('freepik.com')
  );
}

/**
 * Returns true if the item has no thumbnail or uses a free stock web image.
 */
export function isMissingOrWebThumbnail(thumbnailUrl: string | undefined): boolean {
  return !thumbnailUrl || isWebStockThumbnail(thumbnailUrl);
}

export function isContentManagerCollection(
  value: string | string[] | undefined
): value is ContentManagerCollection {
  return (
    typeof value === 'string' &&
    CONTENT_MANAGER_COLLECTIONS.includes(value as ContentManagerCollection)
  );
}
