/**
 * `graphforge.experienceMode` (Welcome, #22 phase 2): the two ways an analyst
 * can ask GraphForge to behave, inspired by Kilo Code's "Choose how you want
 * to work" onboarding step but mapped onto GraphForge's own vocabulary
 * (confirmations, project detection, Result Graph auto-open) rather than
 * agent autonomy levels. Kept free of `vscode` imports so it can be unit
 * tested directly under plain mocha — see `docs/DESIGN.md`.
 */
export type ExperienceMode = "guided" | "autonomous";

export const DEFAULT_EXPERIENCE_MODE: ExperienceMode = "guided";

export function isExperienceMode(value: unknown): value is ExperienceMode {
  return value === "guided" || value === "autonomous";
}

/** Coerce an unknown config value (missing/stale/corrupt) to a valid mode. */
export function resolveExperienceMode(value: unknown): ExperienceMode {
  return isExperienceMode(value) ? value : DEFAULT_EXPERIENCE_MODE;
}

/** Behavior toggles derived from the chosen mode; applied when Continue is pressed. */
export interface ExperienceModeDefaults {
  /** `graphforge.openResultGraphOnQuery` — quieter in Guided, on by default in Autonomous. */
  openResultGraphOnQuery: boolean;
  /** Whether "Initialize Project Here" on an empty folder still asks to confirm. */
  confirmBeforeInitialize: boolean;
  /** Whether activation silently opens the first detected project without asking. */
  autoOpenDetectedProject: boolean;
}

export function defaultsForExperienceMode(mode: ExperienceMode): ExperienceModeDefaults {
  if (mode === "autonomous") {
    return {
      openResultGraphOnQuery: true,
      confirmBeforeInitialize: false,
      autoOpenDetectedProject: true,
    };
  }
  return {
    openResultGraphOnQuery: false,
    confirmBeforeInitialize: true,
    autoOpenDetectedProject: false,
  };
}

export interface ExperienceModeCard {
  mode: ExperienceMode;
  title: string;
  tagline: string;
  bullets: string[];
}

/** Copy for the two Welcome cards — short, analyst-facing, no infra jargon. */
export const EXPERIENCE_MODE_CARDS: readonly ExperienceModeCard[] = [
  {
    mode: "guided",
    title: "Guided",
    tagline: "Confirm before changes; steady and checklist-driven.",
    bullets: [
      "Confirms before initializing a project",
      "Opens this checklist so setup stays visible",
      "Result Graph stays closed until you ask for it",
    ],
  },
  {
    mode: "autonomous",
    title: "Autonomous",
    tagline: "Fewer prompts; GraphForge moves for you.",
    bullets: [
      "Auto-opens the first GraphForge project it detects",
      "Skips the initialize confirmation for empty folders",
      "Opens the Result Graph automatically after each query",
    ],
  },
];
