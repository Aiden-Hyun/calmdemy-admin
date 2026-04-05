/**
 * Image file mapping for content thumbnails
 * 
 * Maps image identifiers (used in seed data) to remote URLs
 * These are high-quality, royalty-free images for meditation content.
 * 
 * Categories:
 * - Meditation: Calm nature, abstract gradients, zen imagery
 * - Breathing: Abstract patterns, sky, air themes
 * - Sleep: Night scenes, dreamy landscapes, cozy imagery
 * - Programs: Structured journey imagery
 */

// Using Unsplash for high-quality, free-to-use images
// Format: https://images.unsplash.com/photo-{id}?w=800&q=80

export const imageFiles: Record<string, string> = {
  // ==================== MEDITATION IMAGES ====================
  
  // Gratitude themed
  meditation_morning_sunrise: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=800&q=80',
  meditation_golden_light: 'https://images.unsplash.com/photo-1507400492013-162706c8c05e?w=800&q=80',
  meditation_flower_bloom: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=800&q=80',
  meditation_sunset_glow: 'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=800&q=80',
  meditation_abundance: 'https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?w=800&q=80',
  
  // Stress relief themed
  meditation_calm_water: 'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=800&q=80',
  meditation_zen_stones: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&q=80',
  meditation_peaceful_lake: 'https://images.unsplash.com/photo-1439066615861-d1af74d74000?w=800&q=80',
  meditation_soft_clouds: 'https://images.unsplash.com/photo-1517483000871-1dbf64a6e1c6?w=800&q=80',
  meditation_deep_relax: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=80',
  
  // Focus themed
  meditation_sharp_mountain: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80',
  meditation_clear_sky: 'https://images.unsplash.com/photo-1505533542167-8c89838bb19e?w=800&q=80',
  meditation_morning_dew: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800&q=80',
  meditation_study_focus: 'https://images.unsplash.com/photo-1488190211105-8b0e65b80b4e?w=800&q=80',
  meditation_creative_flow: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=800&q=80',
  
  // Anxiety relief themed
  meditation_safe_harbor: 'https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?w=800&q=80',
  meditation_grounding: 'https://images.unsplash.com/photo-1518173946687-a4c036bc6f19?w=800&q=80',
  meditation_gentle_waves: 'https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=800&q=80',
  meditation_calm_presence: 'https://images.unsplash.com/photo-1508672019048-805c876b67e2?w=800&q=80',
  meditation_inner_peace: 'https://images.unsplash.com/photo-1499209974431-9dddcece7f88?w=800&q=80',
  
  // Sleep themed
  meditation_night_sky: 'https://images.unsplash.com/photo-1475274047050-1d0c0975c63e?w=800&q=80',
  meditation_moonlit: 'https://images.unsplash.com/photo-1507400492013-162706c8c05e?w=800&q=80',
  meditation_twilight: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=800&q=80',
  meditation_cozy_rest: 'https://images.unsplash.com/photo-1515894203077-3b2e0f1e9c89?w=800&q=80',
  meditation_dream: 'https://images.unsplash.com/photo-1489549132488-d00b7eee80f1?w=800&q=80',
  
  // Body scan themed
  meditation_body_awareness: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&q=80',
  meditation_relaxed_body: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=800&q=80',
  meditation_quick_scan: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=80',
  meditation_healing: 'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?w=800&q=80',
  meditation_recovery: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80',
  
  // Self-esteem themed
  meditation_self_love: 'https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?w=800&q=80',
  meditation_confidence: 'https://images.unsplash.com/photo-1494178270175-e96de2971df9?w=800&q=80',
  meditation_worthy: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=800&q=80',
  meditation_inner_child: 'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=800&q=80',
  meditation_positive: 'https://images.unsplash.com/photo-1499209974431-9dddcece7f88?w=800&q=80',
  
  // Loving-kindness themed
  meditation_heart_open: 'https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?w=800&q=80',
  meditation_metta: 'https://images.unsplash.com/photo-1474557157379-8aa74a6ef541?w=800&q=80',
  meditation_forgiveness: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800&q=80',
  meditation_compassion: 'https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?w=800&q=80',
  meditation_universal_love: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80',
  
  // ==================== BREATHING IMAGES ====================
  
  breathing_box: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=80',
  breathing_478: 'https://images.unsplash.com/photo-1517483000871-1dbf64a6e1c6?w=800&q=80',
  breathing_belly: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&q=80',
  breathing_energy: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=800&q=80',
  breathing_calm: 'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=800&q=80',
  breathing_alternate: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=800&q=80',
  breathing_ocean: 'https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=800&q=80',
  breathing_morning: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800&q=80',
  breathing_sos: 'https://images.unsplash.com/photo-1439066615861-d1af74d74000?w=800&q=80',
  breathing_focus: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80',
  breathing_sleep: 'https://images.unsplash.com/photo-1475274047050-1d0c0975c63e?w=800&q=80',
  breathing_anxiety: 'https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?w=800&q=80',
  breathing_power: 'https://images.unsplash.com/photo-1505533542167-8c89838bb19e?w=800&q=80',
  breathing_mindful: 'https://images.unsplash.com/photo-1499209974431-9dddcece7f88?w=800&q=80',
  breathing_coherent: 'https://images.unsplash.com/photo-1508672019048-805c876b67e2?w=800&q=80',
  breathing_cooling: 'https://images.unsplash.com/photo-1494500764479-0c8f2919a3d8?w=800&q=80',
  breathing_grounding: 'https://images.unsplash.com/photo-1518173946687-a4c036bc6f19?w=800&q=80',
  breathing_heart: 'https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?w=800&q=80',
  breathing_counting: 'https://images.unsplash.com/photo-1488190211105-8b0e65b80b4e?w=800&q=80',
  breathing_victory: 'https://images.unsplash.com/photo-1494178270175-e96de2971df9?w=800&q=80',
  
  // ==================== SLEEP STORY IMAGES ====================
  
  sleep_moonlit_forest: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&q=80',
  sleep_ocean_waves: 'https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=800&q=80',
  sleep_mountain: 'https://images.unsplash.com/photo-1454496522488-7a8e488e8606?w=800&q=80',
  sleep_starlit_garden: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=800&q=80',
  sleep_gentle_rain: 'https://images.unsplash.com/photo-1428592953211-077101b2021b?w=800&q=80',
  sleep_tropical_island: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80',
  sleep_ancient_library: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=800&q=80',
  sleep_countryside_train: 'https://images.unsplash.com/photo-1474487548417-781cb71495f3?w=800&q=80',
  sleep_autumn_leaves: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80',
  sleep_deep_ocean: 'https://images.unsplash.com/photo-1468581264429-2548ef9eb732?w=800&q=80',
  sleep_cozy_cabin: 'https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=800&q=80',
  sleep_enchanted_castle: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&q=80',
  sleep_rainy_cafe: 'https://images.unsplash.com/photo-1445116572660-236099ec97a0?w=800&q=80',
  sleep_lighthouse: 'https://images.unsplash.com/photo-1504681869696-d977211a5f4c?w=800&q=80',
  sleep_japanese_garden: 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=800&q=80',
  sleep_sailing: 'https://images.unsplash.com/photo-1500514966906-fe245eea9344?w=800&q=80',
  sleep_floating_cloud: 'https://images.unsplash.com/photo-1517483000871-1dbf64a6e1c6?w=800&q=80',
  sleep_night_garden: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=800&q=80',
  sleep_thunderstorm: 'https://images.unsplash.com/photo-1605727216801-e27ce1d0cc28?w=800&q=80',
  sleep_northern_lights: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=800&q=80',
  
  // ==================== PROGRAM IMAGES ====================
  
  program_basics: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=80',
  program_stress: 'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=800&q=80',
  program_sleep: 'https://images.unsplash.com/photo-1475274047050-1d0c0975c63e?w=800&q=80',
  program_anxiety: 'https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?w=800&q=80',
  program_focus: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80',
  program_self_compassion: 'https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?w=800&q=80',
  program_morning: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=800&q=80',
  program_breathing: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&q=80',
  program_mindful: 'https://images.unsplash.com/photo-1499209974431-9dddcece7f88?w=800&q=80',
  program_advanced: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800&q=80',
};

// Type for valid image file keys
export type ImageFileKey = keyof typeof imageFiles;

/**
 * Get image URL by key
 * Returns a placeholder if key not found
 */
export function getImageUrl(key: string): string {
  return imageFiles[key] || 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=80';
}

