// pages/api/suggest.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { suggest } from "../../lib/provider";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const q = (req.query.q as string) || "";
    if (!q) return res.status(200).json([]);
    const results = await suggest(q);
    return res.status(200).json(results);
  } catch (err: any) {
    console.error("suggest error", err);
    return res.status(500).json({ error: "Server error" });
  }
}
