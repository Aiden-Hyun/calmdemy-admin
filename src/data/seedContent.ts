/**
 * Seed content for Firestore
 *
 * This file contains all the sample content that will be uploaded to Firestore.
 * Audio files reference local assets via the audio_file key.
 */

import { MeditationCategory } from "../types";

// ==================== GUIDED MEDITATIONS (40 entries) ====================

export interface SeedMeditation {
  title: string;
  description: string;
  category: MeditationCategory;
  duration_minutes: number;
  difficulty_level: "beginner" | "intermediate" | "advanced";
  instructor: string;
  audio_file: string;
  image: string;
  isFree: boolean;
  tags: string[];
}

export const seedMeditations: SeedMeditation[] = [
  // ===== GRATITUDE (5) =====
  {
    title: "Morning Calm",
    description:
      "Start your day with peace and gratitude. This gentle meditation helps you set positive intentions for the day ahead.",
    category: "gratitude",
    duration_minutes: 10,
    difficulty_level: "beginner",
    instructor: "Sarah",
    audio_file: "meditation_gratitude",
    image: "meditation_morning_sunrise",
    isFree: true,
    tags: ["morning", "gratitude", "intentions", "peaceful"],
  },
  {
    title: "Gratitude Awakening",
    description:
      "Open your eyes to the blessings around you. A practice to cultivate deep appreciation for life.",
    category: "gratitude",
    duration_minutes: 15,
    difficulty_level: "beginner",
    instructor: "Emma",
    audio_file: "meditation_gratitude",
    image: "meditation_golden_light",
    isFree: true,
    tags: ["gratitude", "appreciation", "blessings", "mindful"],
  },
  {
    title: "Thankful Heart",
    description:
      "Connect with feelings of genuine thankfulness. Let appreciation fill every breath.",
    category: "gratitude",
    duration_minutes: 10,
    difficulty_level: "beginner",
    instructor: "Sarah",
    audio_file: "meditation_gratitude",
    image: "meditation_flower_bloom",
    isFree: true,
    tags: ["thankful", "heart", "appreciation", "warmth"],
  },
  {
    title: "Evening Gratitude",
    description:
      "Reflect on the gifts of your day. End each evening with a grateful heart.",
    category: "gratitude",
    duration_minutes: 10,
    difficulty_level: "beginner",
    instructor: "Michael",
    audio_file: "meditation_gratitude",
    image: "meditation_sunset_glow",
    isFree: true,
    tags: ["evening", "reflection", "gratitude", "peace"],
  },
  {
    title: "Abundance Meditation",
    description:
      "Shift your perspective to see the abundance in your life. Cultivate a mindset of plenty.",
    category: "gratitude",
    duration_minutes: 15,
    difficulty_level: "intermediate",
    instructor: "Emma",
    audio_file: "meditation_gratitude",
    image: "meditation_abundance",
    isFree: false,
    tags: ["abundance", "prosperity", "mindset", "positive"],
  },

  // ===== STRESS (5) =====
  {
    title: "Stress Relief",
    description:
      "Release tension and find your center. A soothing practice to help you let go of stress and anxiety.",
    category: "stress",
    duration_minutes: 10,
    difficulty_level: "beginner",
    instructor: "Sarah",
    audio_file: "meditation_stress",
    image: "meditation_calm_water",
    isFree: true,
    tags: ["stress", "relaxation", "calm", "relief"],
  },
  {
    title: "Tension Release",
    description:
      "Systematically release physical and mental tension. Feel the stress melt away.",
    category: "stress",
    duration_minutes: 15,
    difficulty_level: "beginner",
    instructor: "Michael",
    audio_file: "meditation_stress",
    image: "meditation_zen_stones",
    isFree: true,
    tags: ["tension", "release", "body", "relaxation"],
  },
  {
    title: "Calm in Chaos",
    description:
      "Find your peaceful center even when life feels overwhelming. Your sanctuary is within.",
    category: "stress",
    duration_minutes: 10,
    difficulty_level: "intermediate",
    instructor: "Sarah",
    audio_file: "meditation_stress",
    image: "meditation_peaceful_lake",
    isFree: true,
    tags: ["chaos", "calm", "center", "peace"],
  },
  {
    title: "Workplace Stress",
    description:
      "Quick reset for work-related tension. Perfect for a lunch break or after meetings.",
    category: "stress",
    duration_minutes: 8,
    difficulty_level: "beginner",
    instructor: "James",
    audio_file: "meditation_stress",
    image: "meditation_soft_clouds",
    isFree: true,
    tags: ["work", "office", "quick", "reset"],
  },
  {
    title: "Deep Relaxation",
    description:
      "Journey into profound relaxation. Let every muscle soften and every thought quiet.",
    category: "stress",
    duration_minutes: 20,
    difficulty_level: "intermediate",
    instructor: "Emma",
    audio_file: "meditation_stress",
    image: "meditation_deep_relax",
    isFree: false,
    tags: ["deep", "relaxation", "calm", "peaceful"],
  },

  // ===== FOCUS (5) =====
  {
    title: "Deep Focus",
    description:
      "Sharpen your concentration and boost productivity. Perfect before important work or study sessions.",
    category: "focus",
    duration_minutes: 10,
    difficulty_level: "intermediate",
    instructor: "Michael",
    audio_file: "meditation_focus",
    image: "meditation_sharp_mountain",
    isFree: true,
    tags: ["focus", "concentration", "productivity", "clarity"],
  },
  {
    title: "Laser Focus",
    description:
      "Train your mind to stay on target. Develop unwavering concentration.",
    category: "focus",
    duration_minutes: 15,
    difficulty_level: "intermediate",
    instructor: "James",
    audio_file: "meditation_focus",
    image: "meditation_clear_sky",
    isFree: true,
    tags: ["laser", "concentration", "training", "mind"],
  },
  {
    title: "Morning Clarity",
    description:
      "Start your day with a clear, focused mind. Set the tone for productive hours ahead.",
    category: "focus",
    duration_minutes: 10,
    difficulty_level: "beginner",
    instructor: "Sarah",
    audio_file: "meditation_calm",
    image: "meditation_morning_dew",
    isFree: true,
    tags: ["morning", "clarity", "productive", "fresh"],
  },
  {
    title: "Study Session",
    description:
      "Prepare your mind for learning and retention. Optimal focus for students.",
    category: "focus",
    duration_minutes: 8,
    difficulty_level: "beginner",
    instructor: "Michael",
    audio_file: "meditation_focus",
    image: "meditation_study_focus",
    isFree: true,
    tags: ["study", "learning", "students", "memory"],
  },
  {
    title: "Creative Flow",
    description:
      "Enter a state of creative focus. Let ideas flow freely while maintaining direction.",
    category: "focus",
    duration_minutes: 15,
    difficulty_level: "intermediate",
    instructor: "Emma",
    audio_file: "meditation_calm",
    image: "meditation_creative_flow",
    isFree: false,
    tags: ["creative", "flow", "ideas", "inspiration"],
  },

  // ===== ANXIETY (5) =====
  {
    title: "Anxiety Ease",
    description:
      "Calm racing thoughts and find stillness. Gentle guidance to help you navigate anxious moments.",
    category: "anxiety",
    duration_minutes: 10,
    difficulty_level: "beginner",
    instructor: "Sarah",
    audio_file: "meditation_anxiety",
    image: "meditation_safe_harbor",
    isFree: true,
    tags: ["anxiety", "calm", "peace", "grounding"],
  },
  {
    title: "Panic Relief",
    description:
      "Emergency support for overwhelming moments. Ground yourself and find stability.",
    category: "anxiety",
    duration_minutes: 5,
    difficulty_level: "beginner",
    instructor: "Emma",
    audio_file: "meditation_anxiety",
    image: "meditation_grounding",
    isFree: true,
    tags: ["panic", "emergency", "grounding", "support"],
  },
  {
    title: "Worry Release",
    description:
      "Let go of worries about the future. Return to the safety of the present moment.",
    category: "anxiety",
    duration_minutes: 12,
    difficulty_level: "beginner",
    instructor: "Sarah",
    audio_file: "meditation_anxiety",
    image: "meditation_gentle_waves",
    isFree: true,
    tags: ["worry", "future", "present", "release"],
  },
  {
    title: "Social Calm",
    description:
      "Prepare for social situations with confidence. Ease social anxiety naturally.",
    category: "anxiety",
    duration_minutes: 10,
    difficulty_level: "intermediate",
    instructor: "Michael",
    audio_file: "meditation_anxiety",
    image: "meditation_calm_presence",
    isFree: true,
    tags: ["social", "confidence", "calm", "preparation"],
  },
  {
    title: "Anxious Thoughts",
    description:
      "Learn to observe anxious thoughts without being controlled by them. Find freedom.",
    category: "anxiety",
    duration_minutes: 15,
    difficulty_level: "intermediate",
    instructor: "Emma",
    audio_file: "meditation_anxiety",
    image: "meditation_inner_peace",
    isFree: false,
    tags: ["thoughts", "observation", "freedom", "mindful"],
  },

  // ===== SLEEP (5) =====
  {
    title: "Evening Wind Down",
    description:
      "Prepare your mind for restful sleep. Let go of the day and ease into peaceful relaxation.",
    category: "sleep",
    duration_minutes: 10,
    difficulty_level: "beginner",
    instructor: "Michael",
    audio_file: "meditation_sleep",
    image: "meditation_night_sky",
    isFree: true,
    tags: ["evening", "sleep", "relaxation", "wind-down"],
  },
  {
    title: "Deep Sleep",
    description:
      "Drift into restorative, deep sleep. Wake refreshed and renewed.",
    category: "sleep",
    duration_minutes: 20,
    difficulty_level: "beginner",
    instructor: "Emma",
    audio_file: "meditation_sleep",
    image: "meditation_moonlit",
    isFree: true,
    tags: ["deep", "sleep", "restorative", "rest"],
  },
  {
    title: "Insomnia Relief",
    description:
      "Gentle support for sleepless nights. Quiet the mind and invite rest.",
    category: "sleep",
    duration_minutes: 25,
    difficulty_level: "beginner",
    instructor: "Sarah",
    audio_file: "meditation_sleep",
    image: "meditation_twilight",
    isFree: true,
    tags: ["insomnia", "sleepless", "relief", "rest"],
  },
  {
    title: "Bedtime Reset",
    description:
      "Release the day completely. Transition from wakefulness to peaceful slumber.",
    category: "sleep",
    duration_minutes: 15,
    difficulty_level: "beginner",
    instructor: "James",
    audio_file: "meditation_sleep",
    image: "meditation_cozy_rest",
    isFree: true,
    tags: ["bedtime", "reset", "transition", "peaceful"],
  },
  {
    title: "Dream Journey",
    description:
      "Visualization to guide you into pleasant dreams. Sleep with a smile.",
    category: "sleep",
    duration_minutes: 20,
    difficulty_level: "intermediate",
    instructor: "Emma",
    audio_file: "meditation_sleep",
    image: "meditation_dream",
    isFree: false,
    tags: ["dreams", "visualization", "pleasant", "journey"],
  },

  // ===== BODY-SCAN (5) =====
  {
    title: "Body Scan",
    description:
      "Connect with your body through mindful awareness. Systematically release tension from head to toe.",
    category: "body-scan",
    duration_minutes: 10,
    difficulty_level: "beginner",
    instructor: "Michael",
    audio_file: "meditation_bodyscan",
    image: "meditation_body_awareness",
    isFree: true,
    tags: ["body", "awareness", "relaxation", "tension"],
  },
  {
    title: "Full Body Relaxation",
    description:
      "Complete body scan for total relaxation. Feel every muscle let go.",
    category: "body-scan",
    duration_minutes: 20,
    difficulty_level: "beginner",
    instructor: "Emma",
    audio_file: "meditation_bodyscan",
    image: "meditation_relaxed_body",
    isFree: true,
    tags: ["full", "body", "relaxation", "complete"],
  },
  {
    title: "Quick Body Check",
    description: "Brief body awareness practice. Perfect for busy days.",
    category: "body-scan",
    duration_minutes: 5,
    difficulty_level: "beginner",
    instructor: "Sarah",
    audio_file: "meditation_bodyscan",
    image: "meditation_quick_scan",
    isFree: true,
    tags: ["quick", "check", "busy", "awareness"],
  },
  {
    title: "Pain Relief Scan",
    description:
      "Gentle awareness for areas of discomfort. Breathe ease into tension.",
    category: "body-scan",
    duration_minutes: 15,
    difficulty_level: "intermediate",
    instructor: "Michael",
    audio_file: "meditation_bodyscan",
    image: "meditation_healing",
    isFree: true,
    tags: ["pain", "relief", "discomfort", "healing"],
  },
  {
    title: "Athletic Recovery",
    description:
      "Body scan designed for post-workout recovery. Help muscles restore and heal.",
    category: "body-scan",
    duration_minutes: 15,
    difficulty_level: "intermediate",
    instructor: "James",
    audio_file: "meditation_bodyscan",
    image: "meditation_recovery",
    isFree: false,
    tags: ["athletic", "recovery", "muscles", "healing"],
  },

  // ===== SELF-ESTEEM (5) =====
  {
    title: "Self Compassion",
    description:
      "Cultivate kindness toward yourself. Learn to embrace your imperfections with love and understanding.",
    category: "self-esteem",
    duration_minutes: 10,
    difficulty_level: "intermediate",
    instructor: "Sarah",
    audio_file: "meditation_selfesteem",
    image: "meditation_self_love",
    isFree: true,
    tags: ["self-love", "compassion", "kindness", "acceptance"],
  },
  {
    title: "Inner Confidence",
    description:
      "Build unshakeable self-belief from within. You are worthy and capable.",
    category: "self-esteem",
    duration_minutes: 12,
    difficulty_level: "intermediate",
    instructor: "Emma",
    audio_file: "meditation_selfesteem",
    image: "meditation_confidence",
    isFree: true,
    tags: ["confidence", "belief", "worthy", "capable"],
  },
  {
    title: "Self-Worth",
    description:
      "Reconnect with your inherent value. You deserve love and respect.",
    category: "self-esteem",
    duration_minutes: 15,
    difficulty_level: "intermediate",
    instructor: "Sarah",
    audio_file: "meditation_selfesteem",
    image: "meditation_worthy",
    isFree: true,
    tags: ["worth", "value", "love", "respect"],
  },
  {
    title: "Healing Inner Child",
    description:
      "Nurture the child within you. Offer comfort to past hurts with present kindness.",
    category: "self-esteem",
    duration_minutes: 20,
    difficulty_level: "advanced",
    instructor: "Emma",
    audio_file: "meditation_selfesteem",
    image: "meditation_inner_child",
    isFree: false,
    tags: ["inner-child", "healing", "nurture", "comfort"],
  },
  {
    title: "Positive Self-Talk",
    description:
      "Transform your inner dialogue. Replace criticism with encouragement.",
    category: "self-esteem",
    duration_minutes: 10,
    difficulty_level: "beginner",
    instructor: "Michael",
    audio_file: "meditation_selfesteem",
    image: "meditation_positive",
    isFree: true,
    tags: ["positive", "self-talk", "dialogue", "encouragement"],
  },

  // ===== LOVING-KINDNESS (5) =====
  {
    title: "Loving Kindness",
    description:
      "Open your heart with metta meditation. Send love and compassion to yourself and others.",
    category: "loving-kindness",
    duration_minutes: 10,
    difficulty_level: "intermediate",
    instructor: "Sarah",
    audio_file: "meditation_lovingkindness",
    image: "meditation_heart_open",
    isFree: true,
    tags: ["love", "kindness", "compassion", "metta"],
  },
  {
    title: "Heart Opening",
    description:
      "Expand your capacity for love. Feel your heart soften and open.",
    category: "loving-kindness",
    duration_minutes: 15,
    difficulty_level: "intermediate",
    instructor: "Emma",
    audio_file: "meditation_lovingkindness",
    image: "meditation_metta",
    isFree: true,
    tags: ["heart", "opening", "love", "expand"],
  },
  {
    title: "Forgiveness Practice",
    description:
      "Release resentment and find peace. Forgiveness is freedom for yourself.",
    category: "loving-kindness",
    duration_minutes: 15,
    difficulty_level: "advanced",
    instructor: "Sarah",
    audio_file: "meditation_lovingkindness",
    image: "meditation_forgiveness",
    isFree: true,
    tags: ["forgiveness", "release", "peace", "freedom"],
  },
  {
    title: "Compassion for Others",
    description:
      "Extend loving-kindness to all beings. Connect with our shared humanity.",
    category: "loving-kindness",
    duration_minutes: 12,
    difficulty_level: "intermediate",
    instructor: "Michael",
    audio_file: "meditation_lovingkindness",
    image: "meditation_compassion",
    isFree: true,
    tags: ["compassion", "others", "humanity", "connection"],
  },
  {
    title: "Universal Love",
    description:
      "Experience boundless love for all existence. Dissolve the boundaries between self and other.",
    category: "loving-kindness",
    duration_minutes: 20,
    difficulty_level: "advanced",
    instructor: "Emma",
    audio_file: "meditation_lovingkindness",
    image: "meditation_universal_love",
    isFree: false,
    tags: ["universal", "boundless", "existence", "oneness"],
  },
];

// ==================== BREATHING EXERCISES (20 entries) ====================

export interface SeedBreathingExercise {
  title: string;
  description: string;
  duration_minutes: number;
  pattern: string;
  inhale_seconds: number;
  hold_seconds: number;
  exhale_seconds: number;
  hold_after_exhale_seconds: number;
  audio_file: string;
  image: string;
  benefits: string[];
}

export const seedBreathingExercises: SeedBreathingExercise[] = [
  // Original 4
  {
    title: "Box Breathing",
    description:
      "A powerful technique used by Navy SEALs to stay calm under pressure. Equal counts for inhale, hold, exhale, and hold.",
    duration_minutes: 5,
    pattern: "4-4-4-4",
    inhale_seconds: 4,
    hold_seconds: 4,
    exhale_seconds: 4,
    hold_after_exhale_seconds: 4,
    audio_file: "breathing_calm",
    image: "breathing_box",
    benefits: ["Reduces stress", "Improves focus", "Calms nervous system"],
  },
  {
    title: "4-7-8 Relaxation",
    description:
      "Dr. Andrew Weil's natural tranquilizer for the nervous system. Perfect for falling asleep.",
    duration_minutes: 5,
    pattern: "4-7-8",
    inhale_seconds: 4,
    hold_seconds: 7,
    exhale_seconds: 8,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_calm",
    image: "breathing_478",
    benefits: ["Promotes sleep", "Reduces anxiety", "Slows heart rate"],
  },
  {
    title: "Deep Belly Breath",
    description:
      "Activate your diaphragm for deep, restorative breathing. Great for stress relief and relaxation.",
    duration_minutes: 5,
    pattern: "6-2-7",
    inhale_seconds: 6,
    hold_seconds: 2,
    exhale_seconds: 7,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_calm",
    image: "breathing_belly",
    benefits: [
      "Activates parasympathetic",
      "Reduces tension",
      "Improves oxygen flow",
    ],
  },
  {
    title: "Energizing Breath",
    description:
      "Quick breathing to boost energy and alertness. Perfect for an afternoon pick-me-up.",
    duration_minutes: 3,
    pattern: "3-3-3",
    inhale_seconds: 3,
    hold_seconds: 3,
    exhale_seconds: 3,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_energy",
    image: "breathing_energy",
    benefits: ["Increases energy", "Improves alertness", "Clears mind"],
  },
  // 16 more
  {
    title: "Calming Breath",
    description:
      "Longer exhales activate your relaxation response. Simple and effective.",
    duration_minutes: 5,
    pattern: "4-0-6",
    inhale_seconds: 4,
    hold_seconds: 0,
    exhale_seconds: 6,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_calm",
    image: "breathing_calm",
    benefits: ["Calms nerves", "Easy to learn", "Instant relaxation"],
  },
  {
    title: "Alternate Nostril",
    description:
      "Balance left and right brain hemispheres. A yogic practice for harmony.",
    duration_minutes: 7,
    pattern: "4-4-4",
    inhale_seconds: 4,
    hold_seconds: 4,
    exhale_seconds: 4,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_calm",
    image: "breathing_alternate",
    benefits: ["Balances energy", "Clears mind", "Reduces anxiety"],
  },
  {
    title: "Ocean Breath",
    description:
      "Ujjayi breathing creates a soothing ocean sound. Build internal heat and focus.",
    duration_minutes: 8,
    pattern: "5-0-5",
    inhale_seconds: 5,
    hold_seconds: 0,
    exhale_seconds: 5,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_calm",
    image: "breathing_ocean",
    benefits: ["Builds focus", "Creates warmth", "Meditative"],
  },
  {
    title: "Morning Wake-Up",
    description:
      "Invigorating breath to start your day with energy and clarity.",
    duration_minutes: 4,
    pattern: "4-2-4",
    inhale_seconds: 4,
    hold_seconds: 2,
    exhale_seconds: 4,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_energy",
    image: "breathing_morning",
    benefits: ["Increases alertness", "Oxygenates blood", "Energizes"],
  },
  {
    title: "Stress SOS",
    description:
      "Emergency breathing for acute stress moments. Quick relief when you need it most.",
    duration_minutes: 3,
    pattern: "3-3-6",
    inhale_seconds: 3,
    hold_seconds: 3,
    exhale_seconds: 6,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_calm",
    image: "breathing_sos",
    benefits: ["Immediate calm", "Stops panic", "Portable technique"],
  },
  {
    title: "Focus Breath",
    description:
      "Prepare your mind for concentrated work. Build sustained attention.",
    duration_minutes: 5,
    pattern: "4-4-4",
    inhale_seconds: 4,
    hold_seconds: 4,
    exhale_seconds: 4,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_energy",
    image: "breathing_focus",
    benefits: ["Enhances focus", "Clears distractions", "Prepares mind"],
  },
  {
    title: "Sleep Prep",
    description: "Slow, deep breathing to prepare body and mind for sleep.",
    duration_minutes: 6,
    pattern: "4-7-8",
    inhale_seconds: 4,
    hold_seconds: 7,
    exhale_seconds: 8,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_calm",
    image: "breathing_sleep",
    benefits: ["Induces drowsiness", "Quiets mind", "Relaxes body"],
  },
  {
    title: "Anxiety Relief",
    description: "Extended exhale breathing specifically for anxious moments.",
    duration_minutes: 5,
    pattern: "4-0-8",
    inhale_seconds: 4,
    hold_seconds: 0,
    exhale_seconds: 8,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_calm",
    image: "breathing_anxiety",
    benefits: ["Reduces anxiety", "Slows heart rate", "Calms mind"],
  },
  {
    title: "Power Breath",
    description:
      "Short, powerful breaths to increase energy and mental clarity.",
    duration_minutes: 3,
    pattern: "2-0-2",
    inhale_seconds: 2,
    hold_seconds: 0,
    exhale_seconds: 2,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_energy",
    image: "breathing_power",
    benefits: ["Quick energy boost", "Sharpens mind", "Increases oxygen"],
  },
  {
    title: "Mindful Breathing",
    description:
      "Simple awareness of natural breath. The foundation of meditation.",
    duration_minutes: 10,
    pattern: "natural",
    inhale_seconds: 0,
    hold_seconds: 0,
    exhale_seconds: 0,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_calm",
    image: "breathing_mindful",
    benefits: ["Develops awareness", "Calms mind", "Present moment focus"],
  },
  {
    title: "Coherent Breathing",
    description: "Five breaths per minute for optimal heart-brain coherence.",
    duration_minutes: 5,
    pattern: "6-0-6",
    inhale_seconds: 6,
    hold_seconds: 0,
    exhale_seconds: 6,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_calm",
    image: "breathing_coherent",
    benefits: ["Heart coherence", "Reduces stress", "Balances emotions"],
  },
  {
    title: "Cooling Breath",
    description:
      "Sitali pranayama to cool body and mind. Perfect for hot days or anger.",
    duration_minutes: 5,
    pattern: "4-0-4",
    inhale_seconds: 4,
    hold_seconds: 0,
    exhale_seconds: 4,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_calm",
    image: "breathing_cooling",
    benefits: ["Cools body", "Reduces anger", "Calms mind"],
  },
  {
    title: "Grounding Breath",
    description:
      "Connect with the earth through breath. Feel stable and secure.",
    duration_minutes: 5,
    pattern: "5-3-5",
    inhale_seconds: 5,
    hold_seconds: 3,
    exhale_seconds: 5,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_calm",
    image: "breathing_grounding",
    benefits: ["Grounding", "Stability", "Security"],
  },
  {
    title: "Heart Breath",
    description:
      "Breathe into and from your heart center. Open to love and compassion.",
    duration_minutes: 7,
    pattern: "5-2-5",
    inhale_seconds: 5,
    hold_seconds: 2,
    exhale_seconds: 5,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_calm",
    image: "breathing_heart",
    benefits: ["Opens heart", "Cultivates love", "Emotional healing"],
  },
  {
    title: "Counting Breath",
    description:
      "Count your breaths to anchor attention. Simple focus training.",
    duration_minutes: 5,
    pattern: "4-0-4",
    inhale_seconds: 4,
    hold_seconds: 0,
    exhale_seconds: 4,
    hold_after_exhale_seconds: 0,
    audio_file: "breathing_energy",
    image: "breathing_counting",
    benefits: ["Builds focus", "Simple technique", "Anchors attention"],
  },
  {
    title: "Victory Breath",
    description:
      "Build confidence and inner strength through powerful breathing.",
    duration_minutes: 5,
    pattern: "4-4-4-4",
    inhale_seconds: 4,
    hold_seconds: 4,
    exhale_seconds: 4,
    hold_after_exhale_seconds: 4,
    audio_file: "breathing_energy",
    image: "breathing_victory",
    benefits: ["Builds confidence", "Inner strength", "Empowering"],
  },
];

// ==================== BEDTIME STORIES ====================

export interface SeedBedtimeStory {
  title: string;
  description: string;
  duration_minutes: number;
  category: "nature" | "fantasy" | "travel" | "fiction" | "thriller" | "fairytale";
  narrator: string;
  audio_file: string;
  image: string;
  isFree: boolean;
}

export const seedBedtimeStories: SeedBedtimeStory[] = [
  {
    title: "The Shoemaker and the Elves",
    description:
      "A classic fairy tale about a kind shoemaker who receives magical help from tiny elves. Let this gentle story carry you off to dreamland.",
    duration_minutes: 19,
    category: "fairytale",
    narrator: "Nolan",
    audio_file: "story_shoemaker_elves",
    image: "story_fairytale_shoemaker",
    isFree: true,
  },
];

// ==================== DAILY QUOTES (35 entries) ====================

export interface SeedQuote {
  text: string;
  author: string;
  category: string;
}

export const seedQuotes: SeedQuote[] = [
  // Original 7
  {
    text: "Take a breath. You're exactly where you need to be.",
    author: "Calmdemy",
    category: "mindfulness",
  },
  {
    text: "Peace comes from within. Do not seek it without.",
    author: "Buddha",
    category: "peace",
  },
  {
    text: "The present moment is filled with joy and happiness. If you are attentive, you will see it.",
    author: "Thich Nhat Hanh",
    category: "presence",
  },
  {
    text: "Almost everything will work again if you unplug it for a few minutes, including you.",
    author: "Anne Lamott",
    category: "rest",
  },
  {
    text: "Feelings come and go like clouds in a windy sky. Conscious breathing is my anchor.",
    author: "Thich Nhat Hanh",
    category: "breathing",
  },
  {
    text: "You are the sky. Everything else is just the weather.",
    author: "Pema Chödrön",
    category: "perspective",
  },
  {
    text: "In the midst of movement and chaos, keep stillness inside of you.",
    author: "Deepak Chopra",
    category: "stillness",
  },
  // 28 more
  {
    text: "The quieter you become, the more you can hear.",
    author: "Ram Dass",
    category: "silence",
  },
  {
    text: "Smile, breathe, and go slowly.",
    author: "Thich Nhat Hanh",
    category: "mindfulness",
  },
  {
    text: "Within you, there is a stillness and a sanctuary to which you can retreat at any time.",
    author: "Hermann Hesse",
    category: "peace",
  },
  {
    text: "The mind is everything. What you think you become.",
    author: "Buddha",
    category: "mind",
  },
  {
    text: "Be where you are, not where you think you should be.",
    author: "Unknown",
    category: "presence",
  },
  {
    text: "Breathe in calm, breathe out chaos.",
    author: "Calmdemy",
    category: "breathing",
  },
  {
    text: "Rest when you need to. The world can wait.",
    author: "Calmdemy",
    category: "rest",
  },
  {
    text: "Every moment is a fresh beginning.",
    author: "T.S. Eliot",
    category: "new beginnings",
  },
  {
    text: "The greatest weapon against stress is our ability to choose one thought over another.",
    author: "William James",
    category: "stress",
  },
  {
    text: "Nature does not hurry, yet everything is accomplished.",
    author: "Lao Tzu",
    category: "patience",
  },
  {
    text: "Surrender to what is. Let go of what was. Have faith in what will be.",
    author: "Sonia Ricotti",
    category: "acceptance",
  },
  {
    text: "The only way to live is by accepting each minute as an unrepeatable miracle.",
    author: "Tara Brach",
    category: "presence",
  },
  {
    text: "Your calm mind is the ultimate weapon against your challenges.",
    author: "Bryant McGill",
    category: "calm",
  },
  {
    text: "Do not let the behavior of others destroy your inner peace.",
    author: "Dalai Lama",
    category: "peace",
  },
  {
    text: "Between stimulus and response there is a space. In that space is our power to choose our response.",
    author: "Viktor Frankl",
    category: "choice",
  },
  {
    text: "Happiness is not something ready-made. It comes from your own actions.",
    author: "Dalai Lama",
    category: "happiness",
  },
  {
    text: "The present moment is the only moment available to us, and it is the door to all moments.",
    author: "Thich Nhat Hanh",
    category: "presence",
  },
  {
    text: "Let go of the thoughts that don't make you strong.",
    author: "Karen Salmansohn",
    category: "letting go",
  },
  {
    text: "You don't have to control your thoughts. You just have to stop letting them control you.",
    author: "Dan Millman",
    category: "thoughts",
  },
  {
    text: "Be patient with yourself. Self-growth is tender.",
    author: "Calmdemy",
    category: "self-compassion",
  },
  {
    text: "The best time to relax is when you don't have time for it.",
    author: "Sydney J. Harris",
    category: "rest",
  },
  {
    text: "Inhale the future, exhale the past.",
    author: "Unknown",
    category: "breathing",
  },
  {
    text: "Your mind is a garden, your thoughts are the seeds. You can grow flowers or you can grow weeds.",
    author: "Unknown",
    category: "mind",
  },
  {
    text: "Slow down. Calm down. Don't worry. Don't hurry. Trust the process.",
    author: "Alexandra Stoddard",
    category: "trust",
  },
  {
    text: "Nothing can bring you peace but yourself.",
    author: "Ralph Waldo Emerson",
    category: "peace",
  },
  {
    text: "The only Zen you find on the tops of mountains is the Zen you bring up there.",
    author: "Robert M. Pirsig",
    category: "mindfulness",
  },
  {
    text: "Life is available only in the present moment.",
    author: "Thich Nhat Hanh",
    category: "presence",
  },
  {
    text: "Set peace of mind as your highest goal, and organize your life around it.",
    author: "Brian Tracy",
    category: "peace",
  },
  {
    text: "Yesterday is gone. Tomorrow has not yet come. We have only today. Let us begin.",
    author: "Mother Teresa",
    category: "presence",
  },
  {
    text: "Wherever you are, be there totally.",
    author: "Eckhart Tolle",
    category: "presence",
  },
  {
    text: "Each morning we are born again. What we do today matters most.",
    author: "Buddha",
    category: "new beginnings",
  },
  {
    text: "You cannot always control what goes on outside. But you can always control what goes on inside.",
    author: "Wayne Dyer",
    category: "control",
  },
  {
    text: "The mind is like water. When it's turbulent, it's difficult to see. When it's calm, everything becomes clear.",
    author: "Prasad Mahes",
    category: "clarity",
  },
];

// ==================== MEDITATION PROGRAMS (10 entries) ====================

export interface SeedProgram {
  title: string;
  description: string;
  duration_days: number;
  difficulty_level: "beginner" | "intermediate" | "advanced";
  category: string;
  image: string;
  is_active: boolean;
}

export const seedPrograms: SeedProgram[] = [
  // Original 3
  {
    title: "Meditation Basics",
    description:
      "A 7-day introduction to meditation. Learn foundational techniques and build a daily practice.",
    duration_days: 7,
    difficulty_level: "beginner",
    category: "basics",
    image: "program_basics",
    is_active: true,
  },
  {
    title: "Stress Less",
    description:
      "A 14-day journey to reduce stress and anxiety. Practical tools for everyday calm.",
    duration_days: 14,
    difficulty_level: "beginner",
    category: "stress",
    image: "program_stress",
    is_active: true,
  },
  {
    title: "Better Sleep",
    description:
      "A 7-day program to improve your sleep quality. Evening routines and relaxation techniques.",
    duration_days: 7,
    difficulty_level: "beginner",
    category: "sleep",
    image: "program_sleep",
    is_active: true,
  },
  // 7 more
  {
    title: "Anxiety Relief",
    description:
      "A 21-day program to understand and manage anxiety. Build long-term resilience.",
    duration_days: 21,
    difficulty_level: "intermediate",
    category: "anxiety",
    image: "program_anxiety",
    is_active: true,
  },
  {
    title: "Focus Mastery",
    description:
      "A 14-day intensive to sharpen concentration. Train your mind for laser focus.",
    duration_days: 14,
    difficulty_level: "intermediate",
    category: "focus",
    image: "program_focus",
    is_active: true,
  },
  {
    title: "Self-Compassion Journey",
    description:
      "A 30-day path to loving yourself. Heal inner wounds and embrace who you are.",
    duration_days: 30,
    difficulty_level: "intermediate",
    category: "self-esteem",
    image: "program_self_compassion",
    is_active: true,
  },
  {
    title: "Morning Routine",
    description:
      "A 7-day program to create the perfect morning meditation practice.",
    duration_days: 7,
    difficulty_level: "beginner",
    category: "morning",
    image: "program_morning",
    is_active: true,
  },
  {
    title: "Breathing Fundamentals",
    description:
      "A 10-day exploration of breathing techniques. Master your breath, master your mind.",
    duration_days: 10,
    difficulty_level: "beginner",
    category: "breathing",
    image: "program_breathing",
    is_active: true,
  },
  {
    title: "Mindful Living",
    description:
      "A 21-day program to bring mindfulness into every aspect of daily life.",
    duration_days: 21,
    difficulty_level: "intermediate",
    category: "mindfulness",
    image: "program_mindful",
    is_active: true,
  },
  {
    title: "Advanced Meditation",
    description:
      "A 30-day deep dive for experienced practitioners. Explore advanced techniques.",
    duration_days: 30,
    difficulty_level: "advanced",
    category: "advanced",
    image: "program_advanced",
    is_active: true,
  },
];
