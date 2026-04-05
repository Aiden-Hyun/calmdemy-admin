import {
  FirestoreCourse,
  FirestoreCourseSession,
  FirestoreEmergencyMeditation,
  getCourseById,
  getCourses,
  getCourseSessionById,
  getCourseSessions,
  getEmergencyMeditationById,
  getEmergencyMeditations,
  getMeditationById,
  getMeditations,
  getPrograms,
  getBreathingExercises,
} from '@features/meditate/data/meditateRepository';
import {
  FirestoreAlbum,
  FirestoreBackgroundSound,
  FirestoreMusicItem,
  FirestoreSleepSound,
  getAlbumById,
  getAlbums,
  getAsmr,
  getBackgroundSoundById,
  getBackgroundSounds,
  getMusic,
  getSleepSoundById,
  getSleepSounds,
  getWhiteNoise,
} from '@features/music/data/musicRepository';
import {
  FirestoreSeries,
  FirestoreSleepMeditation,
  getBedtimeStories,
  getBedtimeStoryById,
  getSeriesById,
  getSeries,
  getSleepMeditationById,
  getSleepMeditations,
} from '@features/sleep/data/sleepRepository';
import { BedtimeStory, BreathingExercise, MeditationProgram } from '@/types';
import { GuidedMeditation } from '@/types';
import {
  buildEditableValues,
  getContentManagerEditFields,
} from './contentManagerEditConfig';
import {
  CONTENT_MANAGER_COLLECTION_LABELS,
  ContentManagerCollection,
  ContentManagerItemDetail,
  ContentManagerItemSummary,
  ContentPreviewRoute,
} from '../types';

function withCommonSummaryFields(
  collection: ContentManagerCollection,
  item: {
    id: string;
    title?: string;
    description?: string;
    code?: string;
    durationMinutes?: number;
    thumbnailUrl?: string;
    access: 'free' | 'premium';
    previewRoute: ContentPreviewRoute;
  }
): ContentManagerItemSummary {
  return {
    id: item.id,
    collection,
    typeLabel: CONTENT_MANAGER_COLLECTION_LABELS[collection],
    title: item.title || item.id,
    description: item.description,
    identifier: item.code || item.id,
    code: item.code,
    access: item.access,
    durationMinutes: item.durationMinutes,
    thumbnailUrl: item.thumbnailUrl,
    previewRoute: item.previewRoute,
  };
}

function cleanValue(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function appendMetadata(
  fields: Array<{ label: string; value: unknown; monospace?: boolean }>
) {
  return fields
    .map((field) => {
      const value = cleanValue(field.value);
      if (!value) return null;
      return {
        label: field.label,
        value,
        monospace: field.monospace,
      };
    })
    .filter((field): field is NonNullable<typeof field> => Boolean(field));
}

export function normalizeGuidedMeditationSummary(
  meditation: GuidedMeditation
): ContentManagerItemSummary {
  return withCommonSummaryFields('guided_meditations', {
    id: meditation.id,
    title: meditation.title,
    description: meditation.description,
    durationMinutes: meditation.duration_minutes,
    thumbnailUrl: meditation.thumbnailUrl,
    access: 'free',
    previewRoute: {
      pathname: '/meditation/[id]',
      params: { id: meditation.id },
    },
  });
}

export function normalizeSleepMeditationSummary(
  meditation: FirestoreSleepMeditation
): ContentManagerItemSummary {
  return withCommonSummaryFields('sleep_meditations', {
    id: meditation.id,
    title: meditation.title,
    description: meditation.description,
    durationMinutes: meditation.duration_minutes,
    thumbnailUrl: meditation.thumbnailUrl,
    access: 'free',
    previewRoute: {
      pathname: '/sleep/meditation/[id]',
      params: { id: meditation.id },
    },
  });
}

export function normalizeBedtimeStorySummary(story: BedtimeStory): ContentManagerItemSummary {
  return withCommonSummaryFields('bedtime_stories', {
    id: story.id,
    title: story.title,
    description: story.description,
    durationMinutes: story.duration_minutes,
    thumbnailUrl: story.thumbnail_url,
    access: 'free',
    previewRoute: {
      pathname: '/sleep/[id]',
      params: { id: story.id },
    },
  });
}

export function normalizeEmergencyMeditationSummary(
  meditation: FirestoreEmergencyMeditation
): ContentManagerItemSummary {
  return withCommonSummaryFields('emergency_meditations', {
    id: meditation.id,
    title: meditation.title,
    description: meditation.description,
    durationMinutes: meditation.duration_minutes,
    thumbnailUrl: meditation.thumbnailUrl,
    access: 'free',
    previewRoute: {
      pathname: '/emergency/[id]',
      params: {
        id: meditation.id,
        title: meditation.title,
        description: meditation.description,
        duration: String(meditation.duration_minutes),
        audioPath: meditation.audioPath,
        color: meditation.color,
        icon: meditation.icon,
        narrator: meditation.narrator || '',
        thumbnailUrl: meditation.thumbnailUrl || '',
      },
    },
  });
}

export function normalizeCourseSummary(course: FirestoreCourse): ContentManagerItemSummary {
  return withCommonSummaryFields('courses', {
    id: course.id,
    title: course.title,
    description: course.description,
    code: course.code,
    durationMinutes: course.duration_minutes || course.totalDuration,
    thumbnailUrl: course.thumbnailUrl,
    access: 'free',
    previewRoute: {
      pathname: '/course/[id]',
      params: { id: course.id },
    },
  });
}

export function normalizeCourseSessionSummary(
  session: FirestoreCourseSession,
  course?: Pick<FirestoreCourse, 'title' | 'code' | 'instructor' | 'color' | 'thumbnailUrl'>
): ContentManagerItemSummary {
  return withCommonSummaryFields('course_sessions', {
    id: session.id,
    title: session.title,
    description: session.description,
    code: session.code,
    durationMinutes: session.duration_minutes,
    thumbnailUrl: course?.thumbnailUrl,
    access: session.isFree === true ? 'free' : 'premium',
    previewRoute: {
      pathname: '/course/session/[id]',
      params: {
        id: session.id,
        audioPath: session.audioPath,
        title: session.title,
        courseTitle: course?.title || '',
        courseCode: course?.code || '',
        sessionCode: session.code || '',
        duration: String(session.duration_minutes),
        instructor: course?.instructor || '',
        color: course?.color || '',
        thumbnailUrl: course?.thumbnailUrl || '',
      },
    },
  });
}

function normalizeGuidedMeditationDetail(
  meditation: GuidedMeditation
): ContentManagerItemDetail {
  return {
    ...normalizeGuidedMeditationSummary(meditation),
    metadata: appendMetadata([
      { label: 'Themes', value: (meditation.themes || []).join(', ') },
      { label: 'Techniques', value: (meditation.techniques || []).join(', ') },
      { label: 'Difficulty', value: meditation.difficulty_level },
      { label: 'Instructor', value: meditation.instructor },
      { label: 'Audio Path', value: meditation.audioPath, monospace: true },
    ]),
    relations: [],
    editableFields: getContentManagerEditFields('guided_meditations'),
    editableValues: buildEditableValues('guided_meditations', meditation as unknown as Record<string, unknown>),
  };
}

function normalizeSleepMeditationDetail(
  meditation: FirestoreSleepMeditation
): ContentManagerItemDetail {
  return {
    ...normalizeSleepMeditationSummary(meditation),
    metadata: appendMetadata([
      { label: 'Instructor', value: meditation.instructor },
      { label: 'Icon', value: meditation.icon },
      { label: 'Color', value: meditation.color, monospace: true },
      { label: 'Audio Path', value: meditation.audioPath, monospace: true },
    ]),
    relations: [],
    editableFields: getContentManagerEditFields('sleep_meditations'),
    editableValues: buildEditableValues('sleep_meditations', meditation as unknown as Record<string, unknown>),
  };
}

function normalizeBedtimeStoryDetail(story: BedtimeStory): ContentManagerItemDetail {
  return {
    ...normalizeBedtimeStorySummary(story),
    metadata: appendMetadata([
      { label: 'Narrator', value: story.narrator },
      { label: 'Category', value: story.category },
      { label: 'Thumbnail URL', value: story.thumbnail_url, monospace: true },
      { label: 'Audio URL', value: story.audio_url, monospace: true },
      { label: 'Audio Asset', value: story.audio_file, monospace: true },
    ]),
    relations: [],
    editableFields: getContentManagerEditFields('bedtime_stories'),
    editableValues: buildEditableValues('bedtime_stories', story as unknown as Record<string, unknown>),
  };
}

function normalizeEmergencyMeditationDetail(
  meditation: FirestoreEmergencyMeditation
): ContentManagerItemDetail {
  return {
    ...normalizeEmergencyMeditationSummary(meditation),
    metadata: appendMetadata([
      { label: 'Narrator', value: meditation.narrator },
      { label: 'Icon', value: meditation.icon },
      { label: 'Color', value: meditation.color, monospace: true },
      { label: 'Audio Path', value: meditation.audioPath, monospace: true },
    ]),
    relations: [],
    editableFields: getContentManagerEditFields('emergency_meditations'),
    editableValues: buildEditableValues(
      'emergency_meditations',
      meditation as unknown as Record<string, unknown>
    ),
  };
}

function normalizeCourseDetail(course: FirestoreCourse): ContentManagerItemDetail {
  return {
    ...normalizeCourseSummary(course),
    metadata: appendMetadata([
      { label: 'Code', value: course.code, monospace: true },
      { label: 'Subtitle', value: course.subtitle },
      { label: 'Instructor', value: course.instructor },
      { label: 'Subject', value: course.subjectLabel },
      { label: 'Subject ID', value: course.subjectId, monospace: true },
      { label: 'Difficulty', value: course.difficulty },
      { label: 'Icon', value: course.icon },
      { label: 'Color', value: course.color, monospace: true },
      { label: 'Session Count', value: course.sessionCount || course.session_count || 0 },
    ]),
    relations: (course.sessions || []).map((session, index) => ({
      label: `Session ${index + 1}`,
      collection: 'course_sessions',
      id: session.id,
      title: session.title,
      code: session.code,
    })),
    editableFields: getContentManagerEditFields('courses'),
    editableValues: buildEditableValues('courses', course as unknown as Record<string, unknown>),
  };
}

function normalizeCourseSessionDetail(
  session: FirestoreCourseSession,
  course: FirestoreCourse | null
): ContentManagerItemDetail {
  return {
    ...normalizeCourseSessionSummary(session, course || undefined),
    metadata: appendMetadata([
      { label: 'Code', value: session.code, monospace: true },
      { label: 'Course ID', value: session.courseId, monospace: true },
      { label: 'Order', value: session.order },
      { label: 'Day Number', value: session.dayNumber },
      { label: 'Audio Path', value: session.audioPath, monospace: true },
    ]),
    relations: course
      ? [
          {
            label: 'Course',
            collection: 'courses',
            id: course.id,
            title: course.title,
            code: course.code,
          },
        ]
      : [],
    editableFields: getContentManagerEditFields('course_sessions'),
    editableValues: buildEditableValues(
      'course_sessions',
      session as unknown as Record<string, unknown>
    ),
  };
}

// ==================== ALBUM ====================

export function normalizeAlbumSummary(album: FirestoreAlbum): ContentManagerItemSummary {
  return withCommonSummaryFields('albums', {
    id: album.id,
    title: album.title,
    description: album.description,
    durationMinutes: album.totalDuration,
    thumbnailUrl: album.thumbnailUrl,
    access: 'free',
    previewRoute: { pathname: '/album/[id]', params: { id: album.id } },
  });
}

// ==================== SLEEP SOUND ====================

export function normalizeSleepSoundSummary(sound: FirestoreSleepSound): ContentManagerItemSummary {
  return withCommonSummaryFields('sleep_sounds', {
    id: sound.id,
    title: sound.title,
    description: sound.description,
    thumbnailUrl: sound.thumbnailUrl,
    access: 'free',
    previewRoute: { pathname: '/sleep-sounds', params: { id: sound.id } },
  });
}

// ==================== BACKGROUND SOUND ====================

export function normalizeBackgroundSoundSummary(
  sound: FirestoreBackgroundSound
): ContentManagerItemSummary {
  return withCommonSummaryFields('background_sounds', {
    id: sound.id,
    title: sound.title,
    access: 'free',
    previewRoute: { pathname: '/sleep-sounds', params: { id: sound.id } },
  });
}

// ==================== WHITE NOISE / MUSIC / ASMR ====================

function normalizeMusicItemSummary(
  collection: 'white_noise' | 'music' | 'asmr',
  item: FirestoreMusicItem
): ContentManagerItemSummary {
  return withCommonSummaryFields(collection, {
    id: item.id,
    title: item.title,
    description: item.description,
    durationMinutes: item.duration_minutes,
    thumbnailUrl: item.thumbnailUrl,
    access: 'free',
    previewRoute: { pathname: '/music/[id]', params: { id: item.id } },
  });
}

// ==================== SERIES ====================

export function normalizeSeriesSummary(s: FirestoreSeries): ContentManagerItemSummary {
  return withCommonSummaryFields('series', {
    id: s.id,
    title: s.title,
    description: s.description,
    durationMinutes: s.totalDuration,
    thumbnailUrl: s.thumbnailUrl,
    access: 'free',
    previewRoute: { pathname: '/series/[id]', params: { id: s.id } },
  });
}

// ==================== BREATHING EXERCISE ====================

export function normalizeBreathingExerciseSummary(
  exercise: BreathingExercise
): ContentManagerItemSummary {
  return withCommonSummaryFields('breathing_exercises', {
    id: exercise.id,
    title: exercise.name,
    description: exercise.description,
    durationMinutes: exercise.duration_minutes,
    access: 'free',
    previewRoute: { pathname: '/breathing', params: { id: exercise.id } },
  });
}

// ==================== MEDITATION PROGRAM ====================

export function normalizeMeditationProgramSummary(
  program: MeditationProgram
): ContentManagerItemSummary {
  return withCommonSummaryFields('meditation_programs', {
    id: program.id,
    title: program.title,
    description: program.description,
    access: 'free',
    previewRoute: { pathname: '/meditation/[id]', params: { id: program.id } },
  });
}

// ==================== FETCH ALL ====================

async function safeGet<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

export async function getContentManagerItems(): Promise<ContentManagerItemSummary[]> {
  const [
    meditations,
    sleepMeditations,
    bedtimeStories,
    emergencyMeditations,
    courses,
    courseSessions,
    albums,
    sleepSounds,
    backgroundSounds,
    whiteNoise,
    musicItems,
    asmrItems,
    seriesList,
    breathingExercises,
    meditationPrograms,
  ] = await Promise.all([
    getMeditations(),
    getSleepMeditations(),
    getBedtimeStories(),
    getEmergencyMeditations(),
    getCourses(),
    getCourseSessions(),
    safeGet(getAlbums),
    safeGet(getSleepSounds),
    safeGet(getBackgroundSounds),
    safeGet(getWhiteNoise),
    safeGet(getMusic),
    safeGet(getAsmr),
    safeGet(getSeries),
    safeGet(getBreathingExercises),
    safeGet(getPrograms),
  ]);

  const coursesById = new Map(courses.map((course) => [course.id, course]));

  return [
    ...meditations.map(normalizeGuidedMeditationSummary),
    ...sleepMeditations.map(normalizeSleepMeditationSummary),
    ...bedtimeStories.map(normalizeBedtimeStorySummary),
    ...emergencyMeditations.map(normalizeEmergencyMeditationSummary),
    ...courses.map(normalizeCourseSummary),
    ...courseSessions.map((session) =>
      normalizeCourseSessionSummary(session, coursesById.get(session.courseId))
    ),
    ...albums.map(normalizeAlbumSummary),
    ...sleepSounds.map(normalizeSleepSoundSummary),
    ...backgroundSounds.map(normalizeBackgroundSoundSummary),
    ...whiteNoise.map((item) => normalizeMusicItemSummary('white_noise', item)),
    ...musicItems.map((item) => normalizeMusicItemSummary('music', item)),
    ...asmrItems.map((item) => normalizeMusicItemSummary('asmr', item)),
    ...seriesList.map(normalizeSeriesSummary),
    ...breathingExercises.map(normalizeBreathingExerciseSummary),
    ...meditationPrograms.map(normalizeMeditationProgramSummary),
  ];
}

export async function getContentManagerItemDetail(
  collection: ContentManagerCollection,
  id: string
): Promise<ContentManagerItemDetail | null> {
  switch (collection) {
    case 'guided_meditations': {
      const meditation = await getMeditationById(id);
      return meditation ? normalizeGuidedMeditationDetail(meditation) : null;
    }
    case 'sleep_meditations': {
      const meditation = await getSleepMeditationById(id);
      return meditation ? normalizeSleepMeditationDetail(meditation) : null;
    }
    case 'bedtime_stories': {
      const story = await getBedtimeStoryById(id);
      return story ? normalizeBedtimeStoryDetail(story) : null;
    }
    case 'emergency_meditations': {
      const meditation = await getEmergencyMeditationById(id);
      return meditation ? normalizeEmergencyMeditationDetail(meditation) : null;
    }
    case 'courses': {
      const course = await getCourseById(id);
      return course ? normalizeCourseDetail(course) : null;
    }
    case 'course_sessions': {
      const session = await getCourseSessionById(id);
      if (!session) return null;
      const course = session.courseId ? await getCourseById(session.courseId) : null;
      return normalizeCourseSessionDetail(session, course);
    }
    case 'albums': {
      const album = await getAlbumById(id);
      if (!album) return null;
      return {
        ...normalizeAlbumSummary(album),
        metadata: appendMetadata([
          { label: 'Artist', value: album.artist },
          { label: 'Category', value: album.category },
          { label: 'Track Count', value: album.trackCount },
          { label: 'Color', value: album.color, monospace: true },
        ]),
        relations: (album.tracks || []).map((track, i) => ({
          label: `Track ${i + 1}`,
          collection: 'albums' as ContentManagerCollection,
          id: album.id,
          title: track.title,
        })),
        editableFields: getContentManagerEditFields('albums'),
        editableValues: buildEditableValues('albums', album as unknown as Record<string, unknown>),
      };
    }
    case 'sleep_sounds': {
      const sound = await getSleepSoundById(id);
      if (!sound) return null;
      return {
        ...normalizeSleepSoundSummary(sound),
        metadata: appendMetadata([
          { label: 'Category', value: sound.category },
          { label: 'Icon', value: sound.icon },
          { label: 'Color', value: sound.color, monospace: true },
          { label: 'Audio Path', value: sound.audioPath, monospace: true },
        ]),
        relations: [],
        editableFields: getContentManagerEditFields('sleep_sounds'),
        editableValues: buildEditableValues('sleep_sounds', sound as unknown as Record<string, unknown>),
      };
    }
    case 'background_sounds': {
      const sound = await getBackgroundSoundById(id);
      if (!sound) return null;
      return {
        ...normalizeBackgroundSoundSummary(sound),
        metadata: appendMetadata([
          { label: 'Category', value: sound.category },
          { label: 'Icon', value: sound.icon },
          { label: 'Color', value: sound.color, monospace: true },
          { label: 'Audio Path', value: sound.audioPath, monospace: true },
        ]),
        relations: [],
        editableFields: getContentManagerEditFields('background_sounds'),
        editableValues: buildEditableValues('background_sounds', sound as unknown as Record<string, unknown>),
      };
    }
    case 'white_noise':
    case 'music':
    case 'asmr': {
      // All three share FirestoreMusicItem shape — resolved via collection-specific getById
      const getById =
        collection === 'white_noise'
          ? async (itemId: string) => (await getWhiteNoise()).find((i) => i.id === itemId) || null
          : collection === 'music'
            ? async (itemId: string) => (await getMusic()).find((i) => i.id === itemId) || null
            : async (itemId: string) => (await getAsmr()).find((i) => i.id === itemId) || null;
      const item = await getById(id);
      if (!item) return null;
      return {
        ...normalizeMusicItemSummary(collection, item),
        metadata: appendMetadata([
          { label: 'Category', value: item.category },
          { label: 'Icon', value: item.icon },
          { label: 'Color', value: item.color, monospace: true },
          { label: 'Audio Path', value: item.audioPath, monospace: true },
        ]),
        relations: [],
        editableFields: getContentManagerEditFields(collection),
        editableValues: buildEditableValues(collection, item as unknown as Record<string, unknown>),
      };
    }
    case 'series': {
      const s = await getSeriesById(id);
      if (!s) return null;
      return {
        ...normalizeSeriesSummary(s),
        metadata: appendMetadata([
          { label: 'Narrator', value: s.narrator },
          { label: 'Category', value: s.category },
          { label: 'Chapter Count', value: s.chapterCount },
          { label: 'Color', value: s.color, monospace: true },
        ]),
        relations: (s.chapters || []).map((ch, i) => ({
          label: `Chapter ${i + 1}`,
          collection: 'series' as ContentManagerCollection,
          id: s.id,
          title: ch.title,
        })),
        editableFields: getContentManagerEditFields('series'),
        editableValues: buildEditableValues('series', s as unknown as Record<string, unknown>),
      };
    }
    case 'breathing_exercises': {
      const exercises = await getBreathingExercises();
      const exercise = exercises.find((e) => e.id === id) || null;
      if (!exercise) return null;
      return {
        ...normalizeBreathingExerciseSummary(exercise),
        metadata: appendMetadata([
          { label: 'Difficulty', value: exercise.difficulty_level },
          { label: 'Benefits', value: exercise.benefits?.join(', ') },
          { label: 'Inhale', value: `${exercise.pattern.inhale_duration}s` },
          { label: 'Hold', value: exercise.pattern.hold_duration ? `${exercise.pattern.hold_duration}s` : undefined },
          { label: 'Exhale', value: `${exercise.pattern.exhale_duration}s` },
          { label: 'Cycles', value: exercise.pattern.cycles },
        ]),
        relations: [],
        editableFields: getContentManagerEditFields('breathing_exercises'),
        editableValues: buildEditableValues('breathing_exercises', exercise as unknown as Record<string, unknown>),
      };
    }
    case 'meditation_programs': {
      const programs = await getPrograms();
      const program = programs.find((p) => p.id === id) || null;
      if (!program) return null;
      return {
        ...normalizeMeditationProgramSummary(program),
        metadata: appendMetadata([
          { label: 'Difficulty', value: program.difficulty_level },
          { label: 'Duration (days)', value: program.duration_days },
          { label: 'Active', value: program.is_active ? 'Yes' : 'No' },
        ]),
        relations: (program.sessions || []).map((session, i) => ({
          label: `Session ${i + 1}`,
          collection: 'guided_meditations' as ContentManagerCollection,
          id: session.id,
          title: session.title,
        })),
        editableFields: getContentManagerEditFields('meditation_programs'),
        editableValues: buildEditableValues('meditation_programs', program as unknown as Record<string, unknown>),
      };
    }
    default:
      return null;
  }
}
