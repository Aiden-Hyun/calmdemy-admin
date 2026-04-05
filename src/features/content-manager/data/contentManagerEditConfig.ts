import {
  ContentManagerCollection,
  ContentManagerEditFieldDefinition,
  ContentManagerEditFieldOption,
  ContentManagerEditFormValues,
  ContentManagerEditableValue,
  ContentManagerEditableValues,
} from '../types';

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
