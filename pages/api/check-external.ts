// pages/api/check-external.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { runProviderCheck } from "../../lib/provider";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { drugA, drugB } = req.body;

    if (!drugA || !drugB) {
      return res.status(400).json({ error: "Both drugA and drugB required" });
    }

    const result = await runProviderCheck(drugA, drugB);

    // Guarantee a proper JSON structure
    return res.status(200).json({
      ok: true,
      result: result?.result ?? "No result text.",
      raw: result?.raw ?? {},
      source: result?.source ?? "unknown",
      severity: result?.severity ?? null,
    });

  } catch (err: any) {
    console.error("API ERROR /check-external:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message ?? "Server crashed",
    });
  }
}
