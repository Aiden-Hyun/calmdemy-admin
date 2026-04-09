import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { useJobQueue } from '@features/admin/hooks/useJobQueue';
import {
  FactoryContentType,
  CreateJobInput,
  JobBackend,
  SubjectLevelCounts,
} from '@features/admin/types';
import {
  getLLMModelsForBackend,
  getTTSModelsForBackend,
  getVoicesForTTSModel,
  getDefaultLLMModel,
  getDefaultTTSModel,
  getDefaultVoice,
} from '@features/admin/constants/models';
import {
  getStylesForContentType,
  getTechniquesForContentType,
  getTopicsForContentType,
  getTechniqueLabel,
} from '@features/admin/constants/contentOptions';
import {
  getSubjects,
  checkCourseCodeExists,
  Subject,
} from '@features/admin/data/adminRepository';
import {
  getDraft,
  saveDraft,
  deleteDraft,
} from '@features/admin/data/draftRepository';
import { DropdownOption } from '@features/admin/components/Dropdown';
import { CreateContentForm } from '@features/admin/components/CreateContentForm';

// Static options
const CONTENT_TYPE_OPTIONS: DropdownOption[] = [
  { id: 'guided_meditation', label: 'Guided Meditation' },
  { id: 'sleep_meditation', label: 'Sleep Meditation' },
  { id: 'bedtime_story', label: 'Bedtime Story' },
  { id: 'emergency_meditation', label: 'Emergency Meditation' },
  { id: 'course_session', label: 'Course Session' },
  { id: 'course', label: 'Full Course (9 audio)' },
  { id: 'full_subject', label: 'Full Subject' },
];

const DURATION_OPTIONS: DropdownOption[] = [5, 10, 15, 20, 30].map((d) => ({
  id: String(d),
  label: `${d} minutes`,
}));

const DIFFICULTY_OPTIONS: DropdownOption[] = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
];

const AUDIENCE_OPTIONS: DropdownOption[] = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
];

const TONE_OPTIONS: DropdownOption[] = [
  { id: 'gentle', label: 'Gentle' },
  { id: 'energetic', label: 'Energetic' },
  { id: 'very calm', label: 'Very Calm' },
];

type DraftPayload = {
  contentType: FactoryContentType;
  title: string;
  topic: string;
  duration: number;
  style: string;
  technique: string;
  difficulty: string;
  customInstructions: string;
  imagePrompt: string;
  autoPublish: boolean;
  courseCode: string;
  courseTitle: string;
  subjectId: string;
  targetAudience: string;
  tone: string;
  generateThumbnailDuringRun: boolean;
  requireScriptApprovalBeforeTts: boolean;
  levelCounts: SubjectLevelCounts;
  requireSubjectPlanApproval: boolean;
  llmBackend: JobBackend;
  ttsBackend: JobBackend;
  llmModel: string;
  ttsModel: string;
  ttsVoice: string;
};

function normalizeGenerateThumbnailDuringRun(value?: boolean): boolean {
  return value !== false;
}

export default function CreateContentScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { draftId } = useLocalSearchParams<{ draftId?: string }>();
  const { theme } = useTheme();
  const { createJob } = useJobQueue();

  // Form state
  const [contentType, setContentType] = useState<FactoryContentType>('guided_meditation');
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [duration, setDuration] = useState(10);
  const [style, setStyle] = useState('');
  const [technique, setTechnique] = useState('');
  const [difficulty, setDifficulty] = useState<string>('beginner');
  const [customInstructions, setCustomInstructions] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [autoPublish, setAutoPublish] = useState(true);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const initialDraftRef = useRef<DraftPayload | null>(null);
  const defaultSnapshotRef = useRef<DraftPayload | null>(null);
  const skipPromptRef = useRef(false);

  // Course-specific state
  const [courseCode, setCourseCode] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [targetAudience, setTargetAudience] = useState<string>('beginner');
  const [tone, setTone] = useState<string>('gentle');
  const [generateThumbnailDuringRun, setGenerateThumbnailDuringRun] = useState(true);
  const [requireScriptApprovalBeforeTts, setRequireScriptApprovalBeforeTts] = useState(false);
  const [levelCounts, setLevelCounts] = useState<SubjectLevelCounts>({
    l100: 0,
    l200: 0,
    l300: 0,
    l400: 0,
  });
  const [requireSubjectPlanApproval, setRequireSubjectPlanApproval] = useState(true);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [courseCodeError, setCourseCodeError] = useState<string | null>(null);
  const [isCheckingCode, setIsCheckingCode] = useState(false);
  const codeCheckTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isCourse = contentType === 'course';
  const isFullSubject = contentType === 'full_subject';
  const derivedCourseCount =
    levelCounts.l100 + levelCounts.l200 + levelCounts.l300 + levelCounts.l400;

  // Independent backend + model state
  const [llmBackend, setLlmBackend] = useState<JobBackend>('local');
  const [ttsBackend, setTtsBackend] = useState<JobBackend>('local');
  const [llmModel, setLlmModel] = useState(getDefaultLLMModel('local'));
  const [ttsModel, setTtsModel] = useState(getDefaultTTSModel('local'));
  const [ttsVoice, setTtsVoice] = useState(getDefaultVoice(getDefaultTTSModel('local')));
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load subjects for course creation
  useEffect(() => {
    getSubjects().then(setSubjects).catch(console.error);
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadDraft = async () => {
      if (!draftId) {
        setActiveDraftId(null);
        initialDraftRef.current = null;
        setDraftReady(true);
        return;
      }

      const draft = await getDraft(String(draftId));
      if (!isMounted) return;

      if (draft) {
        const availableLLMModels = getLLMModelsForBackend(draft.llmBackend);
        const normalizedLLMModel = availableLLMModels.some((m) => m.id === draft.llmModel)
          ? draft.llmModel
          : getDefaultLLMModel(draft.llmBackend);

        const availableTTSModels = getTTSModelsForBackend(draft.ttsBackend);
        const normalizedTTSModel = availableTTSModels.some((m) => m.id === draft.ttsModel)
          ? draft.ttsModel
          : getDefaultTTSModel(draft.ttsBackend);

        const availableVoices = getVoicesForTTSModel(normalizedTTSModel);
        const normalizedTTSVoice = availableVoices.some((v) => v.id === draft.ttsVoice)
          ? draft.ttsVoice
          : getDefaultVoice(normalizedTTSModel);

        setContentType(draft.contentType);
        setTitle(draft.title);
        setTopic(draft.topic);
        setDuration(draft.duration);
        setStyle(draft.style);
        setTechnique(draft.technique);
        setDifficulty(draft.difficulty || 'beginner');
        setCustomInstructions(draft.customInstructions);
        setImagePrompt(draft.imagePrompt);
        setAutoPublish(draft.autoPublish);

        setCourseCode(draft.courseCode);
        setCourseTitle(draft.courseTitle);
        setSubjectId(draft.subjectId);
        setTargetAudience(draft.targetAudience || 'beginner');
        setTone(draft.tone || 'gentle');
        setGenerateThumbnailDuringRun(
          normalizeGenerateThumbnailDuringRun(draft.generateThumbnailDuringRun)
        );
        setRequireScriptApprovalBeforeTts(Boolean(draft.requireScriptApprovalBeforeTts));
        setLevelCounts(
          draft.levelCounts || {
            l100: 0,
            l200: 0,
            l300: 0,
            l400: 0,
          }
        );
        setRequireSubjectPlanApproval(
          draft.requireSubjectPlanApproval !== false
        );

        setLlmBackend(draft.llmBackend);
        setTtsBackend(draft.ttsBackend);
        setLlmModel(normalizedLLMModel);
        setTtsModel(normalizedTTSModel);
        setTtsVoice(normalizedTTSVoice);

        setActiveDraftId(draft.id);
        initialDraftRef.current = {
          contentType: draft.contentType,
          title: draft.title,
          topic: draft.topic,
          duration: draft.duration,
          style: draft.style,
          technique: draft.technique,
          difficulty: draft.difficulty,
          customInstructions: draft.customInstructions,
          imagePrompt: draft.imagePrompt,
          autoPublish: draft.autoPublish,
          courseCode: draft.courseCode,
          courseTitle: draft.courseTitle,
          subjectId: draft.subjectId,
          targetAudience: draft.targetAudience,
          tone: draft.tone,
          generateThumbnailDuringRun: normalizeGenerateThumbnailDuringRun(
            draft.generateThumbnailDuringRun
          ),
          requireScriptApprovalBeforeTts: Boolean(draft.requireScriptApprovalBeforeTts),
          levelCounts: draft.levelCounts || {
            l100: 0,
            l200: 0,
            l300: 0,
            l400: 0,
          },
          requireSubjectPlanApproval: draft.requireSubjectPlanApproval !== false,
          llmBackend: draft.llmBackend,
          ttsBackend: draft.ttsBackend,
          llmModel: normalizedLLMModel,
          ttsModel: normalizedTTSModel,
          ttsVoice: normalizedTTSVoice,
        };
      }

      setDraftReady(true);
    };

    loadDraft();
    return () => {
      isMounted = false;
    };
  }, [draftId]);

  const subjectOptions: DropdownOption[] = useMemo(
    () => subjects.map((s) => ({ id: s.id, label: `${s.label} — ${s.fullName}` })),
    [subjects]
  );

  const handleLevelCountChange = useCallback(
    (level: keyof SubjectLevelCounts, rawValue: string) => {
      const digitsOnly = rawValue.replace(/[^0-9]/g, '');
      const nextValue = digitsOnly ? Number(digitsOnly) : 0;
      setLevelCounts((prev) => ({ ...prev, [level]: nextValue }));
    },
    []
  );

  // Course code uniqueness validation (debounced)
  const handleCourseCodeChange = useCallback((code: string) => {
    const upper = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setCourseCode(upper);
    setCourseCodeError(null);

    if (codeCheckTimeout.current) clearTimeout(codeCheckTimeout.current);
    if (!upper || upper.length < 3) return;

    setIsCheckingCode(true);
    codeCheckTimeout.current = setTimeout(async () => {
      try {
        const exists = await checkCourseCodeExists(upper);
        if (exists) {
          setCourseCodeError(`Code "${upper}" is already in use. Choose another.`);
        } else {
          setCourseCodeError(null);
        }
      } catch {
        // Ignore check errors
      } finally {
        setIsCheckingCode(false);
      }
    }, 500);
  }, []);

  // Derived options
  const llmModelOptions: DropdownOption[] = useMemo(
    () =>
      getLLMModelsForBackend(llmBackend).map((m) => ({
        id: m.id,
        label: m.label,
        description: m.description,
      })),
    [llmBackend]
  );

  const ttsModelOptions: DropdownOption[] = useMemo(
    () =>
      getTTSModelsForBackend(ttsBackend).map((m) => ({
        id: m.id,
        label: m.label,
        description: m.description,
      })),
    [ttsBackend]
  );

  const voiceOptions: DropdownOption[] = useMemo(
    () =>
      getVoicesForTTSModel(ttsModel).map((v) => ({
        id: v.id,
        label: v.label,
        description: v.description,
        sampleUrl: v.sampleUrl,
        sampleAsset: v.sampleAsset,
      })),
    [ttsModel]
  );

  const styleOptions = useMemo(() => getStylesForContentType(contentType), [contentType]);
  const techniqueOptions = useMemo(() => getTechniquesForContentType(contentType), [contentType]);
  const topicSuggestions = useMemo(() => getTopicsForContentType(contentType), [contentType]);
  const techniqueLabel = useMemo(() => getTechniqueLabel(contentType), [contentType]);

  const buildDraftPayload = useCallback((): DraftPayload => ({
    contentType,
    title,
    topic,
    duration,
    style,
    technique,
    difficulty,
    customInstructions,
    imagePrompt,
    autoPublish,
    courseCode,
    courseTitle,
    subjectId,
    targetAudience,
    tone,
    generateThumbnailDuringRun,
    requireScriptApprovalBeforeTts,
    levelCounts,
    requireSubjectPlanApproval,
    llmBackend,
    ttsBackend,
    llmModel,
    ttsModel,
    ttsVoice,
  }), [
    contentType,
    title,
    topic,
    duration,
    style,
    technique,
    difficulty,
    customInstructions,
    imagePrompt,
    autoPublish,
    courseCode,
    courseTitle,
    subjectId,
    targetAudience,
    tone,
    generateThumbnailDuringRun,
    requireScriptApprovalBeforeTts,
    levelCounts,
    requireSubjectPlanApproval,
    llmBackend,
    ttsBackend,
    llmModel,
    ttsModel,
    ttsVoice,
  ]);

  const isDirty = useMemo(() => {
    if (!draftReady) return false;
    const baseline = initialDraftRef.current || defaultSnapshotRef.current;
    if (!baseline) return false;
    const current = buildDraftPayload();
    return JSON.stringify(current) !== JSON.stringify(baseline);
  }, [buildDraftPayload, draftReady]);

  useEffect(() => {
    if (!draftReady) return;
    if (!initialDraftRef.current && !defaultSnapshotRef.current) {
      defaultSnapshotRef.current = buildDraftPayload();
    }
  }, [draftReady, buildDraftPayload]);

  const handleSaveDraft = useCallback(async () => {
    const payload = buildDraftPayload();
    const saved = await saveDraft({
      id: activeDraftId || undefined,
      ...payload,
    });
    setActiveDraftId(saved.id);
    initialDraftRef.current = payload;
    if (!defaultSnapshotRef.current) {
      defaultSnapshotRef.current = payload;
    }
  }, [activeDraftId, buildDraftPayload]);

  // Navigation guard — prompt to save draft
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event: any) => {
      if (skipPromptRef.current || !isDirty) {
        return;
      }

      event.preventDefault();

      Alert.alert(
        'Save Draft?',
        'You have unsaved input. Would you like to save this as a draft?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: async () => {
              if (activeDraftId) {
                await deleteDraft(activeDraftId);
              }
              initialDraftRef.current = defaultSnapshotRef.current;
              navigation.dispatch(event.data.action);
            },
          },
          {
            text: 'Save Draft',
            onPress: async () => {
              await handleSaveDraft();
              navigation.dispatch(event.data.action);
            },
          },
        ]
      );
    });

    return unsubscribe;
  }, [navigation, isDirty, activeDraftId, handleSaveDraft]);

  // Handlers
  const handleLLMBackendChange = (newBackend: JobBackend) => {
    setLlmBackend(newBackend);
    const defaultLLM = getDefaultLLMModel(newBackend);
    setLlmModel(defaultLLM);
  };

  const handleTTSBackendChange = (newBackend: JobBackend) => {
    setTtsBackend(newBackend);
    const defaultTTS = getDefaultTTSModel(newBackend);
    setTtsModel(defaultTTS);
    setTtsVoice(getDefaultVoice(defaultTTS));
  };

  const handleTTSModelChange = (id: string) => {
    setTtsModel(id);
    setTtsVoice(getDefaultVoice(id));
  };

  const handleSubmit = async () => {
    if (isCourse) {
      // Course-specific validation
      if (!courseCode || courseCode.length < 3) {
        Alert.alert('Required', 'Please enter a course code (at least 3 characters).');
        return;
      }
      if (courseCodeError) {
        Alert.alert('Invalid', courseCodeError);
        return;
      }
      if (!courseTitle.trim()) {
        Alert.alert('Required', 'Please enter a course title.');
        return;
      }
      if (!subjectId) {
        Alert.alert('Required', 'Please select a therapy subject.');
        return;
      }
      if (!topic.trim()) {
        Alert.alert('Required', 'Please enter a course description / topic.');
        return;
      }
    } else if (isFullSubject) {
      if (!subjectId) {
        Alert.alert('Required', 'Please select a therapy subject.');
        return;
      }
      if (derivedCourseCount <= 0) {
        Alert.alert('Required', 'Please enter at least one course across the 100/200/300/400 levels.');
        return;
      }
    } else if (!topic.trim()) {
      Alert.alert('Required', 'Please enter a topic.');
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedSubject = subjects.find((s) => s.id === subjectId);

      const input: CreateJobInput = {
        llmBackend,
        ttsBackend,
        contentType,
        params: {
          topic: isFullSubject
            ? (selectedSubject?.description || `${selectedSubject?.fullName || selectedSubject?.label || subjectId} subject curriculum`)
            : topic.trim(),
          duration_minutes: isCourse || isFullSubject ? 0 : duration,
          style: isCourse || isFullSubject ? undefined : (style.trim() || undefined),
          technique: isCourse || isFullSubject ? undefined : (technique.trim() || undefined),
          difficulty: isCourse || isFullSubject ? undefined : difficulty as any,
          customInstructions: customInstructions.trim() || undefined,
          ...((isCourse || isFullSubject) && {
            subjectId,
            subjectLabel: selectedSubject?.label || subjectId,
            subjectColor: selectedSubject?.color || '#6B7280',
            subjectIcon: selectedSubject?.icon || 'school-outline',
          }),
          // Course-specific params
          ...(isCourse && {
            courseCode,
            courseTitle: courseTitle.trim(),
            targetAudience: targetAudience as any,
            tone: tone as any,
          }),
          ...(isFullSubject && {
            levelCounts,
            courseCount: derivedCourseCount,
          }),
        },
        llmModel,
        ttsModel,
        ttsVoice,
        title: isCourse
          ? courseTitle.trim()
          : isFullSubject
            ? `${selectedSubject?.label || 'Subject'} Full Subject`
            : (title.trim() || undefined),
        imagePrompt: isFullSubject ? undefined : (imagePrompt.trim() || undefined),
        autoPublish: isFullSubject ? true : autoPublish,
        generateThumbnailDuringRun: isCourse ? generateThumbnailDuringRun : undefined,
        requireScriptApprovalBeforeTts: isCourse ? requireScriptApprovalBeforeTts : false,
        requireSubjectPlanApproval: isFullSubject ? requireSubjectPlanApproval : false,
      };

      await createJob(input);
      if (activeDraftId) {
        await deleteDraft(activeDraftId);
      }
      skipPromptRef.current = true;
      router.back();
    } catch (error) {
      Alert.alert('Error', 'Failed to create job. Please try again.');
      console.error('Create job error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <CreateContentForm
        contentType={contentType}
        onContentTypeChange={setContentType}
        contentTypeOptions={CONTENT_TYPE_OPTIONS}
        title={title}
        onTitleChange={setTitle}
        topic={topic}
        onTopicChange={setTopic}
        duration={duration}
        onDurationChange={setDuration}
        style={style}
        onStyleChange={setStyle}
        technique={technique}
        onTechniqueChange={setTechnique}
        difficulty={difficulty}
        onDifficultyChange={(id) => setDifficulty(String(id))}
        customInstructions={customInstructions}
        onCustomInstructionsChange={setCustomInstructions}
        imagePrompt={imagePrompt}
        onImagePromptChange={setImagePrompt}
        isCourse={isCourse}
        isFullSubject={isFullSubject}
        courseCode={courseCode}
        onCourseCodeChange={handleCourseCodeChange}
        courseCodeError={courseCodeError}
        isCheckingCode={isCheckingCode}
        courseTitle={courseTitle}
        onCourseTitleChange={setCourseTitle}
        subjectId={subjectId}
        onSubjectChange={setSubjectId}
        subjectOptions={subjectOptions}
        targetAudience={targetAudience}
        onTargetAudienceChange={setTargetAudience}
        tone={tone}
        onToneChange={setTone}
        generateThumbnailDuringRun={generateThumbnailDuringRun}
        onGenerateThumbnailDuringRunChange={setGenerateThumbnailDuringRun}
        requireScriptApprovalBeforeTts={requireScriptApprovalBeforeTts}
        onRequireScriptApprovalBeforeTtsChange={setRequireScriptApprovalBeforeTts}
        levelCounts={levelCounts}
        onLevelCountChange={handleLevelCountChange}
        derivedCourseCount={derivedCourseCount}
        requireSubjectPlanApproval={requireSubjectPlanApproval}
        onRequireSubjectPlanApprovalChange={setRequireSubjectPlanApproval}
        llmBackend={llmBackend}
        onLLMBackendChange={handleLLMBackendChange}
        ttsBackend={ttsBackend}
        onTTSBackendChange={handleTTSBackendChange}
        llmModel={llmModel}
        onLLMModelChange={setLlmModel}
        ttsModel={ttsModel}
        onTTSModelChange={handleTTSModelChange}
        ttsVoice={ttsVoice}
        onTTSVoiceChange={setTtsVoice}
        llmModelOptions={llmModelOptions}
        ttsModelOptions={ttsModelOptions}
        voiceOptions={voiceOptions}
        autoPublish={autoPublish}
        onAutoPublishChange={setAutoPublish}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        durationOptions={DURATION_OPTIONS}
        difficultyOptions={DIFFICULTY_OPTIONS}
        audienceOptions={AUDIENCE_OPTIONS}
        toneOptions={TONE_OPTIONS}
        styleOptions={styleOptions}
        techniqueOptions={techniqueOptions}
        techniqueLabel={techniqueLabel}
        topicSuggestions={topicSuggestions}
      />
    </View>
  );
}
