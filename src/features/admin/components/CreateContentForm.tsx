/**
 * Content creation form for job submission.
 *
 * ARCHITECTURAL ROLE:
 * Comprehensive form for creating content jobs with dynamic fields based on contentType.
 * Handles single content, courses, and full subject curriculum generation.
 *
 * DESIGN PATTERNS:
 * - Progressive disclosure: Shows/hides fields based on contentType selection
 * - Conditional validation: Submit disabled based on content type requirements
 * - Form state management: All fields passed as props (controlled inputs)
 * - Dynamic UI: Course-specific, subject-specific fields rendered conditionally
 *
 * FLOW:
 * 1. Admin selects contentType (meditation, course, full_subject)
 * 2. Form reveals relevant fields (topic, duration, course code, etc.)
 * 3. For full_subject: show level counts, calculate total courses, warn if >20
 * 4. Model selection: LLM backend -> TTS backend -> TTS model -> voice
 * 5. Approval checkboxes: Script approval, subject plan approval toggles
 * 6. Submit validation: Full subject requires subject + valid course count
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Dropdown, DropdownOption } from './Dropdown';
import { RadioGroup } from './RadioGroup';
import { FactoryContentType, SubjectLevelCounts } from '../types';
import { Theme } from '@/theme';

type Props = {
  // Content type
  contentType: FactoryContentType;
  onContentTypeChange: (ct: FactoryContentType) => void;
  contentTypeOptions: DropdownOption[];

  // Common fields
  title: string;
  onTitleChange: (v: string) => void;
  topic: string;
  onTopicChange: (v: string) => void;
  duration: number;
  onDurationChange: (v: number) => void;
  style: string;
  onStyleChange: (v: string) => void;
  technique: string;
  onTechniqueChange: (v: string) => void;
  difficulty: string;
  onDifficultyChange: (v: string) => void;
  customInstructions: string;
  onCustomInstructionsChange: (v: string) => void;
  imagePrompt: string;
  onImagePromptChange: (v: string) => void;

  // Course-specific
  isCourse: boolean;
  isFullSubject: boolean;
  courseCode: string;
  onCourseCodeChange: (v: string) => void;
  courseCodeError?: string | null;
  isCheckingCode: boolean;
  courseTitle: string;
  onCourseTitleChange: (v: string) => void;
  subjectId: string;
  onSubjectChange: (v: string) => void;
  subjectOptions: DropdownOption[];
  targetAudience: string;
  onTargetAudienceChange: (v: string) => void;
  tone: string;
  onToneChange: (v: string) => void;
  generateThumbnailDuringRun: boolean;
  onGenerateThumbnailDuringRunChange: (v: boolean) => void;
  requireScriptApprovalBeforeTts: boolean;
  onRequireScriptApprovalBeforeTtsChange: (v: boolean) => void;
  levelCounts: SubjectLevelCounts;
  onLevelCountChange: (level: keyof SubjectLevelCounts, value: string) => void;
  derivedCourseCount: number;
  requireSubjectPlanApproval: boolean;
  onRequireSubjectPlanApprovalChange: (v: boolean) => void;

  // Backends / models
  llmBackend: string;
  onLLMBackendChange: (v: any) => void;
  ttsBackend: string;
  onTTSBackendChange: (v: any) => void;
  llmModel: string;
  onLLMModelChange: (v: string) => void;
  ttsModel: string;
  onTTSModelChange: (v: string) => void;
  ttsVoice: string;
  onTTSVoiceChange: (v: string) => void;
  llmModelOptions: DropdownOption[];
  ttsModelOptions: DropdownOption[];
  voiceOptions: DropdownOption[];

  // Options
  autoPublish: boolean;
  onAutoPublishChange: (v: boolean) => void;

  // Submit
  onSubmit: () => void;
  isSubmitting: boolean;

  // Static options
  durationOptions: DropdownOption[];
  difficultyOptions: DropdownOption[];
  audienceOptions: DropdownOption[];
  toneOptions: DropdownOption[];
};

export function CreateContentForm(props: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isSingleContent = !props.isCourse && !props.isFullSubject;
  const isSubmitDisabled =
    props.isSubmitting ||
    (props.isFullSubject && (!props.subjectId || props.derivedCourseCount <= 0));
  const levelFields: Array<{ key: keyof SubjectLevelCounts; label: string }> = [
    { key: 'l100', label: '100 Level' },
    { key: 'l200', label: '200 Level' },
    { key: 'l300', label: '300 Level' },
    { key: 'l400', label: '400 Level' },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionHeader}>Create Content</Text>

      {/* Content Type */}
      <Text style={styles.sectionTitle}>Content Type</Text>
      <RadioGroup
        options={props.contentTypeOptions}
        selectedId={props.contentType}
        onSelect={(id) => props.onContentTypeChange(id as FactoryContentType)}
      />

      {/* Course fields */}
      {props.isCourse ? (
        <>
          <Text style={styles.sectionTitle}>Course Code</Text>
          <TextInput
            style={styles.input}
            placeholder="E.g. CBT101"
            value={props.courseCode}
            onChangeText={props.onCourseCodeChange}
            autoCapitalize="characters"
          />
          {props.courseCodeError ? (
            <Text style={[styles.helperText, { color: theme.colors.error }]}>
              {props.courseCodeError}
            </Text>
          ) : (
            <Text style={[styles.helperText, { color: theme.colors.textMuted }]}>
              {props.isCheckingCode ? 'Checking...' : 'Must be unique (3+ chars, alphanumeric)'}
            </Text>
          )}

          <Text style={styles.sectionTitle}>Course Title</Text>
          <TextInput
            style={styles.input}
            placeholder="Course title"
            value={props.courseTitle}
            onChangeText={props.onCourseTitleChange}
          />

          <Text style={styles.sectionTitle}>Therapy Subject</Text>
          <Dropdown
            options={props.subjectOptions}
            selectedId={props.subjectId}
            onSelect={(id) => props.onSubjectChange(String(id))}
          />

          <Text style={styles.sectionTitle}>Target Audience</Text>
          <RadioGroup
            options={props.audienceOptions}
            selectedId={props.targetAudience}
            onSelect={(id) => props.onTargetAudienceChange(String(id))}
          />

          <Text style={styles.sectionTitle}>Tone</Text>
          <RadioGroup
            options={props.toneOptions}
            selectedId={props.tone}
            onSelect={(id) => props.onToneChange(String(id))}
          />

        </>
      ) : null}

      {props.isFullSubject ? (
        <>
          <Text style={styles.sectionTitle}>Therapy Subject</Text>
          <Dropdown
            options={props.subjectOptions}
            selectedId={props.subjectId}
            onSelect={(id) => props.onSubjectChange(String(id))}
          />

          <Text style={styles.sectionTitle}>Course Count By Level</Text>
          <View style={styles.levelGrid}>
            {levelFields.map((field) => (
              <View key={field.key} style={styles.levelCard}>
                <Text style={styles.levelLabel}>{field.label}</Text>
                <TextInput
                  style={[styles.input, styles.levelInput]}
                  keyboardType="number-pad"
                  value={String(props.levelCounts[field.key] ?? 0)}
                  onChangeText={(value) => props.onLevelCountChange(field.key, value)}
                />
              </View>
            ))}
          </View>

          <View style={styles.subjectSummaryCard}>
            <Text style={styles.subjectSummaryLabel}>Total Courses</Text>
            <Text style={styles.subjectSummaryValue}>{props.derivedCourseCount}</Text>
            {props.derivedCourseCount > 20 ? (
              <Text style={styles.subjectSummaryHelper}>
                Large runs can take a long time. Approval before launch is strongly recommended.
              </Text>
            ) : null}
          </View>
        </>
      ) : null}

      {/* Common Fields */}
      {isSingleContent && (
        <>
          <Text style={styles.sectionTitle}>Title (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="A calming title"
            value={props.title}
            onChangeText={props.onTitleChange}
          />
        </>
      )}

      {!props.isFullSubject && (
        <>
          <Text style={styles.sectionTitle}>{props.isCourse ? 'Course Description' : 'Topic'}</Text>
          <TextInput
            style={styles.input}
            placeholder={props.isCourse ? 'Course description' : 'What should we generate?'}
            value={props.topic}
            onChangeText={props.onTopicChange}
          />
        </>
      )}

      {isSingleContent && (
        <>
          <Text style={styles.sectionTitle}>Duration</Text>
          <RadioGroup
            options={props.durationOptions}
            selectedId={String(props.duration)}
            onSelect={(id) => props.onDurationChange(Number(id))}
          />
        </>
      )}

      {isSingleContent && (
        <>
          <Text style={styles.sectionTitle}>Style</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Calm, compassionate"
            value={props.style}
            onChangeText={props.onStyleChange}
          />

          <Text style={styles.sectionTitle}>Technique</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Body scan, breath focus"
            value={props.technique}
            onChangeText={props.onTechniqueChange}
          />

          <Text style={styles.sectionTitle}>Difficulty</Text>
          <RadioGroup
            options={props.difficultyOptions}
            selectedId={props.difficulty}
            onSelect={(id) => props.onDifficultyChange(String(id))}
          />
        </>
      )}

      <Text style={styles.sectionTitle}>Custom Instructions</Text>
      <TextInput
        style={[styles.input, styles.multilineInput]}
        placeholder="Add any extra guidance for the LLM"
        value={props.customInstructions}
        onChangeText={props.onCustomInstructionsChange}
        multiline
      />

      {!props.isFullSubject && (
        <>
          <Text style={styles.sectionTitle}>Image Prompt (optional)</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            placeholder="Describe the thumbnail image"
            value={props.imagePrompt}
            onChangeText={props.onImagePromptChange}
            multiline
          />

          {props.isCourse && (
            <>
              <Text style={styles.sectionTitle}>Thumbnail Timing</Text>
              <View style={styles.toggleRow}>
                <View style={styles.toggleInfo}>
                  <Text style={styles.toggleLabel}>Generate thumbnail during run</Text>
                  <Text style={styles.toggleDescription}>
                    On by default. Turn this off only if you want to defer thumbnail generation and run it later from the completed job.
                  </Text>
                </View>
                <Switch
                  value={props.generateThumbnailDuringRun}
                  onValueChange={props.onGenerateThumbnailDuringRunChange}
                  trackColor={{ false: theme.colors.gray[300], true: `${theme.colors.primary}80` }}
                  thumbColor={
                    props.generateThumbnailDuringRun
                      ? theme.colors.primary
                      : theme.colors.gray[400]
                  }
                />
              </View>
            </>
          )}

          <Text style={styles.sectionTitle}>Script Approval</Text>
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>Pause for script approval</Text>
              <Text style={styles.toggleDescription}>
                Optional. Stop after scripts are generated so you can edit, approve, or regenerate them before TTS starts.
              </Text>
            </View>
            <Switch
              value={props.requireScriptApprovalBeforeTts}
              onValueChange={props.onRequireScriptApprovalBeforeTtsChange}
              trackColor={{ false: theme.colors.gray[300], true: `${theme.colors.primary}80` }}
              thumbColor={
                props.requireScriptApprovalBeforeTts
                  ? theme.colors.primary
                  : theme.colors.gray[400]
              }
            />
          </View>
        </>
      )}

      {props.isFullSubject && (
        <>
          <Text style={styles.sectionTitle}>Lineup Approval</Text>
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>Pause after lineup generation</Text>
              <Text style={styles.toggleDescription}>
                Review and edit the generated course titles and descriptions before child course jobs launch.
              </Text>
            </View>
            <Switch
              value={props.requireSubjectPlanApproval}
              onValueChange={props.onRequireSubjectPlanApprovalChange}
              trackColor={{ false: theme.colors.gray[300], true: `${theme.colors.primary}80` }}
              thumbColor={
                props.requireSubjectPlanApproval
                  ? theme.colors.primary
                  : theme.colors.gray[400]
              }
            />
          </View>
        </>
      )}

      {/* Model selection */}
      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>LLM Model</Text>
      <RadioGroup
        options={props.llmModelOptions}
        selectedId={props.llmModel}
        onSelect={(id) => props.onLLMModelChange(String(id))}
      />

      <Text style={styles.sectionTitle}>TTS Model</Text>
      <RadioGroup
        options={props.ttsModelOptions}
        selectedId={props.ttsModel}
        onSelect={(id) => props.onTTSModelChange(String(id))}
      />

      {/* Voice */}
      {props.voiceOptions.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Voice</Text>
          <RadioGroup
            options={props.voiceOptions}
            selectedId={props.ttsVoice}
            onSelect={props.onTTSVoiceChange}
          />
        </>
      )}

      {/* Auto-Publish Toggle */}
      {!props.isFullSubject && (
        <>
          <View style={styles.divider} />
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>Auto-publish</Text>
              <Text style={styles.toggleDescription}>
                {props.autoPublish
                  ? 'Content will be published automatically when done'
                  : 'Content will need manual approval before publishing'}
              </Text>
            </View>
            <Switch
              value={props.autoPublish}
              onValueChange={props.onAutoPublishChange}
              trackColor={{ false: theme.colors.gray[300], true: `${theme.colors.primary}80` }}
              thumbColor={props.autoPublish ? theme.colors.primary : theme.colors.gray[400]}
            />
          </View>
        </>
      )}

      {/* Submit */}
      <Pressable
        style={({ pressed }) => [
          styles.submitButton,
          pressed && { opacity: 0.85 },
          isSubmitDisabled && styles.submitButtonDisabled,
        ]}
        onPress={props.onSubmit}
        disabled={isSubmitDisabled}
      >
        {props.isSubmitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="sparkles" size={20} color="#fff" />
            <Text style={styles.submitText}>
              {props.isFullSubject ? 'Generate Subject Curriculum' : 'Generate Content'}
            </Text>
          </>
        )}
      </Pressable>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      padding: 20,
      maxWidth: 600,
      width: '100%',
      alignSelf: 'center',
    },
    sectionHeader: {
      fontFamily: 'DMSans-Bold',
      fontSize: 18,
      color: theme.colors.text,
      marginBottom: 16,
    },
    sectionTitle: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 14,
      color: theme.colors.textLight,
      marginBottom: 10,
      marginTop: 16,
    },
    segmentRow: {
      flexDirection: 'row',
      gap: 8,
    },
    segment: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: theme.colors.surface,
    },
    segmentActive: {
      backgroundColor: theme.colors.primary,
    },
    segmentText: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    segmentTextActive: {
      color: '#fff',
    },
    input: {
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontFamily: 'DMSans-Regular',
      fontSize: 15,
      color: theme.colors.text,
    },
    multilineInput: {
      minHeight: 80,
      textAlignVertical: 'top',
    },
    levelGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    levelCard: {
      width: '47%',
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      padding: 12,
      gap: 8,
    },
    levelLabel: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 13,
      color: theme.colors.text,
    },
    levelInput: {
      paddingVertical: 10,
    },
    subjectSummaryCard: {
      marginTop: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
      padding: 14,
      backgroundColor: theme.colors.surface,
    },
    subjectSummaryLabel: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.colors.textMuted,
      marginBottom: 6,
    },
    subjectSummaryValue: {
      fontFamily: 'DMSans-Bold',
      fontSize: 24,
      color: theme.colors.text,
    },
    subjectSummaryHelper: {
      marginTop: 8,
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.colors.warning,
      lineHeight: 18,
    },
    helperText: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      marginTop: 6,
      marginLeft: 4,
    },
    divider: {
      height: 1,
      backgroundColor: theme.colors.gray[200],
      marginVertical: 24,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    toggleInfo: {
      flex: 1,
    },
    toggleLabel: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 14,
      color: theme.colors.text,
    },
    toggleDescription: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.colors.textMuted,
      marginTop: 2,
    },
    submitButton: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#6C5CE7',
      paddingVertical: 14,
      borderRadius: 14,
      marginTop: 12,
    },
    submitButtonDisabled: {
      opacity: 0.7,
    },
    submitText: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 15,
      color: '#fff',
    },
  });
