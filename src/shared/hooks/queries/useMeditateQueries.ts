import { useQuery } from '@tanstack/react-query';
import {
  getEmergencyMeditations,
  getCourses,
  getMeditations,
} from '@features/meditate/data/meditateRepository';

export function useEmergencyMeditations() {
  return useQuery({
    queryKey: ['emergencyMeditations'],
    queryFn: getEmergencyMeditations,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

export function useCourses() {
  return useQuery({
    queryKey: ['courses'],
    queryFn: getCourses,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

export function useGuidedMeditations() {
  return useQuery({
    queryKey: ['guidedMeditations'],
    queryFn: getMeditations,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}
