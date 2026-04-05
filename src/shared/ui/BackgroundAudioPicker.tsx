import React, { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { useTheme } from "@core/providers/contexts/ThemeContext";
import { Theme } from "@/theme";
import { getSleepSounds, FirestoreSleepSound } from "@features/music/data/musicRepository";

// Category icon mapping - used for display purposes
const categoryIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  all: "apps",
  rain: "rainy",
  water: "water",
  fire: "flame",
  wind: "cloudy",
  nature: "leaf",
  ambient: "planet",
};

// Category label mapping - for display titles
const categoryLabels: Record<string, string> = {
  all: "All",
  rain: "Rain",
  water: "Water",
  fire: "Fire",
  wind: "Wind",
  nature: "Nature",
  ambient: "Ambient",
};

interface BackgroundAudioPickerProps {
  visible: boolean;
  onClose: () => void;
  selectedSoundId: string | null;
  loadingSoundId: string | null;
  isAudioReady: boolean;
  hasError: boolean;
  volume: number;
  isEnabled: boolean;
  onSelectSound: (soundId: string | null, audioPath: string | null) => void;
  onVolumeChange: (volume: number) => void;
  onToggleEnabled: (enabled: boolean) => void;
}

export function BackgroundAudioPicker({
  visible,
  onClose,
  selectedSoundId,
  loadingSoundId,
  isAudioReady,
  hasError,
  volume,
  isEnabled,
  onSelectSound,
  onVolumeChange,
  onToggleEnabled,
}: BackgroundAudioPickerProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [allSounds, setAllSounds] = useState<FirestoreSleepSound[]>([]);
  const [loadingSounds, setLoadingSounds] = useState(true);

  useEffect(() => {
    async function loadSounds() {
      setLoadingSounds(true);
      const sounds = await getSleepSounds();
      setAllSounds(sounds);
      setLoadingSounds(false);
    }
    if (visible) {
      loadSounds();
    }
  }, [visible]);

  // Derive categories dynamically from the sounds data
  const categories = useMemo(() => {
    const uniqueCats = [...new Set(allSounds.map((s) => s.category))];
    // Sort alphabetically and add 'all' at the beginning
    return ["all", ...uniqueCats.sort()];
  }, [allSounds]);

  const filteredSounds = useMemo(
    () => activeCategory === "all" 
      ? allSounds 
      : allSounds.filter((sound) => sound.category === activeCategory),
    [activeCategory, allSounds]
  );

  const handleSoundSelect = (sound: FirestoreSleepSound) => {
    if (selectedSoundId === sound.id) {
      // Deselect if already selected
      onSelectSound(null, null);
    } else {
      onSelectSound(sound.id, sound.audioPath);
      if (!isEnabled) {
        onToggleEnabled(true);
      }
    }
  };

  const handleTurnOff = () => {
    onToggleEnabled(false);
    onSelectSound(null, null);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Background Sound</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="rgba(255,255,255,0.8)" />
            </TouchableOpacity>
          </View>

          {/* Off Button */}
          <TouchableOpacity
            style={[
              styles.offButton,
              !isEnabled && styles.offButtonActive,
            ]}
            onPress={handleTurnOff}
          >
            <Ionicons
              name="volume-mute"
              size={20}
              color={!isEnabled ? "#fff" : "rgba(255,255,255,0.6)"}
            />
            <Text
              style={[
                styles.offButtonText,
                !isEnabled && styles.offButtonTextActive,
              ]}
            >
              Off
            </Text>
          </TouchableOpacity>

          {/* Volume Slider */}
          <View style={styles.volumeSection}>
            <View style={styles.volumeHeader}>
              <Ionicons name="volume-low" size={18} color="rgba(255,255,255,0.6)" />
              <Text style={styles.volumeLabel}>Volume</Text>
              <Ionicons name="volume-high" size={18} color="rgba(255,255,255,0.6)" />
            </View>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={1}
              value={volume}
              onValueChange={onVolumeChange}
              minimumTrackTintColor="rgba(255,255,255,0.8)"
              maximumTrackTintColor="rgba(255,255,255,0.2)"
              thumbTintColor="#fff"
            />
          </View>

          {/* Category Tabs */}
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            style={styles.categoryScrollView}
            contentContainerStyle={styles.categoryTabs}
          >
            {categories.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[
                  styles.categoryTab,
                  activeCategory === cat && styles.categoryTabActive,
                ]}
                onPress={() => setActiveCategory(cat)}
              >
                <Ionicons
                  name={categoryIcons[cat] || "ellipse"}
                  size={16}
                  color={
                    activeCategory === cat
                      ? "#fff"
                      : "rgba(255,255,255,0.5)"
                  }
                />
                <Text
                  style={[
                    styles.categoryTabText,
                    activeCategory === cat && styles.categoryTabTextActive,
                  ]}
                >
                  {categoryLabels[cat] || cat.charAt(0).toUpperCase() + cat.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Sound List */}
          <ScrollView
            style={styles.soundList}
            showsVerticalScrollIndicator={false}
          >
            {loadingSounds ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color="#7DAFB4" />
              </View>
            ) : filteredSounds.map((sound) => {
              const isThisSoundSelected = selectedSoundId === sound.id && isEnabled;
              // Show error if this sound is selected and has error
              const showError = isThisSoundSelected && hasError;
              // Show loading if this sound is selected but audio is not ready and no error
              const isLoading = isThisSoundSelected && !isAudioReady && !hasError;
              // Only show checkmark if selected AND audio is actually ready
              const showCheckmark = isThisSoundSelected && isAudioReady && !hasError;
              
              
              return (
                <TouchableOpacity
                  key={sound.id}
                  style={[
                    styles.soundItem,
                    isThisSoundSelected && styles.soundItemActive,
                    showError && styles.soundItemError,
                  ]}
                  onPress={() => handleSoundSelect(sound)}
                >
                  <View
                    style={[
                      styles.soundIcon,
                      { backgroundColor: `${sound.color}30` },
                    ]}
                  >
                    <Ionicons
                      name={sound.icon as keyof typeof Ionicons.glyphMap}
                      size={20}
                      color={sound.color}
                    />
                  </View>
                  <Text style={styles.soundTitle}>{sound.title}</Text>
                  {showError ? (
                    <Ionicons
                      name="close-circle"
                      size={22}
                      color="#E57373"
                    />
                  ) : isLoading ? (
                    <ActivityIndicator size="small" color="#7DAFB4" />
                  ) : showCheckmark ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={22}
                      color="#7DAFB4"
                    />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: "flex-end",
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.5)",
    },
    container: {
      backgroundColor: "#1A1D29",
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingTop: 20,
      paddingBottom: 40,
      height: "75%",
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      marginBottom: 16,
    },
    title: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 20,
      color: "#fff",
    },
    closeButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: "rgba(255,255,255,0.1)",
      alignItems: "center",
      justifyContent: "center",
    },
    offButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      marginHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: "rgba(255,255,255,0.08)",
      gap: 8,
      marginBottom: 16,
    },
    offButtonActive: {
      backgroundColor: "rgba(231,115,115,0.2)",
    },
    offButtonText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 15,
      color: "rgba(255,255,255,0.6)",
    },
    offButtonTextActive: {
      color: "#E57373",
    },
    volumeSection: {
      paddingHorizontal: 20,
      marginBottom: 20,
    },
    volumeHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    volumeLabel: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: "rgba(255,255,255,0.6)",
    },
    slider: {
      width: "100%",
      height: 40,
    },
    categoryScrollView: {
      maxHeight: 44,
      marginBottom: 16,
    },
    categoryTabs: {
      flexDirection: "row",
      paddingHorizontal: 20,
      gap: 8,
    },
    categoryTab: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: "rgba(255,255,255,0.06)",
      gap: 6,
    },
    categoryTabActive: {
      backgroundColor: "rgba(125,175,180,0.3)",
    },
    categoryTabText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: "rgba(255,255,255,0.5)",
    },
    categoryTabTextActive: {
      color: "#fff",
    },
    soundList: {
      flex: 1,
      paddingHorizontal: 20,
    },
    soundItem: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 12,
      marginBottom: 8,
      backgroundColor: "rgba(255,255,255,0.04)",
    },
    soundItemActive: {
      backgroundColor: "rgba(125,175,180,0.15)",
    },
    soundItemError: {
      backgroundColor: "rgba(229,115,115,0.15)",
    },
    soundIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    soundTitle: {
      flex: 1,
      fontFamily: theme.fonts.ui.medium,
      fontSize: 15,
      color: "#fff",
    },
    loadingContainer: {
      paddingVertical: 40,
      alignItems: "center",
    },
  });
