// components/SearchField.tsx
import React, { useState, useEffect, useRef } from "react";
import drugWords from "../data/drugWords";
import { debounce } from "../utils/debounce";

type Props = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
};

export default function SearchField({ label, value, onChange, placeholder = "", id }: Props) {
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // debounced remote fetch (stored in ref so it is stable across renders)
  const debouncedFetchRef = useRef(
    debounce(async (q: string, cb: (arr: string[]) => void) => {
      if (!q) return cb([]);
      try {
        const resp = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
        if (!resp.ok) return cb([]);
        const json = await resp.json();
        // json may be array of {name: '...'} or array of strings
        const arr = Array.isArray(json)
          ? json.map((x: any) => (typeof x === "string" ? x : x?.name ?? "")).filter(Boolean)
          : [];
        cb(arr);
      } catch {
        cb([]);
      }
    }, 220)
  );

  // Update matches when value changes: use local list immediately, then remote suggestions
  useEffect(() => {
    const q = (value || "").trim();
    if (!q) {
      setMatches([]);
      setActiveIndex(-1);
      return;
    }

    const ql = q.toLowerCase();

    // Local matches: prefer startsWith, then includes
    const starts = drugWords.filter((w) => w.toLowerCase().startsWith(ql));
    const includes = drugWords.filter(
      (w) => !w.toLowerCase().startsWith(ql) && w.toLowerCase().includes(ql)
    );
    const localCombined = [...starts, ...includes].slice(0, 8);

    // Initially show local matches for instant UX
    setMatches(localCombined);

    // Then fetch remote suggestions and merge (remote first, then local unique)
    let isActive = true;
    debouncedFetchRef.current(q, (remoteArr: string[]) => {
      if (!isActive) return;
      // merge remote + local preserving order and uniqueness
      const merged: string[] = [];
      for (const item of [...remoteArr, ...localCombined]) {
        const normalized = item.trim();
        if (!normalized) continue;
        if (!merged.some((m) => m.toLowerCase() === normalized.toLowerCase())) merged.push(normalized);
        if (merged.length >= 12) break;
      }
      setMatches(merged);
    });

    return () => {
      isActive = false;
    };
  }, [value]);

  // close when clicked outside
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  function applySuggestion(s: string) {
    onChange(s);
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(-1, i - 1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && matches[activeIndex]) {
        applySuggestion(matches[activeIndex]);
        e.preventDefault();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  function highlightMatch(word: string, q: string) {
    const idx = word.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return <>{word}</>;
    const before = word.slice(0, idx);
    const match = word.slice(idx, idx + q.length);
    const after = word.slice(idx + q.length);
    return (
      <>
        {before}
        <span className="match">{match}</span>
        {after}
      </>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      {/* Show label only if provided (some callers pass empty label) */}
      {label ? (
        <label htmlFor={id} className="block text-sm font-semibold text-gray-700 mb-2">
          {label}
        </label>
      ) : null}

      <input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-controls={`${id}-listbox`}
        aria-expanded={open}
        className="input-base"
        autoComplete="off"
      />

      {/* suggestions */}
      {open && matches.length > 0 && (
        <div role="listbox" id={`${id}-listbox`} className="suggestions mt-1">
          {matches.map((m, idx) => (
            <div
              key={`${m}-${idx}`}
              role="option"
              aria-selected={idx === activeIndex}
              onMouseDown={(e) => {
                // use mouseDown so input blur doesn't clear before click
                e.preventDefault();
                applySuggestion(m);
              }}
              onMouseEnter={() => setActiveIndex(idx)}
              className={`suggestion-item ${idx === activeIndex ? "active" : ""}`}
            >
              {highlightMatch(m, value)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
