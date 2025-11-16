// pages/api/check.ts
import type { NextApiRequest, NextApiResponse } from "next";

type Resp = { result: string };

const interactions: Record<string, string> = {
  // normalized keys: drug1|drug2 (alphabetical)
  "warfarin|aspirin": "High risk: Combining warfarin and aspirin increases bleeding risk. Monitor INR closely and consult a physician before concomitant use.",
  "ibuprofen|warfarin": "Moderate risk: NSAIDs like ibuprofen may increase bleeding risk when used with warfarin. Consider alternatives and monitor.",
  "clozapine|ciprofloxacin": "Significant risk: Ciprofloxacin may raise clozapine levels leading to toxicity. Dose adjustment and monitoring advised.",
  "clopidogrel|omeprazole": "Possible interaction: Omeprazole can reduce the activation of clopidogrel—use alternative PPI if necessary."
};

function normalizeKey(a?: string, b?: string) {
  const A = (a || "").trim().toLowerCase();
  const B = (b || "").trim().toLowerCase();
  if (!A && !B) return "";
  const arr = [A, B].sort();
  return arr.join("|");
}

export default function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "POST") return res.status(405).json({ result: "Method not allowed" });

  const { drugA, drugB } = req.body as { drugA?: string; drugB?: string };

  const key = normalizeKey(drugA, drugB);
  if (!key || key === "|") {
    return res.status(400).json({ result: "Please provide two drug names." });
  }

  // exact lookup
  if (interactions[key]) {
    return res.status(200).json({ result: interactions[key] });
  }

  // heuristics: check if any known token appears
  for (const mapKey of Object.keys(interactions)) {
    const [x, y] = mapKey.split("|");
    if (key.includes(x) && key.includes(y)) {
      return res.status(200).json({ result: interactions[mapKey] });
    }
  }

  // default answer
  return res.status(200).json({
    result:
      "No known major interaction found in the local database. This is a mock result — for clinical decisions, consult a healthcare professional or a dedicated drug interaction database."
  });
}
