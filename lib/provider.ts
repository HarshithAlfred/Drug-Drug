// inside lib/provider.ts — replace the previous openfdaCheck implementation with this
import NodeCache from "node-cache";

type SuggestResult = { name: string }[] | string[];
type CheckResult = { result: string; source?: string; raw?: any };

const CACHE_TTL = Number(process.env.CACHE_TTL || 3600);
const cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 120 });

// cache helpers
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

// inside lib/provider.ts — replace the previous openfdaCheck implementation with this fixed version

async function openfdaCheck(drugA: string, drugB: string): Promise<CheckResult> {
  const key = `openfda:check:${drugA}|${drugB}`;
  const cached = cacheGet<CheckResult>(key);
  if (cached) return cached;

  const apiKey = process.env.OPENFDA_API_KEY || "";
  const parts: string[] = [];
  if (drugA) parts.push(`patient.drug.medicinalproduct:"${drugA}"`);
  if (drugB) parts.push(`patient.drug.medicinalproduct:"${drugB}"`);
  const search = parts.join("+AND+");
  const limit = 100;
  const url = `https://api.fda.gov/drug/event.json?api_key=${encodeURIComponent(apiKey)}&search=${search}&limit=${limit}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      const r = { result: `openFDA returned an error: ${res.status}`, source: "openFDA", raw: text };
      cacheSet(key, r, 30);
      return r;
    }
    const json = await res.json();

    const totalMatches = json?.meta?.results?.total ?? 0;
    const returned = Array.isArray(json?.results) ? json.results : [];

    const reactionCounts: Record<string, number> = {};
    const seriousnessCounts: Record<string, number> = {};
    let examples: string[] = [];

    for (const ev of returned) {
      const reactions = ev?.patient?.reaction ?? [];
      if (Array.isArray(reactions)) {
        for (const r of reactions) {
          const term =
            (typeof r?.reactionmeddrapt === "string" && r.reactionmeddrapt.trim()) ||
            (r?.reactionmeddrapt ? String(r.reactionmeddrapt).trim() : "");
          if (!term) continue;
          reactionCounts[term] = (reactionCounts[term] || 0) + 1;
        }
      }

      // avoid mixing ?? and || without parentheses
      const serious = (ev?.serious ?? ev?.seriousness) || ev?.patient?.serious || null;

      // outcome heuristic
      const outcome = ev?.serious || ev?.outcome || ev?.seriousness || null;
      const sKey = String(outcome ?? (ev?.seriousnessdeath ? "death" : "unknown"));
      seriousnessCounts[sKey] = (seriousnessCounts[sKey] || 0) + 1;

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
          const example = `Case ${reportId ?? "(id N/A)"} — ${age}, ${sex}. Reactions: ${reactionList.join(", ") || "N/A"}.`;
          examples.push(example);
        } catch (e) {
          // ignore
        }
      }
    }

    const reactionEntries = Object.entries(reactionCounts);
    reactionEntries.sort((a, b) => b[1] - a[1]);
    const topReactions = reactionEntries.slice(0, 5);

    let summary = `openFDA: found ${totalMatches} matching adverse-event reports for the queried products (showing analysis of up to ${returned.length} recent reports).\n\n`;

    if (topReactions.length > 0) {
      summary += `Top reported reactions (top ${topReactions.length}):\n`;
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

    const out = {
      result: summary,
      source: "openFDA",
      raw: {
        meta: json?.meta ?? null,
        sample_count: returned.length,
        sample_records_head: returned.slice(0, 6),
        top_reactions: topReactions, // also expose structured top reactions
        seriousnessCounts,
      },
    };

    cacheSet(key, out, Math.max(60, CACHE_TTL));
    return out;
  } catch (err: any) {
    const r = { result: `openFDA fetch failed: ${err?.message ?? String(err)}`, source: "openFDA", raw: null };
    cacheSet(key, r, 30);
    return r;
  }
}
export async function runProviderCheck(drugA: string, drugB: string) {
  return openfdaCheck(drugA, drugB);
}


