// pages/index.tsx
import React, { useState } from "react";
import SearchField from "../components/SearchField";
import MagnifyIcon from "../components/MagnifyIcon";

export default function Home() {
  const [drugA, setDrugA] = useState("");
  const [drugB, setDrugB] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");

  async function handleCheck() {
    setResult("");
    setLoading(true);
    try {
      const resp = await fetch("/api/check-external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drugA, drugB }),
      });
      const json = await resp.json();
console.log(json);
      setResult(json.result || "No response");
    } catch (err) {
      setResult("Server error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-wrap">
      <div className="card">
        <header className="header">
          <h1>Drug Interaction Checker</h1>
          <p>Quickly check potential interactions between two drugs</p>
        </header>

        <section>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="drugA">Drug 1</label>
              <SearchField
                label=""
                value={drugA}
                onChange={setDrugA}
                placeholder="Type drug name (e.g. clobetasol)"
                id="drugA"
              />
            </div>

            <div className="field">
              <label htmlFor="drugB">Drug 2</label>
              <SearchField
                label=""
                value={drugB}
                onChange={setDrugB}
                placeholder="Type second drug name"
                id="drugB"
              />
            </div>
          </div>

          <div className="btn-wrap">
            <button
              className="btn-primary"
              onClick={handleCheck}
              disabled={loading || (!drugA && !drugB)}
              aria-label="Check drug interaction"
            >
              <MagnifyIcon size={20} />
              <span style={{ marginLeft: 6 }}>Check Interaction</span>
            </button>

            {/* Searching animation to the right of the button when loading */}
            {loading && (
              <div style={{ display: "flex", alignItems: "center", marginLeft: 12 }}>
                <div className="search-ring" aria-hidden>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M11 4a7 7 0 100 14 7 7 0 000-14z" stroke="#0b86d6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M21 21l-4.35-4.35" stroke="#0b86d6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
            )}
          </div>

          <div className="result-box" role="status" aria-live="polite">
            {result || <span style={{ color: "var(--muted)" }}>Results will appear here after you press <strong>Check Interaction</strong>.</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
