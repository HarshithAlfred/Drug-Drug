export type SeverityLevel = "none" | "minor" | "moderate" | "serious" | "contraindicated";

export const SEVERITY_WEIGHTS: Record<SeverityLevel, number> = {
  none: 0,
  minor: 1,
  moderate: 2,
  serious: 3,
  contraindicated: 4,
};

export const MAX_SEVERITY_WEIGHT = Math.max(...Object.values(SEVERITY_WEIGHTS));

const KEYWORD_GROUPS: Array<{ level: SeverityLevel; keywords: RegExp[] }> = [
  {
    level: "contraindicated",
    keywords: [
      /contraindicat/i,
      /do not (?:use|combine)/i,
      /should not be (?:used|taken) together/i,
      /absolute contraindication/i,
      /avoid (?:combination|co[- ]administration)/i,
    ],
  },
  {
    level: "serious",
    keywords: [
      /life[- ]?threat/i,
      /fatal/i,
      /death/i,
      /cardiac arrest/i,
      /anaphylaxis/i,
      /permanent (?:damage|disability)/i,
      /requires hospitalization/i,
      /respiratory failure/i,
    ],
  },
  {
    level: "moderate",
    keywords: [
      /serious/i,
      /severe/i,
      /major/i,
      /significant/i,
      /monitor(?: closely)?/i,
      /use with caution/i,
      /caution/i,
      /dose (?:adjustment|modification)/i,
      /risk of/i,
      /interaction/i,
    ],
  },
  {
    level: "minor",
    keywords: [
      /mild/i,
      /may cause/i,
      /limited/i,
      /minor/i,
      /transient/i,
      /generally well tolerated/i,
    ],
  },
];

export type SeverityAssessment = {
  level: SeverityLevel;
  percentage: number; // 0 - 100
  matchedLevel?: SeverityLevel;
  matchedKeyword?: string;
  matchedText?: string;
};

const DEFAULT_ASSESSMENT: SeverityAssessment = {
  level: "none",
  percentage: 0,
};

export function weightToPercentage(weight: number) {
  if (!MAX_SEVERITY_WEIGHT) return 0;
  return Math.min(100, Math.max(0, (weight / MAX_SEVERITY_WEIGHT) * 100));
}

function matchLevel(text: string): { level: SeverityLevel; keyword: string } | null {
  for (const group of KEYWORD_GROUPS) {
    for (const regex of group.keywords) {
      const match = text.match(regex);
      if (match) {
        return { level: group.level, keyword: match[0] };
      }
    }
  }
  return null;
}

export function evaluateSeverityFromTexts(texts: Array<string | undefined | null>): SeverityAssessment {
  if (!Array.isArray(texts) || texts.length === 0) return DEFAULT_ASSESSMENT;

  const levelCounts: Record<SeverityLevel, number> = {
    none: 0,
    minor: 0,
    moderate: 0,
    serious: 0,
    contraindicated: 0,
  };

  const firstMatchInfo: Partial<Record<SeverityLevel, { keyword: string; text: string }>> = {};
  let highestLevel: SeverityLevel = "none";

  for (const raw of texts) {
    if (!raw) continue;
    const text = String(raw);
    const match = matchLevel(text);
    if (!match) continue;

    levelCounts[match.level] += 1;
    if (!firstMatchInfo[match.level]) {
      firstMatchInfo[match.level] = {
        keyword: match.keyword,
        text: text.slice(0, 280),
      };
    }

    if (SEVERITY_WEIGHTS[match.level] > SEVERITY_WEIGHTS[highestLevel]) {
      highestLevel = match.level;
    }

    if (highestLevel === "contraindicated") break;
  }

  if (highestLevel === "none") {
    return DEFAULT_ASSESSMENT;
  }

  let finalLevel = highestLevel;

  if (
    finalLevel === "serious" &&
    levelCounts.serious <= 1 &&
    levelCounts.moderate >= 1
  ) {
    finalLevel = "moderate";
  } else if (
    finalLevel === "moderate" &&
    levelCounts.moderate <= 1 &&
    levelCounts.minor >= 2
  ) {
    finalLevel = "minor";
  }

  const matchedInfo =
    firstMatchInfo[finalLevel] || firstMatchInfo[highestLevel];

  return {
    level: finalLevel,
    percentage: weightToPercentage(SEVERITY_WEIGHTS[finalLevel]),
    matchedLevel: finalLevel,
    matchedKeyword: matchedInfo?.keyword,
    matchedText: matchedInfo?.text,
  };
}

export const SEVERITY_DISPLAY_META: Record<SeverityLevel, { label: string; description: string }> = {
  none: {
    label: "No interaction",
    description: "No matching warnings were detected in the fetched records.",
  },
  minor: {
    label: "Minor interaction",
    description: "May cause mild effects; usually safe but monitor if symptoms appear.",
  },
  moderate: {
    label: "Moderate interaction",
    description: "Consider dose adjustments or additional monitoring.",
  },
  serious: {
    label: "Serious interaction",
    description: "Use only under close supervision; risk of hospitalization or severe outcomes.",
  },
  contraindicated: {
    label: "Contraindicated",
    description: "Avoid this combination; alternate therapy is recommended.",
  },
};

export function formatSeveritySummary(assessment: SeverityAssessment) {
  const meta = SEVERITY_DISPLAY_META[assessment.level];
  return `${meta.label} — ${Math.round(assessment.percentage)}% of maximum severity. ${meta.description}`;
}
