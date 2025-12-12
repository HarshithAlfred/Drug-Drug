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

const severityLabelClassMap: Record<SeverityLevel, string> = {
  none: "severity-text-none",
  minor: "severity-text-minor",
  moderate: "severity-text-moderate",
  serious: "severity-text-serious",
  contraindicated: "severity-text-contra",
};

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

  const severitySummary = useMemo(
    () => (severity ? formatSeveritySummary(severity) : null),
    [severity]
  );

  const severityMeta = severity ? SEVERITY_DISPLAY_META[severity.level] : null;
  const reportsCopy = severity
    ? severity.totalReports
      ? `Total matching FDA reports: ${severity.totalReports}`
      : "No matching FDA reports yet for this combination."
    : null;
  const severityLevelClass = severity ? severityLabelClassMap[severity.level] : "";
  const resultClassName = "results";
  const showPlaceholder = !severity && !result;
  const showNoInteractionWarning = Boolean(severity) && severity?.level === "none";

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
                  placeholder="Type drug name (e.g., Aspirine)"
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
              {severityMeta && severitySummary ? (
                <>
                  <div className="results-heading">
                    <span className={`results-level ${severityLevelClass}`}>
                      {severityMeta.label}
                    </span>
                  </div>
                  <p className="results-summary">{severitySummary}</p>
                  {reportsCopy ? <p className="results-hint">{reportsCopy}</p> : null}
                  {severity?.matchedKeyword ? (
                    <p className="results-hint">
                      Matched keyword “{severity.matchedKeyword}” in FDA text.
                    </p>
                  ) : null}
                  {showNoInteractionWarning ? (
                    <div className="no-interactions-error" role="alert">
                      <div className="error-box">
                        <svg
                          className="exclamation-error"
                          viewBox="0 0 20 20"
                          aria-hidden="true"
                        >
                          <path
                            fill="currentColor"
                            d="M10 1.5a1 1 0 0 1 .88.51l8.5 14.73A1 1 0 0 1 18.5 18H1.5a1 1 0 0 1-.88-1.26l8.5-14.73A1 1 0 0 1 10 1.5Zm0 4.1a.9.9 0 0 0-.9.97l.3 5.32a.6.6 0 0 0 1.2 0l.3-5.32A.9.9 0 0 0 10 5.6Zm0 8.4a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z"
                          />
                        </svg>
                        <span className="error-message">
                          <p className="warning">Warning:</p>
                          <p className="warning-text">
                            There were no interactions found. It does not necessarily mean that no interactions exist.
                          </p>
                        </span>
                      </div>
                    </div>
                  ) : null}
                  
                </>
              ) : showPlaceholder ? (
                <p className="results-hint">
                  Results will appear here after you press <strong>Check Interaction</strong>.
                </p>
              ) : null}
              <div className="results-body">
                {result ? (
                  <pre className="results-text">{result}</pre>
                ) : showPlaceholder ? (
                  <span>
                   </span>
                ) : null}
              </div>
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
            <li>Classifies results into <strong>Safe</strong>, <strong>Moderate</strong>, <strong>Serious</strong>, or <strong>Contraindicated</strong></li>
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
            <li>An DeepLearning model MLP for real-world interaction Perdiction</li>
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
