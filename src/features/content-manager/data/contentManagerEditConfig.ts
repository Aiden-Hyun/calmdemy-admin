/**
 * ARCHITECTURAL ROLE:
 * Form schema and value normalization for the metadata edit feature. Implements the Strategy pattern
 * with collection-specific field definitions, allowing each content type to declare which fields are
 * editable and in what format.
 *
 * DESIGN PATTERNS:
 * - **Strategy Pattern**: CONTENT_MANAGER_EDIT_FIELDS is a mapping of collection → field array.
 *   Each collection strategy defines required fields, input types, validation rules, and dropdown options.
 * - **Validation Pipeline**: Three-stage validation flow:
 *   1. normalizeDetailValue() — normalize raw Firestore data → editable values (coerce types)
 *   2. normalizeFormValue() — normalize form input string → editable value (parse and validate)
 *   3. evaluateMetadataForm() — apply required field checks, compare to initial, return patch
 * - **Adapter Pattern**: buildEditableValues() and buildEditFormValues() adapt between:
 *   - ContentManagerEditableValues (model layer: mixed types, nulls allowed)
 *   - ContentManagerEditFormValues (form layer: all strings, empty string for null)
 * - **Normalization Layers**: Form values (strings) → Normalized values (typed) → Patch (changed only)
 *
 * KEY CONCEPTS:
 * - **EditableValues**: Internal model format; supports mixed types (string, number, string[])
 *   and null for "not set". Stored in Firestore.
 * - **EditFormValues**: Form input format; all values are strings or string arrays.
 *   Empty string represents null/unset. UX-friendly.
 * - **Patch**: Only fields that actually changed, used for updateContentMetadata() Cloud Function.
 * - **Dirty Checking**: isDirty = patch is non-empty. Prevents saving unchanged forms.
 * - **Validation**: Required fields, type coercion, option whitelisting (prevent invalid selects).
 *
 * DEPENDENCIES:
 * - Used by detail screen form and edit hook validation logic
 * - Each collection has unique field schema (e.g., guided_meditations has themes/techniques multiselect)
 */

import {
  ContentManagerCollection,
  ContentManagerEditFieldDefinition,
  ContentManagerEditFieldOption,
  ContentManagerEditFormValues,
  ContentManagerEditableValue,
  ContentManagerEditableValues,
} from '../types';

/**
 * Shared dropdown options across multiple content types.
 * Stored as constants to enable easy maintenance (update once, applies everywhere).
 */
const DIFFICULTY_OPTIONS: ContentManagerEditFieldOption[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

const MEDITATION_THEME_OPTIONS: ContentManagerEditFieldOption[] = [
  { value: 'focus', label: 'Focus' },
  { value: 'stress', label: 'Stress' },
  { value: 'anxiety', label: 'Anxiety' },
  { value: 'sleep', label: 'Sleep' },
  { value: 'body-scan', label: 'Body Scan' },
  { value: 'relationships', label: 'Relationships' },
  { value: 'self-esteem', label: 'Self-Esteem' },
  { value: 'gratitude', label: 'Gratitude' },
  { value: 'loving-kindness', label: 'Loving Kindness' },
];

const MEDITATION_TECHNIQUE_OPTIONS: ContentManagerEditFieldOption[] = [
  { value: 'breathing', label: 'Breathing' },
  { value: 'body-scan', label: 'Body Scan' },
  { value: 'visualization', label: 'Visualization' },
  { value: 'loving-kindness', label: 'Loving Kindness' },
  { value: 'mindfulness', label: 'Mindfulness' },
  { value: 'grounding', label: 'Grounding' },
  { value: 'progressive-relaxation', label: 'Progressive Relaxation' },
];

const BEDTIME_CATEGORY_OPTIONS: ContentManagerEditFieldOption[] = [
  { value: 'nature', label: 'Nature' },
  { value: 'fantasy', label: 'Fantasy' },
  { value: 'travel', label: 'Travel' },
  { value: 'fiction', label: 'Fiction' },
  { value: 'thriller', label: 'Thriller' },
  { value: 'fairytale', label: 'Fairytale' },
];

/**
 * Schema registry: collection → array of editable field definitions.
 * Each collection declares which fields the admin UI can edit, their types, validation rules, and UI hints.
 *
 * FIELD PROPERTIES:
 * - name: Property name in Firestore document (snake_case)
 * - label: Human-readable label for form (title case)
 * - type: Input type (text, textarea, number, select, multiselect)
 * - required: If true, validation enforces non-empty, UI marks with asterisk
 * - options: For select/multiselect, array of {value, label} pairs (enum whitelist)
 * - placeholder: HTML placeholder text (text/textarea inputs)
 * - helperText: Hint text below field (e.g., "Hex or named color")
 *
 * COLLECTION DIFFERENCES:
 * - Guided meditations: themes and techniques are multiselect (array)
 * - Sleep meditations: instructor, icon, color are required (UI always present)
 * - Courses: allow optional icon; course sessions allow fewer fields than parent course
 * - Music items (white_noise, music, asmr): identical schema
 * - Breathing exercises: difficulty select required
 *
 * NOTES:
 * - Some fields are display-only (audioPath, code) and not in edit schema
 * - Duration fields are often read-only (computed from audio/content)
 * - Color fields accept hex codes or named colors; no live preview validation here
 */
export const CONTENT_MANAGER_EDIT_FIELDS: Record<
  ContentManagerCollection,
  ContentManagerEditFieldDefinition[]
> = {
  guided_meditations: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'duration_minutes', label: 'Duration (minutes)', type: 'number', required: true },
    { name: 'thumbnailUrl', label: 'Thumbnail URL', type: 'text' },
    { name: 'themes', label: 'Themes', type: 'multiselect', options: MEDITATION_THEME_OPTIONS },
    {
      name: 'techniques',
      label: 'Techniques',
      type: 'multiselect',
      options: MEDITATION_TECHNIQUE_OPTIONS,
    },
    {
      name: 'difficulty_level',
      label: 'Difficulty',
      type: 'select',
      required: true,
      options: DIFFICULTY_OPTIONS,
    },
    { name: 'instructor', label: 'Instructor', type: 'text' },
  ],
  sleep_meditations: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'duration_minutes', label: 'Duration (minutes)', type: 'number', required: true },
    { name: 'thumbnailUrl', label: 'Thumbnail URL', type: 'text' },
    { name: 'instructor', label: 'Instructor', type: 'text', required: true },
    { name: 'icon', label: 'Icon', type: 'text', required: true },
    { name: 'color', label: 'Color', type: 'text', required: true, helperText: 'Hex or named color' },
  ],
  bedtime_stories: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'duration_minutes', label: 'Duration (minutes)', type: 'number', required: true },
    { name: 'thumbnail_url', label: 'Thumbnail URL', type: 'text' },
    { name: 'narrator', label: 'Narrator', type: 'text', required: true },
    {
      name: 'category',
      label: 'Category',
      type: 'select',
      required: true,
      options: BEDTIME_CATEGORY_OPTIONS,
    },
  ],
  emergency_meditations: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'duration_minutes', label: 'Duration (minutes)', type: 'number', required: true },
    { name: 'thumbnailUrl', label: 'Thumbnail URL', type: 'text' },
    { name: 'narrator', label: 'Narrator', type: 'text' },
    { name: 'icon', label: 'Icon', type: 'text', required: true },
    { name: 'color', label: 'Color', type: 'text', required: true, helperText: 'Hex or named color' },
  ],
  courses: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'subtitle', label: 'Subtitle', type: 'text' },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'thumbnailUrl', label: 'Thumbnail URL', type: 'text' },
    { name: 'instructor', label: 'Instructor', type: 'text', required: true },
    { name: 'icon', label: 'Icon', type: 'text' },
    { name: 'color', label: 'Color', type: 'text', required: true, helperText: 'Hex or named color' },
  ],
  course_sessions: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'duration_minutes', label: 'Duration (minutes)', type: 'number', required: true },
  ],
  albums: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'thumbnailUrl', label: 'Thumbnail URL', type: 'text' },
    { name: 'artist', label: 'Artist', type: 'text', required: true },
    { name: 'category', label: 'Category', type: 'text', required: true },
    { name: 'color', label: 'Color', type: 'text', required: true, helperText: 'Hex or named color' },
  ],
  sleep_sounds: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'thumbnailUrl', label: 'Thumbnail URL', type: 'text' },
    { name: 'category', label: 'Category', type: 'text', required: true },
    { name: 'icon', label: 'Icon', type: 'text', required: true },
    { name: 'color', label: 'Color', type: 'text', required: true, helperText: 'Hex or named color' },
  ],
  background_sounds: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'category', label: 'Category', type: 'text', required: true },
    { name: 'icon', label: 'Icon', type: 'text', required: true },
    { name: 'color', label: 'Color', type: 'text', required: true, helperText: 'Hex or named color' },
  ],
  white_noise: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'thumbnailUrl', label: 'Thumbnail URL', type: 'text' },
    { name: 'category', label: 'Category', type: 'text', required: true },
    { name: 'icon', label: 'Icon', type: 'text', required: true },
    { name: 'color', label: 'Color', type: 'text', required: true, helperText: 'Hex or named color' },
  ],
  music: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'thumbnailUrl', label: 'Thumbnail URL', type: 'text' },
    { name: 'category', label: 'Category', type: 'text', required: true },
    { name: 'icon', label: 'Icon', type: 'text', required: true },
    { name: 'color', label: 'Color', type: 'text', required: true, helperText: 'Hex or named color' },
  ],
  asmr: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'thumbnailUrl', label: 'Thumbnail URL', type: 'text' },
    { name: 'category', label: 'Category', type: 'text', required: true },
    { name: 'icon', label: 'Icon', type: 'text', required: true },
    { name: 'color', label: 'Color', type: 'text', required: true, helperText: 'Hex or named color' },
  ],
  series: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'thumbnailUrl', label: 'Thumbnail URL', type: 'text' },
    { name: 'narrator', label: 'Narrator', type: 'text', required: true },
    { name: 'category', label: 'Category', type: 'text', required: true },
    { name: 'color', label: 'Color', type: 'text', required: true, helperText: 'Hex or named color' },
  ],
  breathing_exercises: [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'duration_minutes', label: 'Duration (minutes)', type: 'number', required: true },
    {
      name: 'difficulty_level',
      label: 'Difficulty',
      type: 'select',
      required: true,
      options: DIFFICULTY_OPTIONS,
    },
  ],
  meditation_programs: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'duration_days', label: 'Duration (days)', type: 'number', required: true },
    {
      name: 'difficulty_level',
      label: 'Difficulty',
      type: 'select',
      required: true,
      options: DIFFICULTY_OPTIONS,
    },
  ],
};

export function getContentManagerEditFields(
  collection: ContentManagerCollection
): ContentManagerEditFieldDefinition[] {
  return CONTENT_MANAGER_EDIT_FIELDS[collection];
}

export function getContentManagerFieldLabel(
  collection: ContentManagerCollection,
  fieldName: string
): string {
  return (
    CONTENT_MANAGER_EDIT_FIELDS[collection].find((field) => field.name === fieldName)?.label ||
    fieldName
  );
}

function normalizeArrayValue(
  value: unknown,
  field: ContentManagerEditFieldDefinition
): string[] {
  const raw = Array.isArray(value) ? value.map((item) => String(item)) : [];
  const allowedValues = new Set((field.options || []).map((option) => option.value));
  const filtered = raw.filter((item) => allowedValues.has(item));
  return (field.options || [])
    .map((option) => option.value)
    .filter((valueOption) => filtered.includes(valueOption));
}

function normalizeDetailValue(
  field: ContentManagerEditFieldDefinition,
  value: unknown
): ContentManagerEditableValue {
  switch (field.type) {
    case 'number': {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return null;
    }
    case 'multiselect':
      return normalizeArrayValue(value, field);
    default: {
      if (value === null || value === undefined) return null;
      const text = String(value).trim();
      return text ? text : null;
    }
  }
}

export function buildEditableValues(
  collection: ContentManagerCollection,
  source: Record<string, unknown>
): ContentManagerEditableValues {
  return getContentManagerEditFields(collection).reduce<ContentManagerEditableValues>((acc, field) => {
    acc[field.name] = normalizeDetailValue(field, source[field.name]);
    return acc;
  }, {});
}

export function buildEditFormValues(
  collection: ContentManagerCollection,
  values: ContentManagerEditableValues
): ContentManagerEditFormValues {
  return getContentManagerEditFields(collection).reduce<ContentManagerEditFormValues>((acc, field) => {
    const value = values[field.name];
    if (field.type === 'multiselect') {
      acc[field.name] = Array.isArray(value) ? value : [];
      return acc;
    }
    acc[field.name] =
      value === null || value === undefined
        ? ''
        : typeof value === 'number'
          ? String(value)
          : String(value);
    return acc;
  }, {});
}

function normalizeTextValue(
  input: ContentManagerEditFormValues[string],
  required?: boolean
): string | null {
  const text = String(Array.isArray(input) ? '' : input).trim();
  if (!text) {
    return required ? '' : null;
  }
  return text;
}

function normalizeNumberValue(input: ContentManagerEditFormValues[string]): number | null | 'invalid' {
  const text = String(Array.isArray(input) ? '' : input).trim();
  if (!text) return 'invalid';
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 'invalid';
  }
  return parsed;
}

function normalizeFormValue(
  field: ContentManagerEditFieldDefinition,
  value: ContentManagerEditFormValues[string]
): ContentManagerEditableValue | 'invalid' {
  switch (field.type) {
    case 'number':
      return normalizeNumberValue(value);
    case 'multiselect':
      return normalizeArrayValue(value, field);
    case 'select': {
      const text = normalizeTextValue(value, field.required);
      if (text === null || text === '') {
        return field.required ? 'invalid' : null;
      }
      const allowed = new Set((field.options || []).map((option) => option.value));
      return allowed.has(text) ? text : 'invalid';
    }
    default:
      return normalizeTextValue(value, field.required);
  }
}

function valuesEqual(left: ContentManagerEditableValue, right: ContentManagerEditableValue) {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return left === right;
}

export function formatEditableValue(
  value: ContentManagerEditableValue | undefined
): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : 'Empty';
  }
  if (value === null || value === undefined || value === '') {
    return 'Empty';
  }
  return String(value);
}

/**
 * Primary validation and patch-building function for the edit form.
 * Called after user clicks Save; validates all fields and generates the minimal patch for backend.
 *
 * VALIDATION FLOW:
 * 1. For each field in schema:
 *    - normalizeFormValue() converts form string → typed value
 *    - Check for 'invalid' marker (type coercion failed)
 *    - Check required field constraints
 *    - If valid, add to normalizedValues; if changed from initial, add to patch
 * 2. Validate change reason (non-empty)
 * 3. Return validation result: fieldErrors dict, patch, isDirty flag, isValid boolean
 *
 * DIRTY CHECKING:
 * - isDirty = patch.length > 0 (at least one field changed)
 * - Used to disable Save button if form unchanged; prevents unnecessary backend calls
 * - If user opens form, makes no changes, clicks Save → isDirty=false → error message "Make a change"
 *
 * PATCH OPTIMIZATION:
 * - Only fields that changed from initial state are in patch
 * - valuesEqual() compares initial[field] vs normalizedValue
 * - Reduces backend diff computation and audit log verbosity
 * - Backend returns changedFields array to confirm what it actually updated
 *
 * ERROR MESSAGES:
 * - fieldErrors map field name → user-friendly error (shown in red below field)
 * - reasonError shown in separate UI section
 * - Form.isValid = no fieldErrors && no reasonError
 *
 * @param collection - Content type (validates against schema)
 * @param initialValues - Values loaded from Firestore (used for change detection)
 * @param formValues - Current form state (all strings/string arrays)
 * @param reason - Admin's explanation for this change (audit trail)
 * @returns Validation result with patch, normalized values, errors, and flags
 */
export function evaluateMetadataForm(
  collection: ContentManagerCollection,
  initialValues: ContentManagerEditableValues,
  formValues: ContentManagerEditFormValues,
  reason: string
): {
  patch: ContentManagerEditableValues;
  normalizedValues: ContentManagerEditableValues;
  fieldErrors: Record<string, string>;
  reasonError?: string;
  isDirty: boolean;
  isValid: boolean;
} {
  const patch: ContentManagerEditableValues = {};
  const normalizedValues: ContentManagerEditableValues = {};
  const fieldErrors: Record<string, string> = {};

  for (const field of getContentManagerEditFields(collection)) {
    const normalizedValue = normalizeFormValue(field, formValues[field.name]);
    if (normalizedValue === 'invalid') {
      fieldErrors[field.name] =
        field.type === 'number'
          ? 'Enter a positive whole number.'
          : `Choose a valid ${field.label.toLowerCase()}.`;
      continue;
    }

    if (
      field.required &&
      ((typeof normalizedValue === 'string' && normalizedValue.trim() === '') ||
        normalizedValue === null)
    ) {
      fieldErrors[field.name] = `${field.label} is required.`;
      continue;
    }

    normalizedValues[field.name] = normalizedValue;
    if (!valuesEqual(initialValues[field.name], normalizedValue)) {
      patch[field.name] = normalizedValue;
    }
  }

  const trimmedReason = reason.trim();
  const reasonError = trimmedReason ? undefined : 'Change reason is required.';

  return {
    patch,
    normalizedValues,
    fieldErrors,
    reasonError,
    isDirty: Object.keys(patch).length > 0,
    isValid: Object.keys(fieldErrors).length === 0 && Boolean(trimmedReason),
  };
}
