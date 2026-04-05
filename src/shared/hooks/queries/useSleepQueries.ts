import { useQuery } from '@tanstack/react-query';
import { getBedtimeStories, getSleepMeditations, getSeries } from '@features/sleep/data/sleepRepository';

export function useBedtimeStories() {
  return useQuery({
    queryKey: ['bedtimeStories'],
    queryFn: getBedtimeStories,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

export function useSleepMeditations() {
  return useQuery({
    queryKey: ['sleepMeditations'],
    queryFn: getSleepMeditations,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

export function useSeries() {
  return useQuery({
    queryKey: ['series'],
    queryFn: getSeries,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}
