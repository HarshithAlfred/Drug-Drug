// pages/index.tsx
import React, { useMemo, useState } from "react";
import SearchField from "../components/SearchField";
import MagnifyIcon from "../components/MagnifyIcon";
import {
  formatSeveritySummary,
  SEVERITY_DISPLAY_META,
  SeverityAssessment,
  SeverityLevel,
} from "../utils/severity";

type SeverityPayload = (SeverityAssessment & { totalReports?: number }) | null;

const severityClassMap: Record<SeverityLevel, string> = {
  none: "severity-none",
  minor: "severity-minor",
  moderate: "severity-moderate",
  serious: "severity-serious",
  contraindicated: "severity-contra",
};

const defaultAssessment: SeverityAssessment = { level: "none", percentage: 0 };

export default function Home() {
  const [drugA, setDrugA] = useState("");
  const [drugB, setDrugB] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");
  const [severity, setSeverity] = useState<SeverityPayload>(null);

  const disableCheck = loading || !drugA || !drugB;

  async function handleCheck() {
    if (!drugA || !drugB) return;
    setResult("");
    setSeverity(null);
    setLoading(true);
    try {
      const resp = await fetch("/api/check-external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drugA, drugB }),
      });

      if (!resp.ok) {
        throw new Error(`Request failed with status ${resp.status}`);
      }

      const json = await resp.json();
      setResult(json?.result || "No response");
      setSeverity(json?.severity ?? null);
    } catch (err) {
      console.error("check interaction failed", err);
      setResult("Server error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const severityAssessment = useMemo(
    () => severity ?? defaultAssessment,
    [severity]
  );

  const severityLevel = severityAssessment.level ?? "none";
  const severitySummary = useMemo(
    () => formatSeveritySummary(severityAssessment),
    [severityAssessment]
  );
  const severityMeta = SEVERITY_DISPLAY_META[severityLevel];
  const severityPercent = Math.round(severityAssessment.percentage);
  const reportsCopy = severity?.totalReports
    ? `Total matching FDA reports: ${severity.totalReports}`
    : "No matching FDA reports yet for this combination.";
  const resultClassName = `results ${severityClassMap[severityLevel]}`;

  return (
    <main className="page-wrap">
      <div className="hero-container">
        <div className="container">
          <h1>Drug Safety Interaction Checker</h1>
          <p className="subtitle">Quickly check potential interactions between two drugs</p>

          <div className="card interaction-card">
            <div className="input-group">
              <div className="input-box">
                <label htmlFor="drugA">Drug 1</label>
                <SearchField
                  label=""
                  value={drugA}
                  onChange={setDrugA}
                  placeholder="Type drug name (e.g., Clobetasol)"
                  id="drugA"
                />
              </div>

              <div className="input-box">
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

            <div className="btn-row">
              <button
                type="button"
                className={`btn ${loading ? "loading" : ""}`}
                onClick={handleCheck}
                disabled={disableCheck}
                aria-label="Check drug interaction"
              >
                <span className="btn-content">
                  <span className="btn-icon" aria-hidden>
                    <MagnifyIcon size={18} />
                  </span>
                  <span className="btn-label">Check Interaction</span>
                  <span className="drug-loader" aria-hidden>
                    <span className="pill pill-blue" />
                    <span className="pill pill-pink" />
                  </span>
                </span>
              </button>
            </div>

            <div className={resultClassName} role="status" aria-live="polite">
              {result ? (
                <div>
                <div className="results-heading">
                <span className="results-level">{severityMeta.label}</span>
                <span className="results-percent">{severityPercent}%</span>
               </div>
              <p className="results-summary">{severitySummary}</p>
              <p className="results-hint">{reportsCopy}</p>
               </div>
              ):null}
              {severity?.matchedKeyword ? (
                <p className="results-hint">
                  Matched keyword “{severity.matchedKeyword}” in FDA text.
                </p>
              ) : null} 
              
                {result ? (
                  <div className="results-body">
                  <pre className="results-text">{
                    (result === "openFDA returned error 404")? "The Drugs can be be taken together 😊.":(result)
                      
                  
                    }</pre>
                    </div>
                ) : (
                  <span>
                    Results will appear here after you press <strong>Check Interaction</strong>.
                  </span>
                )}
              
            </div>
          </div>
        </div>

        <hr className="section-divider" />

        <section className="about-section">
          <h2>About This Project</h2>

          <p className="about-desc">
            The <strong>Drug Interaction Checker</strong> is a modern medical safety tool that instantly analyzes
            whether two medications can be safely taken together. It translates complex pharmacological
            interaction data into simple, color-coded results that anyone can understand — from doctors to everyday users.
          </p>

          <h3>What It Does</h3>
          <ul>
            <li>Accepts two drug names and checks for possible interactions</li>
            <li>Classifies results into <strong>Safe</strong>, <strong>Moderate</strong>, <strong>Serious</strong>, <strong>Contraindicated</strong></li>
            <li>Displays clinically relevant information instantly</li>
            <li>No login or signup required</li>
          </ul>

          <h3>Severity Levels</h3>
          <table className="severity-table">
            <thead>
              <tr>
                <th>Level</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>🔵 SAFE</td>
                <td>No known harmful interaction.</td>
              </tr>
              <tr>
                <td>🟢 MINOR</td>
                <td>Very Minor interaction; unlikely to cause harm.</td>
              </tr>
              <tr>
                <td>🟡 MODERATE</td>
                <td>Can be used with caution or dose monitoring.</td>
              </tr>
              <tr>
                <td>🟠 SERIOUS</td>
                <td>Requires close medical supervision.</td>
              </tr>
              <tr>
                <td>🔴 CONTRA</td>
                <td>Should not be combined; seek alternative therapy.</td>
              </tr>
            </tbody>
          </table>

          <h3>Why It Matters</h3>
          <p>
            Over <strong>40% of adults</strong> take multiple medications. Many drug combinations may cause severe side-effects,
            reduced effectiveness, or life-threatening reactions. This tool helps prevent medication errors by providing instant safety insights.
          </p>

          <h3>Technology Behind It</h3>
          <ul>
            <li>Next.js + TypeScript front-end with custom autocomplete</li>
            <li>An DeepLearning model MLP for real-world interaction Prediction</li>
            <li>Server-side caching to keep responses fast and reliable</li>
            <li>Severity engine that maps regulatory language into clear scores</li>
          </ul>

          <p className="about-footer">
            This project is built to bridge the gap between clinical knowledge and accessible technology — making medication safety faster and easier for everyone.
          </p>
        </section>
      </div>
    </main>
  );
}
