import { useQuery } from '@tanstack/react-query';
import {
  getSleepSounds,
  getWhiteNoise,
  getMusic,
  getAsmr,
  getAlbums,
} from '@features/music/data/musicRepository';

export function useSleepSounds() {
  return useQuery({
    queryKey: ['sleepSounds'],
    queryFn: getSleepSounds,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

export function useWhiteNoise() {
  return useQuery({
    queryKey: ['whiteNoise'],
    queryFn: getWhiteNoise,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

export function useMusic() {
  return useQuery({
    queryKey: ['music'],
    queryFn: getMusic,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

export function useAsmr() {
  return useQuery({
    queryKey: ['asmr'],
    queryFn: getAsmr,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

export function useAlbums() {
  return useQuery({
    queryKey: ['albums'],
    queryFn: getAlbums,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}
