import { useState, useEffect } from "react";

// ============================================================
// CALMDEMY ONBOARDING PROTOTYPE
// Interactive mockup of the redesigned onboarding flow
// ============================================================
// STRATEGY: Replace the current 3-slide feature tour with a
// 6-step personalized journey that asks → listens → recommends.
//
// KEY CHANGES FROM CURRENT:
// 1. Emotional hook first (not feature list)
// 2. Personalization questions (goal, experience, timing)
// 3. Tailored recommendation before paywall
// 4. Psychology angle woven throughout
// 5. Paywall feels earned, not forced
// ============================================================

const COLORS = {
  sage: "#8B9F82",
  sageDark: "#6B7F65",
  sageLight: "#A8B89F",
  sageBg: "#E8EDE5",
  terracotta: "#C4A77D",
  terracottaLight: "#F5EDE3",
  rose: "#D4A5A5",
  roseLight: "#F5E8E8",
  background: "#FAF8F5",
  surface: "#FFFEF9",
  dark: "#3D3A38",
  gray: "#8B8685",
  lightGray: "#A8A5A3",
  white: "#FFFFFF",
  sleepBg: "#1A1D29",
  sleepGold: "#C9B896",
};

const goals = [
  { id: "anxiety", icon: "🌊", label: "Ease anxiety", desc: "Find calm when your mind races" },
  { id: "sleep", icon: "🌙", label: "Sleep better", desc: "Fall asleep faster, wake rested" },
  { id: "focus", icon: "🎯", label: "Sharpen focus", desc: "Train your attention and clarity" },
  { id: "growth", icon: "🌱", label: "Self-improvement", desc: "Build mental resilience and tools" },
  { id: "stress", icon: "💆", label: "Manage stress", desc: "Decompress from daily pressure" },
  { id: "healing", icon: "💛", label: "Process emotions", desc: "Navigate grief, anger, or sadness" },
];

const experiences = [
  { id: "new", icon: "🌱", label: "Brand new", desc: "I've never meditated" },
  { id: "curious", icon: "🌿", label: "A little curious", desc: "I've tried it a few times" },
  { id: "regular", icon: "🌳", label: "Regular practice", desc: "I meditate occasionally" },
  { id: "deep", icon: "🏔️", label: "Experienced", desc: "Meditation is part of my life" },
];

const durations = [
  { id: "3", label: "3 min", desc: "Quick reset", icon: "⚡" },
  { id: "5", label: "5 min", desc: "Daily starter", icon: "☀️" },
  { id: "10", label: "10 min", desc: "Sweet spot", icon: "🧘", recommended: true },
  { id: "20", label: "20+", desc: "Deep dive", icon: "🌊" },
];

// Personalized recommendation mapping
const getRecommendation = (goal, experience) => {
  const recs = {
    anxiety: {
      therapy: "CBT (Cognitive Behavioral Therapy)",
      technique: "Breathing + Grounding",
      firstSession: "Emergency Calm: 3-Minute Anxiety Reset",
      course: "CBT Foundations: Rewiring Anxious Thoughts",
      why: "CBT is the gold-standard therapy for anxiety. Our course adapts its core techniques into guided meditations you can use anywhere.",
    },
    sleep: {
      therapy: "MBCT (Mindfulness-Based CBT)",
      technique: "Body Scan + Visualization",
      firstSession: "Moonlit Forest: A Sleep Journey",
      course: "Sleep Science: 7 Nights to Better Rest",
      why: "Poor sleep often starts with a restless mind. Our sleep program combines mindfulness techniques with evidence-based sleep hygiene.",
    },
    focus: {
      therapy: "ACT (Acceptance & Commitment)",
      technique: "Mindfulness + Breathing",
      firstSession: "Sharp Mind: 5-Minute Focus Reset",
      course: "ACT for Focus: Training Your Attention",
      why: "ACT teaches you to notice distractions without fighting them — a skill that transforms how you work and think.",
    },
    growth: {
      therapy: "ACT + IFS (Internal Family Systems)",
      technique: "Loving Kindness + Visualization",
      firstSession: "Morning Intention: Start Your Day with Clarity",
      course: "The Inner Leader: Psychology-Based Growth",
      why: "Real self-improvement isn't about willpower — it's about understanding your mind. This course draws from ACT and IFS to build lasting change.",
    },
    stress: {
      therapy: "DBT (Dialectical Behavior Therapy)",
      technique: "Breathing + Body Scan",
      firstSession: "Pressure Release: A 5-Minute Decompression",
      course: "DBT Skills: Managing Stress Like a Therapist",
      why: "DBT was designed for emotional overwhelm. Our course distills its most practical tools into daily meditations.",
    },
    healing: {
      therapy: "IFS + Somatic Therapy",
      technique: "Loving Kindness + Grounding",
      firstSession: "A Gentle Space: Holding What Hurts",
      course: "Somatic Healing: Listening to Your Body",
      why: "Emotions live in the body, not just the mind. This course blends somatic awareness with IFS to help you process what you're carrying.",
    },
  };
  return recs[goal] || recs.anxiety;
};

// --- SCREEN COMPONENTS ---

function WelcomeScreen({ onNext }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { setTimeout(() => setVisible(true), 100); }, []);
  return (
    <div style={{
      ...styles.screen,
      background: `linear-gradient(180deg, ${COLORS.background} 0%, ${COLORS.sageBg} 100%)`,
      justifyContent: "center",
      opacity: visible ? 1 : 0,
      transition: "opacity 0.6s ease",
    }}>
      <div style={{ textAlign: "center", padding: "0 32px" }}>
        <div style={{ fontSize: 64, marginBottom: 24, filter: "drop-shadow(0 4px 12px rgba(139,159,130,0.3))" }}>🍃</div>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 32, color: COLORS.dark, fontWeight: 600, marginBottom: 12, letterSpacing: -0.5 }}>
          Welcome to Calmdemy
        </h1>
        <p style={{ fontFamily: "Georgia, serif", fontSize: 18, color: COLORS.gray, lineHeight: 1.6, marginBottom: 8, fontStyle: "italic" }}>
          Where mindfulness meets psychology
        </p>
        <p style={{ fontSize: 15, color: COLORS.lightGray, lineHeight: 1.6, maxWidth: 300, margin: "16px auto 0" }}>
          We'll ask a few quick questions to personalize your experience. Takes about 30 seconds.
        </p>
      </div>
      <button style={styles.primaryBtn} onClick={onNext}>
        Let's begin
      </button>
    </div>
  );
}

function GoalScreen({ onNext, selected, setSelected }) {
  return (
    <div style={{ ...styles.screen, background: COLORS.background }}>
      <div style={styles.header}>
        <p style={styles.eyebrow}>STEP 1 OF 4</p>
        <h2 style={styles.title}>What brings you here?</h2>
        <p style={styles.subtitle}>Pick the one that resonates most. You can explore everything later.</p>
      </div>
      <div style={styles.optionsGrid}>
        {goals.map((g) => (
          <button
            key={g.id}
            onClick={() => setSelected(g.id)}
            style={{
              ...styles.optionCard,
              borderColor: selected === g.id ? COLORS.sage : "#E8E6E3",
              backgroundColor: selected === g.id ? COLORS.sageBg : COLORS.white,
              boxShadow: selected === g.id ? `0 0 0 2px ${COLORS.sage}` : "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <span style={{ fontSize: 24 }}>{g.icon}</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.dark }}>{g.label}</div>
              <div style={{ fontSize: 12, color: COLORS.gray, marginTop: 2 }}>{g.desc}</div>
            </div>
          </button>
        ))}
      </div>
      <button style={{ ...styles.primaryBtn, opacity: selected ? 1 : 0.5 }} onClick={onNext} disabled={!selected}>
        Continue
      </button>
    </div>
  );
}

function ExperienceScreen({ onNext, selected, setSelected }) {
  return (
    <div style={{ ...styles.screen, background: COLORS.background }}>
      <div style={styles.header}>
        <p style={styles.eyebrow}>STEP 2 OF 4</p>
        <h2 style={styles.title}>How's your meditation experience?</h2>
        <p style={styles.subtitle}>No wrong answer — we'll meet you where you are.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 24px", flex: 1 }}>
        {experiences.map((e) => (
          <button
            key={e.id}
            onClick={() => setSelected(e.id)}
            style={{
              ...styles.listOption,
              borderColor: selected === e.id ? COLORS.sage : "#E8E6E3",
              backgroundColor: selected === e.id ? COLORS.sageBg : COLORS.white,
              boxShadow: selected === e.id ? `0 0 0 2px ${COLORS.sage}` : "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <span style={{ fontSize: 24, marginRight: 14 }}>{e.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.dark }}>{e.label}</div>
              <div style={{ fontSize: 13, color: COLORS.gray, marginTop: 2 }}>{e.desc}</div>
            </div>
            <div style={{
              width: 22, height: 22, borderRadius: 11,
              border: `2px solid ${selected === e.id ? COLORS.sage : "#D0CDCA"}`,
              backgroundColor: selected === e.id ? COLORS.sage : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.2s ease",
            }}>
              {selected === e.id && <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.white }} />}
            </div>
          </button>
        ))}
      </div>
      <button style={{ ...styles.primaryBtn, opacity: selected ? 1 : 0.5 }} onClick={onNext} disabled={!selected}>
        Continue
      </button>
    </div>
  );
}

function DurationScreen({ onNext, selected, setSelected }) {
  return (
    <div style={{ ...styles.screen, background: COLORS.background }}>
      <div style={styles.header}>
        <p style={styles.eyebrow}>STEP 3 OF 4</p>
        <h2 style={styles.title}>How long feels right?</h2>
        <p style={styles.subtitle}>Your ideal daily session length. You can always adjust.</p>
      </div>
      <div style={{ display: "flex", gap: 12, padding: "0 24px", justifyContent: "center", flex: 1, alignItems: "flex-start", paddingTop: 8 }}>
        {durations.map((d) => (
          <button
            key={d.id}
            onClick={() => setSelected(d.id)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              padding: "20px 16px", borderRadius: 16, border: "2px solid",
              borderColor: selected === d.id ? COLORS.sage : "#E8E6E3",
              backgroundColor: selected === d.id ? COLORS.sageBg : COLORS.white,
              boxShadow: selected === d.id ? `0 0 0 2px ${COLORS.sage}` : "0 1px 3px rgba(0,0,0,0.04)",
              cursor: "pointer", width: 80, position: "relative",
              transition: "all 0.2s ease",
            }}
          >
            {d.recommended && (
              <div style={{
                position: "absolute", top: -10, fontSize: 9, fontWeight: 700,
                backgroundColor: COLORS.terracotta, color: COLORS.white,
                padding: "2px 8px", borderRadius: 10, letterSpacing: 0.5,
              }}>POPULAR</div>
            )}
            <span style={{ fontSize: 24 }}>{d.icon}</span>
            <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.dark }}>{d.label}</div>
            <div style={{ fontSize: 11, color: COLORS.gray }}>{d.desc}</div>
          </button>
        ))}
      </div>
      <button style={{ ...styles.primaryBtn, opacity: selected ? 1 : 0.5 }} onClick={onNext} disabled={!selected}>
        Continue
      </button>
    </div>
  );
}

function RecommendationScreen({ goal, experience, duration, onNext }) {
  const rec = getRecommendation(goal);
  const [visible, setVisible] = useState(false);
  useEffect(() => { setTimeout(() => setVisible(true), 200); }, []);

  return (
    <div style={{
      ...styles.screen,
      background: `linear-gradient(180deg, ${COLORS.background} 0%, ${COLORS.terracottaLight} 100%)`,
      opacity: visible ? 1 : 0, transition: "opacity 0.5s ease",
    }}>
      <div style={styles.header}>
        <p style={styles.eyebrow}>YOUR PERSONALIZED PATH</p>
        <h2 style={{ ...styles.title, fontSize: 24 }}>Here's what we recommend</h2>
      </div>

      <div style={{ padding: "0 24px", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* First session card */}
        <div style={{
          background: COLORS.white, borderRadius: 16, padding: 20,
          boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: `1px solid ${COLORS.sageBg}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{
              backgroundColor: COLORS.sage, borderRadius: 8, width: 28, height: 28,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
            }}>▶</div>
            <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.sage, letterSpacing: 1 }}>START HERE</span>
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: COLORS.dark, marginBottom: 4 }}>
            {rec.firstSession}
          </div>
          <div style={{ fontSize: 13, color: COLORS.gray }}>
            {duration} min · {rec.technique} · Free
          </div>
        </div>

        {/* Course recommendation */}
        <div style={{
          background: `linear-gradient(135deg, ${COLORS.sage}15, ${COLORS.terracotta}15)`,
          borderRadius: 16, padding: 20, border: `1px solid ${COLORS.sageBg}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.terracotta, letterSpacing: 1 }}>RECOMMENDED COURSE</span>
            <span style={{
              fontSize: 9, fontWeight: 700, backgroundColor: COLORS.terracotta,
              color: COLORS.white, padding: "2px 8px", borderRadius: 10,
            }}>PREMIUM</span>
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: COLORS.dark, marginBottom: 6 }}>
            {rec.course}
          </div>
          <div style={{ fontSize: 13, color: COLORS.gray, lineHeight: 1.5, marginBottom: 8 }}>
            Based on {rec.therapy}
          </div>
          <div style={{
            fontSize: 13, color: COLORS.dark, lineHeight: 1.6,
            fontStyle: "italic", borderLeft: `3px solid ${COLORS.terracotta}`,
            paddingLeft: 12, marginTop: 8,
          }}>
            {rec.why}
          </div>
        </div>

        {/* Free content note */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 16px", backgroundColor: `${COLORS.sage}10`,
          borderRadius: 12,
        }}>
          <span style={{ fontSize: 18 }}>✨</span>
          <p style={{ fontSize: 13, color: COLORS.gray, lineHeight: 1.5, margin: 0 }}>
            Most content is free forever — meditations, sleep stories, sounds, and more.
            Courses are the only premium feature.
          </p>
        </div>
      </div>

      <button style={styles.primaryBtn} onClick={onNext}>
        Start my first session — free
      </button>
      <button style={{ ...styles.secondaryBtn, marginTop: -8 }} onClick={onNext}>
        View subscription plans
      </button>
    </div>
  );
}

function PaywallScreen({ goal, onNext, onSkip }) {
  const rec = getRecommendation(goal);
  const [selectedPlan, setSelectedPlan] = useState("annual");

  return (
    <div style={{ ...styles.screen, background: COLORS.background }}>
      <div style={{ ...styles.header, paddingBottom: 0 }}>
        <p style={styles.eyebrow}>UNLOCK YOUR FULL PATH</p>
        <h2 style={{ ...styles.title, fontSize: 22 }}>
          {goal === "anxiety" ? "Your anxiety toolkit awaits" :
           goal === "sleep" ? "Unlock better sleep tonight" :
           goal === "focus" ? "Train your focus daily" :
           goal === "growth" ? "Start your growth journey" :
           goal === "stress" ? "Master your stress response" :
           "Begin your healing path"}
        </h2>
      </div>

      <div style={{ padding: "0 24px", flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* What you get */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 4 }}>
          {[
            { icon: "🧠", text: `Full access to "${rec.course}"` },
            { icon: "📚", text: "All psychology-based courses (CBT, ACT, DBT, and more)" },
            { icon: "🎧", text: "Premium meditations, stories, and sounds" },
            { icon: "📈", text: "New content added weekly" },
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18, width: 28, textAlign: "center" }}>{item.icon}</span>
              <span style={{ fontSize: 14, color: COLORS.dark, lineHeight: 1.4 }}>{item.text}</span>
            </div>
          ))}
        </div>

        {/* Plan cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
          <button onClick={() => setSelectedPlan("annual")} style={{
            display: "flex", alignItems: "center", padding: "16px 18px",
            borderRadius: 14, border: "2px solid",
            borderColor: selectedPlan === "annual" ? COLORS.sage : "#E8E6E3",
            backgroundColor: selectedPlan === "annual" ? COLORS.sageBg : COLORS.white,
            boxShadow: selectedPlan === "annual" ? `0 0 0 2px ${COLORS.sage}` : "none",
            cursor: "pointer", position: "relative", textAlign: "left", width: "100%",
          }}>
            <div style={{
              position: "absolute", top: -10, right: 16,
              fontSize: 10, fontWeight: 700, backgroundColor: COLORS.terracotta,
              color: COLORS.white, padding: "3px 10px", borderRadius: 10,
            }}>BEST VALUE</div>
            <div style={{
              width: 22, height: 22, borderRadius: 11, marginRight: 14,
              border: `2px solid ${selectedPlan === "annual" ? COLORS.sage : "#D0CDCA"}`,
              backgroundColor: selectedPlan === "annual" ? COLORS.sage : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {selectedPlan === "annual" && <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.white }} />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.dark }}>Annual</div>
              <div style={{ fontSize: 13, color: COLORS.gray }}>$49.99/year · 14-day free trial</div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.sage }}>$4.17/mo</div>
          </button>

          <button onClick={() => setSelectedPlan("monthly")} style={{
            display: "flex", alignItems: "center", padding: "16px 18px",
            borderRadius: 14, border: "2px solid",
            borderColor: selectedPlan === "monthly" ? COLORS.sage : "#E8E6E3",
            backgroundColor: selectedPlan === "monthly" ? COLORS.sageBg : COLORS.white,
            boxShadow: selectedPlan === "monthly" ? `0 0 0 2px ${COLORS.sage}` : "none",
            cursor: "pointer", textAlign: "left", width: "100%",
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: 11, marginRight: 14,
              border: `2px solid ${selectedPlan === "monthly" ? COLORS.sage : "#D0CDCA"}`,
              backgroundColor: selectedPlan === "monthly" ? COLORS.sage : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {selectedPlan === "monthly" && <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.white }} />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.dark }}>Monthly</div>
              <div style={{ fontSize: 13, color: COLORS.gray }}>$7.99/month · 7-day free trial</div>
            </div>
          </button>
        </div>

        <p style={{ fontSize: 11, color: COLORS.lightGray, textAlign: "center", marginTop: 4 }}>
          Cancel anytime. Subscription auto-renews until cancelled.
        </p>
      </div>

      <button style={styles.primaryBtn} onClick={onNext}>
        Start free trial
      </button>
      <button style={{ ...styles.ghostBtn, marginTop: -8 }} onClick={onSkip}>
        Continue with free content
      </button>
    </div>
  );
}

// --- MAIN APP ---

export default function CaldemyOnboardingPrototype() {
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState(null);
  const [experience, setExperience] = useState(null);
  const [duration, setDuration] = useState(null);
  const [slideDir, setSlideDir] = useState("right");

  const goNext = () => {
    setSlideDir("right");
    setStep((s) => s + 1);
  };
  const goBack = () => {
    setSlideDir("left");
    setStep((s) => Math.max(0, s - 1));
  };
  const restart = () => {
    setStep(0); setGoal(null); setExperience(null); setDuration(null);
  };

  const screens = [
    <WelcomeScreen onNext={goNext} />,
    <GoalScreen onNext={goNext} selected={goal} setSelected={setGoal} />,
    <ExperienceScreen onNext={goNext} selected={experience} setSelected={setExperience} />,
    <DurationScreen onNext={goNext} selected={duration} setSelected={setDuration} />,
    <RecommendationScreen goal={goal} experience={experience} duration={duration} onNext={goNext} />,
    <PaywallScreen goal={goal} onNext={() => setStep(6)} onSkip={() => setStep(6)} />,
  ];

  if (step >= screens.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", backgroundColor: COLORS.background, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", padding: 32 }}>
        <div style={{ textAlign: "center", maxWidth: 500 }}>
          <div style={{ fontSize: 56, marginBottom: 20 }}>🎉</div>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: 26, color: COLORS.dark, marginBottom: 12 }}>End of prototype</h2>
          <p style={{ fontSize: 15, color: COLORS.gray, lineHeight: 1.6, marginBottom: 24 }}>
            From here, the user would land on the Home tab with their personalized content recommendations front and center.
          </p>
          <button onClick={restart} style={{ ...styles.primaryBtn, position: "relative", width: "auto", display: "inline-flex", padding: "14px 32px" }}>
            Restart prototype
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "100vh",
      backgroundColor: "#E8E6E3", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      padding: "20px 16px",
    }}>
      {/* Screen label */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: COLORS.gray, letterSpacing: 1, textTransform: "uppercase", margin: 0 }}>
          {["Welcome", "Goal Selection", "Experience Level", "Session Length", "Your Recommendation", "Subscription"][step]}
        </h3>
        <span style={{ fontSize: 12, color: COLORS.lightGray }}>Screen {step + 1} of 6</span>
      </div>

      {/* Phone frame */}
      <div style={{
        width: 375, height: 740, borderRadius: 40, overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.08)",
        position: "relative", backgroundColor: COLORS.background,
      }}>
        {/* Status bar */}
        <div style={{
          height: 50, display: "flex", alignItems: "flex-end", justifyContent: "center",
          paddingBottom: 6, backgroundColor: "transparent", position: "absolute",
          top: 0, left: 0, right: 0, zIndex: 10,
        }}>
          <div style={{ width: 120, height: 28, borderRadius: 14, backgroundColor: "#000" }} />
        </div>

        {/* Back button */}
        {step > 0 && (
          <button onClick={goBack} style={{
            position: "absolute", top: 56, left: 16, zIndex: 10,
            background: "none", border: "none", cursor: "pointer",
            fontSize: 24, color: COLORS.gray, padding: 4,
          }}>←</button>
        )}

        {/* Skip button */}
        {step > 0 && step < 5 && (
          <button onClick={() => setStep(4)} style={{
            position: "absolute", top: 60, right: 16, zIndex: 10,
            background: "none", border: "none", cursor: "pointer",
            fontSize: 13, color: COLORS.lightGray,
          }}>Skip</button>
        )}

        {/* Progress bar */}
        {step > 0 && step < 5 && (
          <div style={{
            position: "absolute", top: 50, left: 0, right: 0, height: 3,
            backgroundColor: "#E8E6E3", zIndex: 10,
          }}>
            <div style={{
              height: "100%", backgroundColor: COLORS.sage,
              width: `${(step / 4) * 100}%`, transition: "width 0.4s ease",
              borderRadius: 2,
            }} />
          </div>
        )}

        {/* Screen content */}
        <div style={{ height: "100%", paddingTop: 54 }}>
          {screens[step]}
        </div>
      </div>

      {/* Navigation hint */}
      <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
        {[0,1,2,3,4,5].map(i => (
          <button
            key={i}
            onClick={() => {
              // Only allow jumping to screens if prereqs are met
              if (i <= 1 || (i <= 2 && goal) || (i <= 3 && goal && experience) || (i <= 4 && goal && experience && duration) || (i <= 5 && goal && experience && duration)) {
                setStep(i);
              }
            }}
            style={{
              width: 10, height: 10, borderRadius: 5, border: "none", cursor: "pointer",
              backgroundColor: step === i ? COLORS.sage : "#D0CDCA",
              transition: "all 0.3s ease",
              transform: step === i ? "scale(1.3)" : "scale(1)",
            }}
          />
        ))}
      </div>

      {/* Copy annotations */}
      <div style={{
        marginTop: 20, maxWidth: 500, padding: "16px 20px",
        backgroundColor: COLORS.white, borderRadius: 12,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        border: `1px solid #E8E6E3`,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.sage, letterSpacing: 1, marginBottom: 8 }}>
          COPYWRITER'S NOTE
        </div>
        <p style={{ fontSize: 13, color: COLORS.gray, lineHeight: 1.6, margin: 0 }}>
          {step === 0 && "The welcome screen sets the brand promise (\"mindfulness meets psychology\") and signals that this will be personalized, not generic. The 30-second time commitment lowers friction."}
          {step === 1 && "Goal selection drives everything downstream — the recommendation, the paywall copy, and the home screen. Each option uses emotional language (\"Find calm when your mind races\") rather than clinical language."}
          {step === 2 && "\"No wrong answer\" disarms self-judgment. The nature metaphors (seed → tree → mountain) match the app's milestone system and make experience levels feel like growth stages, not rankings."}
          {step === 3 && "Duration cards are visual and quick to choose. The \"POPULAR\" badge uses social proof to guide without pressuring. These preferences feed into the daily reminder system."}
          {step === 4 && "This is the magic screen. Instead of listing features, it shows a tailored path. The therapy explanation (the italic quote) educates and builds trust — users learn WHY this approach works for their specific need."}
          {step === 5 && "The paywall headline changes based on the user's goal — it feels like a continuation of their journey, not a sales pitch. \"Continue with free content\" as the skip option reinforces trust and generosity."}
        </p>
      </div>
    </div>
  );
}

// --- SHARED STYLES ---

const styles = {
  screen: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    paddingBottom: 28,
    overflow: "auto",
  },
  header: {
    padding: "20px 24px 16px",
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 700,
    color: COLORS.sage,
    letterSpacing: 1.5,
    marginBottom: 8,
    marginTop: 0,
  },
  title: {
    fontFamily: "Georgia, serif",
    fontSize: 26,
    fontWeight: 600,
    color: COLORS.dark,
    marginBottom: 6,
    marginTop: 0,
    letterSpacing: -0.3,
    lineHeight: 1.2,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.gray,
    lineHeight: 1.5,
    marginTop: 0,
    marginBottom: 0,
  },
  optionsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
    padding: "0 24px",
    flex: 1,
    alignContent: "start",
  },
  optionCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 8,
    padding: "16px 14px",
    borderRadius: 14,
    border: "2px solid",
    cursor: "pointer",
    textAlign: "left",
    transition: "all 0.2s ease",
  },
  listOption: {
    display: "flex",
    alignItems: "center",
    padding: "16px 18px",
    borderRadius: 14,
    border: "2px solid",
    cursor: "pointer",
    textAlign: "left",
    transition: "all 0.2s ease",
    width: "100%",
  },
  primaryBtn: {
    margin: "16px 24px",
    padding: "16px 24px",
    borderRadius: 14,
    border: "none",
    backgroundColor: COLORS.sage,
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
    boxShadow: `0 4px 12px ${COLORS.sage}40`,
  },
  secondaryBtn: {
    margin: "0 24px 8px",
    padding: "12px 24px",
    borderRadius: 14,
    border: `2px solid ${COLORS.sage}`,
    backgroundColor: "transparent",
    color: COLORS.sage,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  ghostBtn: {
    margin: "0 24px 8px",
    padding: "12px 24px",
    borderRadius: 14,
    border: "none",
    backgroundColor: "transparent",
    color: COLORS.gray,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  },
};
