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

/* ---------- openFDA check ---------- */
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
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const r: CheckResult = { result: `openFDA returned error ${res.status}`, source: "openFDA", raw: txt };
      cacheSet(key, r, 30);
      return r;
    }
    const json = await res.json();

    const totalMatches = json?.meta?.results?.total ?? 0;
    const returned = Array.isArray(json?.results) ? json.results : [];

    const reactionCounts: Record<string, number> = {};
    const seriousnessCounts: Record<string, number> = {};
    const severityTextSamples: string[] = [];
    const examples: string[] = [];

    for (const ev of returned) {
      const reactions = ev?.patient?.reaction ?? [];
      if (Array.isArray(reactions)) {
        for (const r of reactions) {
          const term =
            (typeof r?.reactionmeddrapt === "string" && r.reactionmeddrapt.trim()) ||
            (r?.reactionmeddrapt ? String(r.reactionmeddrapt).trim() : "");
          if (!term) continue;
          reactionCounts[term] = (reactionCounts[term] || 0) + 1;
          severityTextSamples.push(term);
        }
      }

      const outcome = ev?.serious ?? ev?.outcome ?? ev?.seriousness ?? null;
      const sKey = String(outcome ?? (ev?.seriousnessdeath ? "death" : "unknown"));
      seriousnessCounts[sKey] = (seriousnessCounts[sKey] || 0) + 1;

      if (ev?.seriousnessdeath === "1") severityTextSamples.push("death");
      if (ev?.seriousnesshospitalization === "1") severityTextSamples.push("hospitalization");
      if (ev?.serious === "1") severityTextSamples.push("serious");

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
          const reactionList = (Array.isArray(reactions) ? reactions.map((r: any) => r?.reactionmeddrapt).filter(Boolean) : []).slice(0, 6);
          const reportId = ev?.safetyreportid ?? ev?.safetyreportid;
          const example = `Case ${reportId ?? "(id N/A)"} — ${age}, ${sex}. Reactions: ${
            reactionList.length ? reactionList.join(", ") : "N/A"
          }.`;
          examples.push(example);
        } catch (err) {
          // ignore
        }
      }
    }

    const reactionEntries = Object.entries(reactionCounts);
    reactionEntries.sort((a, b) => b[1] - a[1]);
    const topReactions = reactionEntries.slice(0, 5);

    const severityAssessment = evaluateSeverityFromTexts([
      ...severityTextSamples,
      ...topReactions.map(([term]) => term),
    ]);

    let summary = `Severity assessment: ${formatSeveritySummary(severityAssessment)}\n\n`;
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

    const seriousEntries = Object.entries(seriousnessCounts);
    if (seriousEntries.length > 0) {
      summary += `Seriousness / outcome distribution among fetched records:\n`;
      for (const [k, v] of seriousEntries) {
        summary += ` • ${k}: ${v}\n`;
      }
      summary += `\n`;
    }

    if (examples.length > 0) {
      summary += `Example case(s):\n`;
      for (const ex of examples) summary += ` • ${ex}\n`;
      summary += `\n`;
    }

    summary += `Note: this is an automated, non-clinical summary from openFDA records. For clinical decisions consult a professional and full databases.\n`;

    const out: CheckResult = {
      result: summary,
      source: "openFDA",
      raw: {
        meta: json?.meta ?? null,
        sample_count: returned.length,
        sample_records_head: returned.slice(0, 6),
        top_reactions: topReactions,
        seriousnessCounts,
      },
      severity: { ...severityAssessment, totalReports: totalMatches },
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
