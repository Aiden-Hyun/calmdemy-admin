import { DropdownOption } from '../components/Dropdown';
import { FactoryContentType } from '../types';

/**
 * When the "Random" option is selected, this label is passed as the field
 * value so the LLM prompt receives it as-is and picks freely.
 */
export const RANDOM_LABEL = 'Surprise me — choose freely';

const RANDOM_OPTION: DropdownOption = { id: '__random__', label: RANDOM_LABEL };

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const GUIDED_MEDITATION_STYLES: DropdownOption[] = [
  RANDOM_OPTION,
  { id: 'gentle', label: 'Gentle & Nurturing' },
  { id: 'grounded', label: 'Warm & Grounded' },
  { id: 'spacious', label: 'Minimal & Spacious' },
  { id: 'conversational', label: 'Friendly & Conversational' },
  { id: 'poetic', label: 'Poetic & Lyrical' },
  { id: 'earthy', label: 'Earthy & Natural' },
  { id: 'compassionate', label: 'Deeply Compassionate' },
  { id: 'playful', label: 'Light & Playful' },
];

const SLEEP_MEDITATION_STYLES: DropdownOption[] = [
  RANDOM_OPTION,
  { id: 'drowsy', label: 'Soft & Drowsy' },
  { id: 'hypnotic', label: 'Warm & Hypnotic' },
  { id: 'whisper', label: 'Whisper-Quiet' },
  { id: 'repetitive', label: 'Slow & Repetitive' },
  { id: 'lullaby', label: 'Lullaby-Like' },
  { id: 'ambient', label: 'Ambient & Minimal' },
  { id: 'cocooning', label: 'Cocooning & Protective' },
];

const BEDTIME_STORY_STYLES: DropdownOption[] = [
  RANDOM_OPTION,
  { id: 'whimsical', label: 'Whimsical & Playful' },
  { id: 'fairy_tale', label: 'Classic Fairy Tale' },
  { id: 'nature', label: 'Nature Journey' },
  { id: 'adventure', label: 'Gentle Adventure' },
  { id: 'dreamy', label: 'Dreamy & Abstract' },
  { id: 'folklore', label: 'Folk Tale' },
  { id: 'cozy_slice', label: 'Cozy Slice of Life' },
  { id: 'mythical', label: 'Mythical & Legendary' },
  { id: 'seasonal', label: 'Seasonal & Holiday' },
];

const EMERGENCY_MEDITATION_STYLES: DropdownOption[] = [
  RANDOM_OPTION,
  { id: 'direct', label: 'Steady & Direct' },
  { id: 'reassuring', label: 'Warm & Reassuring' },
  { id: 'confident', label: 'Calm & Confident' },
  { id: 'companionable', label: 'Companionable & Gentle' },
  { id: 'grounding', label: 'Grounding & Practical' },
];

const STYLES_BY_TYPE: Partial<Record<FactoryContentType, DropdownOption[]>> = {
  guided_meditation: GUIDED_MEDITATION_STYLES,
  sleep_meditation: SLEEP_MEDITATION_STYLES,
  bedtime_story: BEDTIME_STORY_STYLES,
  emergency_meditation: EMERGENCY_MEDITATION_STYLES,
};

// ---------------------------------------------------------------------------
// Techniques (bedtime stories use "Setting" instead)
// ---------------------------------------------------------------------------

const GUIDED_MEDITATION_TECHNIQUES: DropdownOption[] = [
  RANDOM_OPTION,
  { id: 'body_scan', label: 'Body Scan' },
  { id: 'breath_focus', label: 'Breath Focus' },
  { id: 'visualization', label: 'Visualization' },
  { id: 'loving_kindness', label: 'Loving-Kindness' },
  { id: 'grounding', label: 'Grounding' },
  { id: 'open_awareness', label: 'Open Awareness' },
  { id: 'progressive_muscle', label: 'Progressive Muscle Relaxation' },
  { id: 'mantra', label: 'Mantra / Affirmation' },
  { id: 'walking', label: 'Walking Meditation' },
  { id: 'compassion', label: 'Compassion Practice' },
  { id: 'noting', label: 'Noting / Labeling' },
  { id: 'gratitude_reflection', label: 'Gratitude Reflection' },
  { id: 'inner_smile', label: 'Inner Smile' },
  { id: 'chakra', label: 'Chakra Awareness' },
];

const SLEEP_MEDITATION_TECHNIQUES: DropdownOption[] = [
  RANDOM_OPTION,
  { id: 'body_scan', label: 'Body Scan' },
  { id: 'breath_counting', label: 'Breath Counting' },
  { id: 'progressive_relaxation', label: 'Progressive Relaxation' },
  { id: 'visualization', label: 'Visualization' },
  { id: 'yoga_nidra', label: 'Yoga Nidra' },
  { id: 'autogenic', label: 'Autogenic Training' },
  { id: 'heaviness_warmth', label: 'Heaviness & Warmth' },
  { id: 'counting_down', label: 'Countdown to Sleep' },
  { id: 'gratitude_review', label: 'Gratitude Review' },
  { id: 'cloud_drifting', label: 'Cloud Drifting' },
];

const BEDTIME_STORY_SETTINGS: DropdownOption[] = [
  RANDOM_OPTION,
  { id: 'forest', label: 'Forest' },
  { id: 'ocean', label: 'Ocean Shore' },
  { id: 'mountain', label: 'Mountain Meadow' },
  { id: 'garden', label: 'Garden' },
  { id: 'cabin', label: 'Cozy Cabin' },
  { id: 'burrow', label: 'Underground Burrow' },
  { id: 'sky', label: 'Sky & Clouds' },
  { id: 'village', label: 'Village' },
  { id: 'treehouse', label: 'Treehouse' },
  { id: 'lighthouse', label: 'Lighthouse' },
  { id: 'river', label: 'Quiet River' },
  { id: 'snowfield', label: 'Snowy Landscape' },
  { id: 'library', label: 'Old Library' },
  { id: 'bakery', label: 'Night Bakery' },
  { id: 'train', label: 'Sleepy Train Ride' },
  { id: 'desert_oasis', label: 'Desert Oasis' },
  { id: 'canopy', label: 'Rainforest Canopy' },
  { id: 'cottage', label: 'Seaside Cottage' },
  { id: 'cave', label: 'Crystal Cave' },
];

const EMERGENCY_MEDITATION_TECHNIQUES: DropdownOption[] = [
  RANDOM_OPTION,
  { id: 'box_breathing', label: 'Box Breathing' },
  { id: 'extended_exhale', label: 'Extended Exhale' },
  { id: 'five_senses', label: '5-4-3-2-1 Grounding' },
  { id: 'physical_grounding', label: 'Physical Grounding' },
  { id: 'tension_release', label: 'Progressive Tension Release' },
  { id: 'cold_exposure', label: 'Cold Water / Ice Cue' },
  { id: 'bilateral', label: 'Bilateral Tapping' },
  { id: 'safe_place', label: 'Safe Place Visualization' },
  { id: 'counting', label: 'Counting Anchor' },
];

const TECHNIQUES_BY_TYPE: Partial<Record<FactoryContentType, DropdownOption[]>> = {
  guided_meditation: GUIDED_MEDITATION_TECHNIQUES,
  sleep_meditation: SLEEP_MEDITATION_TECHNIQUES,
  bedtime_story: BEDTIME_STORY_SETTINGS,
  emergency_meditation: EMERGENCY_MEDITATION_TECHNIQUES,
};

// ---------------------------------------------------------------------------
// Topic suggestions
// ---------------------------------------------------------------------------

const GUIDED_MEDITATION_TOPICS: DropdownOption[] = [
  RANDOM_OPTION,
  { id: 'stress_relief', label: 'Stress Relief' },
  { id: 'anxiety', label: 'Anxiety' },
  { id: 'focus', label: 'Focus & Clarity' },
  { id: 'self_compassion', label: 'Self-Compassion' },
  { id: 'gratitude', label: 'Gratitude' },
  { id: 'morning_energy', label: 'Morning Energy' },
  { id: 'letting_go', label: 'Letting Go' },
  { id: 'emotional_balance', label: 'Emotional Balance' },
  { id: 'confidence', label: 'Confidence' },
  { id: 'patience', label: 'Patience' },
  { id: 'forgiveness', label: 'Forgiveness' },
  { id: 'inner_peace', label: 'Inner Peace' },
  { id: 'body_acceptance', label: 'Body Acceptance' },
  { id: 'grief', label: 'Processing Grief' },
  { id: 'burnout', label: 'Burnout Recovery' },
  { id: 'boundaries', label: 'Setting Boundaries' },
  { id: 'loneliness', label: 'Loneliness' },
  { id: 'change', label: 'Navigating Change' },
  { id: 'joy', label: 'Cultivating Joy' },
  { id: 'perfectionism', label: 'Releasing Perfectionism' },
  { id: 'decision_making', label: 'Decision Making' },
  { id: 'presence', label: 'Present Moment Awareness' },
  { id: 'self_worth', label: 'Self-Worth' },
  { id: 'creativity', label: 'Creative Inspiration' },
  { id: 'empathy', label: 'Empathy & Connection' },
];

const SLEEP_MEDITATION_TOPICS: DropdownOption[] = [
  RANDOM_OPTION,
  { id: 'deep_sleep', label: 'Deep Sleep' },
  { id: 'releasing_day', label: 'Releasing the Day' },
  { id: 'quiet_mind', label: 'Quiet Mind' },
  { id: 'body_relaxation', label: 'Body Relaxation' },
  { id: 'floating', label: 'Floating' },
  { id: 'nighttime_calm', label: 'Nighttime Calm' },
  { id: 'restful_stillness', label: 'Restful Stillness' },
  { id: 'ocean_waves', label: 'Ocean Waves' },
  { id: 'starlight', label: 'Starlight' },
  { id: 'warm_cocoon', label: 'Warm Cocoon' },
  { id: 'forest_at_night', label: 'Forest at Night' },
  { id: 'rainy_evening', label: 'Rainy Evening' },
  { id: 'letting_go_worry', label: 'Letting Go of Worry' },
  { id: 'melting_tension', label: 'Melting Away Tension' },
  { id: 'gentle_river', label: 'Gentle River' },
  { id: 'moonlight', label: 'Moonlight' },
  { id: 'cloud_bed', label: 'Sleeping on Clouds' },
  { id: 'gratitude_night', label: 'Nighttime Gratitude' },
];

const BEDTIME_STORY_TOPICS: DropdownOption[] = [
  RANDOM_OPTION,
  { id: 'sleepy_animals', label: 'Sleepy Animals' },
  { id: 'enchanted_forest', label: 'Enchanted Forest' },
  { id: 'moonlit_journey', label: 'Moonlit Journey' },
  { id: 'friendly_creatures', label: 'Friendly Creatures' },
  { id: 'magical_garden', label: 'Magical Garden' },
  { id: 'stargazing', label: 'Stargazing' },
  { id: 'rainy_night', label: 'Rainy Night' },
  { id: 'cozy_home', label: 'Cozy Home' },
  { id: 'winter_wonderland', label: 'Winter Wonderland' },
  { id: 'underwater', label: 'Underwater Adventure' },
  { id: 'cloud_kingdom', label: 'Cloud Kingdom' },
  { id: 'tiny_village', label: 'Tiny Village' },
  { id: 'old_lighthouse', label: 'The Old Lighthouse' },
  { id: 'bakers_night', label: "The Night Baker" },
  { id: 'train_journey', label: 'Sleepy Train Journey' },
  { id: 'spring_meadow', label: 'Spring Meadow' },
  { id: 'autumn_leaves', label: 'Autumn Leaves' },
  { id: 'desert_stars', label: 'Desert Under the Stars' },
  { id: 'snow_fox', label: 'The Snow Fox' },
  { id: 'firefly_forest', label: 'Firefly Forest' },
  { id: 'sandcastle', label: 'Sandcastle at Dusk' },
  { id: 'lantern_festival', label: 'Lantern Festival' },
  { id: 'sleeping_dragon', label: 'The Sleeping Dragon' },
  { id: 'harbor_boats', label: 'Boats in the Harbor' },
];

const EMERGENCY_MEDITATION_TOPICS: DropdownOption[] = [
  RANDOM_OPTION,
  { id: 'panic_response', label: 'Panic Response' },
  { id: 'acute_anxiety', label: 'Acute Anxiety' },
  { id: 'overwhelm', label: 'Overwhelm' },
  { id: 'anger', label: 'Anger' },
  { id: 'sensory_overload', label: 'Sensory Overload' },
  { id: 'racing_thoughts', label: 'Racing Thoughts' },
  { id: 'pre_event_nerves', label: 'Pre-Event Nerves' },
  { id: 'grief_wave', label: 'Grief Wave' },
  { id: 'insomnia_spiral', label: 'Insomnia Spiral' },
  { id: 'social_anxiety', label: 'Social Anxiety' },
  { id: 'frustration', label: 'Frustration' },
  { id: 'fear', label: 'Fear & Dread' },
  { id: 'emotional_flooding', label: 'Emotional Flooding' },
  { id: 'rumination', label: 'Rumination' },
  { id: 'post_conflict', label: 'After a Conflict' },
];

const TOPICS_BY_TYPE: Partial<Record<FactoryContentType, DropdownOption[]>> = {
  guided_meditation: GUIDED_MEDITATION_TOPICS,
  sleep_meditation: SLEEP_MEDITATION_TOPICS,
  bedtime_story: BEDTIME_STORY_TOPICS,
  emergency_meditation: EMERGENCY_MEDITATION_TOPICS,
};

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export function getStylesForContentType(ct: FactoryContentType): DropdownOption[] {
  return STYLES_BY_TYPE[ct] ?? [];
}

export function getTechniquesForContentType(ct: FactoryContentType): DropdownOption[] {
  return TECHNIQUES_BY_TYPE[ct] ?? [];
}

export function getTopicsForContentType(ct: FactoryContentType): DropdownOption[] {
  return TOPICS_BY_TYPE[ct] ?? [];
}

export function getTechniqueLabel(ct: FactoryContentType): string {
  return ct === 'bedtime_story' ? 'Setting' : 'Technique';
}
