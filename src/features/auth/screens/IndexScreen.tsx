import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { useAuth } from "@core/providers/contexts/AuthContext";
import { LoadingScreen } from "@shared/ui/LoadingScreen";
import { getHasSeenOnboarding } from "@features/auth/utils/onboardingStorage";

export default function Index() {
  const { user, loading } = useAuth();
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(
    null
  );

  useEffect(() => {
    let isMounted = true;

    getHasSeenOnboarding()
      .then((value) => {
        if (isMounted) {
          setHasSeenOnboarding(value);
        }
      })
      .catch(() => {
        if (isMounted) {
          setHasSeenOnboarding(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading || hasSeenOnboarding === null) {
    return <LoadingScreen message="Preparing your first session..." />;
  }

  if (!hasSeenOnboarding && (!user || user.isAnonymous)) {
    return <Redirect href="/onboarding" />;
  }

  return user ? <Redirect href="/(tabs)/home" /> : <Redirect href="/login" />;
}
