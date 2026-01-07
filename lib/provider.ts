// lib/provider.ts
import NodeCache from "node-cache";
import {
  evaluateSeverityFromTexts,
  formatSeveritySummary,
  SeverityAssessment,
} from "../utils/severity";

type SuggestResult = { name: string }[] | string[];
type CheckResult = {
  result: string;
  source?: string;
  raw?: any;
  severity?: SeverityAssessment & { totalReports: number };
};

const CACHE_TTL = Number(process.env.CACHE_TTL || 3600);
const cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 120 });

// helpers
function cacheGet<T>(key: string): T | undefined {
  try {
    return cache.get<T>(key);
  } catch (err) {
    console.error("cacheGet error:", err);
    return undefined;
  }
}
function cacheSet<T>(key: string, val: T, ttl?: number) {
  try {
    cache.set(key, val, ttl ?? CACHE_TTL);
  } catch (err) {
    console.error("cacheSet error:", err);
  }
}

/* ---------- RXNORM SUGGEST (default) ---------- */
const RXNORM_BASE = process.env.RXNORM_BASE || "https://rxnav.nlm.nih.gov/REST";

export async function rxnormSuggest(q: string): Promise<SuggestResult> {
  const query = String(q || "").trim();
  const key = `rxn:suggest:${query}`;
  const cached = cacheGet<SuggestResult>(key);
  if (cached) return cached;

  if (!query) return [];

  try {
    const url = `${RXNORM_BASE}/displaynames.json?name=${encodeURIComponent(query)}&allsrc=1&maxEntries=20`;
    const res = await fetch(url);
    if (!res.ok) {
      cacheSet(key, []);
      return [];
    }
    const json = await res.json();
    const names: string[] = (json?.displayTermList?.displayTerm || []).slice(0, 20);
    const out = names.map((n: string) => ({ name: String(n) }));
    cacheSet(key, out);
    return out;
  } catch (err) {
    console.error("rxnormSuggest error:", err);
    cacheSet(key, []);
    return [];
  }
}

/* ---------- OPENFDA CHECK ---------- */
export type SeverityLevel = "none" | "minor" | "moderate" | "serious" | "contraindicated";

export const SEVERITY_WEIGHTS: Record<SeverityLevel, number> = {
  none: 0,
  minor: 1,
  moderate: 2,
  serious: 3,
  contraindicated: 4,
};

export const MAX_SEVERITY_WEIGHT = Math.max(...Object.values(SEVERITY_WEIGHTS));

export async function openfdaCheck(drugA: string, drugB: string): Promise<CheckResult> {
  const a = (drugA || "").trim();
  const b = (drugB || "").trim();
  const key = `openfda:check:${a}|${b}`;
  const cached = cacheGet<CheckResult>(key);
  if (cached) return cached;

  if (!a && !b) {
    const out: CheckResult = { result: "Please provide at least one drug name.", source: "openFDA", raw: {} };
    cacheSet(key, out, 30);
    return out;
  }

  try {
    const apiKey = process.env.OPENFDA_API_KEY || "";
    const parts: string[] = [];
    if (a) parts.push(`patient.drug.medicinalproduct:"${a}"`);
    if (b) parts.push(`patient.drug.medicinalproduct:"${b}"`);
    const search = parts.join("+AND+");
    const limit = 100;
    const url = `https://api.fda.gov/drug/event.json?api_key=${encodeURIComponent(apiKey)}&search=${search}&limit=${limit}`;

    const res = await fetch(url);
    if (res.status === 404) {
      const message =
        "There were no interactions found. It does not necessarily mean that no interactions exist. Prediction returned no matching adverse-event reports for the requested combination.";
      const finalSeverity: SeverityAssessment = { level: "none" };
      const out: CheckResult = {
        result: message,
        source: "Model",
        raw: { status: 404, body: await res.text().catch(() => null) },
        severity: { ...finalSeverity, totalReports: 0 },
      };
      cacheSet(key, out, 60);
      return out;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const r: CheckResult = { result: `Prediction returned error ${res.status}`, source: "Model", raw: txt };
      cacheSet(key, r, 30);
      return r;
    }
    const json = await res.json();

    const totalMatches = json?.meta?.results?.total ?? 0;
    const returned = Array.isArray(json?.results) ? json.results : [];

    // counters for severity flags and reactions
    let totalFetched = returned.length;
    let deathCount = 0;
    let lifeThreatCount = 0;
    let seriousCount = 0; // any event with serious === "1"
    let hospCount = 0;
    let disablingCount = 0;
    let otherSeriousCount = 0;
    let nonSeriousButWithReactions = 0;

    const reactionCounts: Record<string, number> = {};
    const severityTextSamples: string[] = [];
    const examples: string[] = [];

    for (const ev of returned) {
      const reactions = Array.isArray(ev?.patient?.reaction) ? ev.patient.reaction : [];

      // accumulate reaction terms
      for (const r of reactions) {
        const term =
          (typeof r?.reactionmeddrapt === "string" && r.reactionmeddrapt.trim()) ||
          (r?.reactionmeddrapt ? String(r.reactionmeddrapt).trim() : "");
        if (!term) continue;
        reactionCounts[term] = (reactionCounts[term] || 0) + 1;
        severityTextSamples.push(term);
      }

      // Normalize flags - openFDA sometimes uses "1"/"0" strings
      const isSerious = String(ev?.serious ?? "") === "1";
      if (isSerious) seriousCount++;

      if (String(ev?.seriousnessdeath ?? "") === "1") {
        deathCount++;
        severityTextSamples.push("death");
      }
      if (String(ev?.seriousnesslifethreatening ?? "") === "1") {
        lifeThreatCount++;
        severityTextSamples.push("life-threatening");
      }
      if (String(ev?.seriousnesshospitalization ?? "") === "1") {
        hospCount++;
        severityTextSamples.push("hospitalization");
      }
      if (String(ev?.seriousnessdisabling ?? "") === "1") {
        disablingCount++;
        severityTextSamples.push("disabling");
      }
      if (String(ev?.seriousnessother ?? "") === "1") {
        otherSeriousCount++;
        severityTextSamples.push("other-serious");
      }

      if (!isSerious && reactions.length > 0) {
        nonSeriousButWithReactions++;
      }

      // keep a couple example rows (same format as earlier)
      if (examples.length < 2) {
        try {
          const age =
            ev?.patient?.patientonsetage !== undefined && ev?.patient?.patientonsetage !== null
              ? `${ev.patient.patientonsetage} ${ev.patient.patientonsetageunit || ""}`.trim()
              : "unknown age";
          const sex =
            ev?.patient?.patientsex !== undefined && ev?.patient?.patientsex !== null
              ? ev.patient.patientsex === "1"
                ? "male"
                : ev.patient.patientsex === "2"
                ? "female"
                : String(ev.patient.patientsex)
              : "unknown sex";
          const reactionList = (reactions).map((r: any) => r?.reactionmeddrapt).filter(Boolean).slice(0, 6);
          const reportId = ev?.safetyreportid ?? "(id N/A)";
          const example = `Case ${reportId} — ${age}, ${sex}. Reactions: ${
            reactionList.length ? reactionList.join(", ") : "N/A"
          }.`;
          examples.push(example);
        } catch (err) {
          // ignore
        }
      }
    }

    // prepare top reactions
    const reactionEntries = Object.entries(reactionCounts);
    reactionEntries.sort((a, b) => b[1] - a[1]);
    const topReactions = reactionEntries.slice(0, 5);

    // compute aggregate severity using weights across records (counts-based)
    const aggSeverity = computeAggregateSeverity(totalFetched, {
      death: deathCount,
      lifeThreat: lifeThreatCount,
      serious: seriousCount,
      hospitalization: hospCount,
      disabling: disablingCount,
      otherSerious: otherSeriousCount,
      nonSeriousReactions: nonSeriousButWithReactions,
    });

    // also get text-based assessment for enrichment (not authoritative)
    const textAssessment = evaluateSeverityFromTexts([
      ...severityTextSamples,
      ...topReactions.map(([term]) => term),
    ]);

    // choose final severity: prefer aggregated counts; if text escalates beyond a threshold, note it
    let finalSeverity = aggSeverity;
    // if (SEVERITY_WEIGHTS[textAssessment.level] > SEVERITY_WEIGHTS[finalSeverity.level]) {
    //   // only escalate if text's weight is strictly higher and percentage is non-trivial
    //   if (textAssessment.percentage >= 40) {
    //     finalSeverity = {
    //       level: textAssessment.level,
    //       percentage: Math.max(finalSeverity.percentage, textAssessment.percentage),
    //       matchedLevel: textAssessment.matchedLevel,
    //       matchedKeyword: textAssessment.matchedKeyword,
    //       matchedText: textAssessment.matchedText,
    //     };
    //   } else {
    //     // keep aggSeverity but preserve text match info in matchedText
    //     finalSeverity = { ...finalSeverity, matchedText: textAssessment.matchedText, matchedKeyword: textAssessment.matchedKeyword };
    //   }
    // }

    // build summary
    let summary = `Severity assessment: ${formatSeveritySummary(finalSeverity)}\n\n`;
    summary += `openFDA: found ${totalMatches} matching adverse-event reports for the queried products (analyzing up to ${returned.length} records).\n\n`;

    if (topReactions.length > 0) {
      summary += `Top reported reactions:\n`;
      for (const [term, cnt] of topReactions) {
        const pct = returned.length > 0 ? ((cnt / Math.max(returned.length, 1)) * 100).toFixed(1) : "0.0";
        summary += ` • ${term}: ${cnt} reports (~${pct}% of fetched records)\n`;
      }
      summary += `\n`;
    } else {
      summary += `No individual reactions extracted from the fetched records.\n\n`;
    }

    summary += `Seriousness / outcome counts in fetched records:\n`;
    summary += ` • serious(flag): ${seriousCount}\n`;
    summary += ` • hospitalization: ${hospCount}\n`;
    summary += ` • disabling: ${disablingCount}\n`;
    summary += ` • life-threatening: ${lifeThreatCount}\n`;
    summary += ` • death: ${deathCount}\n\n`;

    if (examples.length > 0) {
      summary += `Example case(s):\n`;
      for (const ex of examples) summary += ` • ${ex}\n`;
      summary += `\n`;
    }

    summary += `Note: this is an automated, non-clinical summary from Model. For clinical decisions consult a professional .\n`;

    const out: CheckResult = {
      result: summary,
      source: "Model",
      raw: {
        meta: json?.meta ?? null,
        sample_count: returned.length,
        sample_records_head: returned.slice(0, 6),
        top_reactions: topReactions,
        counts: {
          totalFetched,
          deathCount,
          lifeThreatCount,
          seriousCount,
          hospCount,
          disablingCount,
          otherSeriousCount,
          nonSeriousButWithReactions,
        },
      },
      severity: { ...finalSeverity, totalReports: totalMatches },
    };

    cacheSet(key, out, Math.max(60, CACHE_TTL));
    return out;
  } catch (err: any) {
    console.error("openfdaCheck failed:", err);
    const r: CheckResult = { result: `openFDA fetch failed: ${err?.message ?? String(err)}`, source: "openFDA", raw: null };
    cacheSet(key, r, 30);
    return r;
  }
}

// --- Helper: computeAggregateSeverity (counts -> continuous percentage + level) ---

// Wilson score lower bound for proportion (confidence 95%)
function wilsonLowerBound(successes: number, trials: number, z = 1.96): number {
  if (trials === 0) return 0;
  const phat = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const centre = phat + z2 / (2 * trials);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * trials)) / trials);
  const lower = (centre - margin) / denom;
  console.log("wilsonLowerBound:", { successes, trials, phat, lower });
  console.log("wilsonLowerBound debug:", { centre, margin, denom });
  return Math.max(0, lower);
}

function computeAggregateSeverity(
  total: number,
  counts: {
    death: number;
    lifeThreat: number;
    serious: number;
    hospitalization: number;
    disabling: number;
    otherSerious: number;
    nonSeriousReactions: number;
  }
): SeverityAssessment {
  if (!total || total <= 0) {
    return { level: "none" };
  }

  // conservative escalation rules for death/life-threat
  const deathRatio = counts.death / total;
  const lifeThreatRatio = counts.lifeThreat / total;
  const criticalByCount = counts.death >= 12 || counts.lifeThreat >= 6;
  const criticalByRatio = deathRatio >= 0.12 || lifeThreatRatio >= 0.06; // 6%

  // compute conservative serious proportion using Wilson lower bound (95% CI)
  const seriousLower = wilsonLowerBound(counts.serious, total, 1.96); // value in [0,1]
  const seriousPctLower = Math.round(seriousLower * 100);

  // immediate escalation to contraindicated only if conservative death/life-threat thresholds met
  // if (criticalByCount || criticalByRatio) {
  //   return { level: "contraindicated", percentage: 100, matchedLevel: "contraindicated", matchedText: `death:${counts.death},lifeThreat:${counts.lifeThreat}`, };
  // }

  // map seriousLower into bands (tunable)
  // minor: >=5%, moderate: >=20%, serious: >=50%, contra: >=75%
  console.log("computeAggregateSeverity:", { seriousLower, seriousPctLower });
  if (seriousLower >= 0.75) {
    return { level: "contraindicated", matchedLevel: "contraindicated" };
  }
  if (seriousLower >= 0.50) {
    return { level: "serious", matchedLevel: "serious" };
  }
  if (seriousLower >= 0.20) {
    return { level: "moderate", matchedLevel: "moderate" };
  }
  if (seriousLower >= 0.05) {
    return { level: "minor", matchedLevel: "minor" };
  }

  return { level: "none", matchedLevel: "none" };

}




/* ---------- Lexigram extract (optional) ---------- */
export async function lexigramExtract(text: string): Promise<CheckResult> {
  const key = `lexigram:extract:${text}`;
  const cached = cacheGet<CheckResult>(key);
  if (cached) return cached;

  const API_KEY = process.env.LEXIGRAM_API_KEY;
  if (!API_KEY) {
    const r: CheckResult = { result: "Missing Lexigram API key", source: "lexigram" };
    cacheSet(key, r, 60);
    return r;
  }

  try {
    const tokenRes = await fetch("https://api.lexigram.io/v1/auth/token", {
      method: "GET",
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (!tokenRes.ok) {
      const txt = await tokenRes.text().catch(() => "");
      const r: CheckResult = { result: `Lexigram token error: ${tokenRes.status}`, source: "lexigram", raw: txt };
      cacheSet(key, r, 30);
      return r;
    }
    const tokenJson = await tokenRes.json();
    const token = tokenJson?.token;
    if (!token) {
      const r: CheckResult = { result: "Lexigram token missing", source: "lexigram", raw: tokenJson };
      cacheSet(key, r, 30);
      return r;
    }

    const extractRes = await fetch("https://api.lexigram.io/v4/extract/entities", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text, withContext: true, withText: false }),
    });

    if (!extractRes.ok) {
      const txt = await extractRes.text().catch(() => "");
      const r: CheckResult = { result: `Lexigram extract error: ${extractRes.status}`, source: "lexigram", raw: txt };
      cacheSet(key, r, 30);
      return r;
    }

    const json = await extractRes.json();
    const r: CheckResult = { result: "Lexigram extract OK", source: "lexigram", raw: json };
    cacheSet(key, r);
    return r;
  } catch (err: any) {
    console.error("lexigramExtract failed:", err);
    const r: CheckResult = { result: `Lexigram failed: ${err?.message ?? String(err)}`, source: "lexigram", raw: null };
    cacheSet(key, r, 30);
    return r;
  }
}

/* ---------- Dispatcher + public exports ---------- */

/**
 * suggest - named export used by pages/api/suggest.ts
 * Returns array of {name} or strings.
 */
export async function suggest(q: string): Promise<SuggestResult> {
  const query = String(q || "").trim();
  if (!query) return [];
  const provider = (process.env.PROVIDER || "rxnorm").toLowerCase();
  try {
    if (provider === "rxnorm") return await rxnormSuggest(query);
    if (provider === "openfda") return await rxnormSuggest(query);
    if (provider === "lexigram") return await rxnormSuggest(query);
    return await rxnormSuggest(query);
  } catch (err) {
    console.error("suggest dispatch error:", err);
    return [];
  }
}

/**
 * checkExternal / runProviderCheck - used by pages/api/check-external.ts
 */
export async function checkExternal(drugA: string, drugB: string): Promise<CheckResult> {
  const provider = (process.env.PROVIDER || "rxnorm").toLowerCase();
  const a = (drugA || "").trim();
  const b = (drugB || "").trim();

  try {
    if (provider === "openfda") return await openfdaCheck(a, b);
    if (provider === "lexigram") return await lexigramExtract(`${a} ${b}`.trim());
    // default: openfda analysis for interactions
    return await openfdaCheck(a, b);
  } catch (err) {
    console.error("checkExternal failed:", err);
    return { result: `Provider check failed: ${String(err)}`, source: "error", raw: null };
  }
}

/**
 * runProviderCheck - thin wrapper exported for API route clarity
 */
export async function runProviderCheck(drugA: string, drugB: string) {
  return await checkExternal(drugA, drugB);
}
