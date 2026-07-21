"use client";

import { useEffect, useRef, useState } from "react";
import {
  searchOwner,
  getAddressSuggestions,
  getSearchHistory,
  getSearchHistoryDetail,
  type SearchCandidate,
  type AddressSuggestion,
  type SearchHistoryItem,
} from "@/lib/api";
import { CandidateCard } from "@/components/CandidateCard";

export default function Home() {
  const [ownerName, setOwnerName] = useState("");
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRequestId = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<SearchCandidate[] | null>(null);
  const [otherPossibleMatches, setOtherPossibleMatches] = useState<SearchCandidate[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyActionId, setHistoryActionId] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  async function refreshHistory() {
    setHistoryLoading(true);
    try {
      const items = await getSearchHistory();
      setHistory(items);
    } catch {
      // Non-critical — the search form still works without history.
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    refreshHistory();
  }, []);

  useEffect(() => {
    if (address.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    const requestId = ++suggestionsRequestId.current;
    const timeoutId = setTimeout(async () => {
      try {
        const results = await getAddressSuggestions(address);
        if (requestId === suggestionsRequestId.current) {
          setSuggestions(results);
        }
      } catch {
        if (requestId === suggestionsRequestId.current) {
          setSuggestions([]);
        }
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [address]);

  function handleSelectSuggestion(suggestion: AddressSuggestion) {
    setAddress(suggestion.description);
    setSuggestions([]);
    setShowSuggestions(false);
  }

  async function runSearch(name: string, addr: string) {
    setLoading(true);
    setError(null);
    setCandidates(null);
    setOtherPossibleMatches([]);
    try {
      const result = await searchOwner(name, addr);
      setCandidates(result.candidates);
      setOtherPossibleMatches(result.otherPossibleMatches);
      setWarnings(result.warnings);
    } catch {
      setError("Something went wrong reaching the search API. Is the backend running?");
    } finally {
      setLoading(false);
      refreshHistory();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await runSearch(ownerName, address);
  }

  /** Re-runs a past search immediately using its saved name/address, so the
   * user doesn't have to retype anything. */
  async function handleSearchAgain(item: SearchHistoryItem) {
    setOwnerName(item.ownerName);
    setAddress(item.propertyAddress ?? "");
    setHistoryActionId(item.id);
    try {
      await runSearch(item.ownerName, item.propertyAddress ?? "");
    } finally {
      setHistoryActionId(null);
    }
  }

  /** Loads a past search's already-saved results without calling MBIE/AI
   * search again. */
  async function handleViewSaved(item: SearchHistoryItem) {
    setHistoryActionId(item.id);
    setError(null);
    try {
      const detail = await getSearchHistoryDetail(item.id);
      setOwnerName(detail.ownerName);
      setAddress(detail.propertyAddress ?? "");
      if (detail.result) {
        setCandidates(detail.result.candidates);
        setOtherPossibleMatches(detail.result.otherPossibleMatches);
        setWarnings(detail.result.warnings);
      } else {
        setCandidates(null);
        setOtherPossibleMatches([]);
        setWarnings([]);
        setError(detail.errorMessage ?? "This saved search has no stored results.");
      }
    } catch {
      setError("Couldn't load that saved search.");
    } finally {
      setHistoryActionId(null);
    }
  }

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">
          Property Owner Contact Finder
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Enter a property owner&apos;s name and address to search MBIE company
          records, AI-powered web search, and other public sources for
          possible contact leads.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <div>
            <label htmlFor="ownerName" className="text-sm font-medium">
              Owner name
            </label>
            <input
              id="ownerName"
              required
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="e.g. John Smith"
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div className="relative">
            <label htmlFor="address" className="text-sm font-medium">
              Property address
            </label>
            <input
              id="address"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => {
                // Delay so a click on a suggestion registers before the list hides.
                setTimeout(() => setShowSuggestions(false), 150);
              }}
              autoComplete="off"
              placeholder="e.g. 12 Queen St, Auckland"
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-md border border-zinc-300 bg-white text-sm shadow-md dark:border-zinc-700 dark:bg-zinc-900">
                {suggestions.map((s) => (
                  <li key={s.placeId}>
                    <button
                      type="button"
                      onClick={() => handleSelectSuggestion(s)}
                      className="block w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      {s.description}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-zinc-500">
              Address suggestions are powered by Google Places (New Zealand
              addresses only).
            </p>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        <section className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setHistoryExpanded((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <h2 className="text-sm font-medium">
              Recent searches{history.length > 0 ? ` (${history.length})` : ""}
            </h2>
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${historyExpanded ? "rotate-180" : ""}`}
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          {historyExpanded && historyLoading && history.length === 0 && (
            <p className="mt-2 text-sm text-zinc-500">Loading…</p>
          )}
          {historyExpanded && !historyLoading && history.length === 0 && (
            <p className="mt-2 text-sm text-zinc-500">
              No saved searches yet — run a search to see it here.
            </p>
          )}
          {historyExpanded && history.length > 0 && (
            <ul className="mt-3 divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {history.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.ownerName}</p>
                    <p className="truncate text-xs text-zinc-500">
                      {item.propertyAddress || "No address"}
                      {" · "}
                      {new Date(item.createdAt).toLocaleString()}
                      {" · "}
                      <span
                        className={
                          item.status === "COMPLETED"
                            ? "text-emerald-600"
                            : item.status === "FAILED"
                              ? "text-red-600"
                              : "text-amber-600"
                        }
                      >
                        {item.status}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => handleViewSaved(item)}
                      disabled={historyActionId === item.id || item.status !== "COMPLETED"}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
                    >
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSearchAgain(item)}
                      disabled={historyActionId === item.id || loading}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
                    >
                      Search again
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <p className="mt-6 text-sm text-red-600">{error}</p>}

        {warnings.length > 0 && (
          <ul className="mt-6 space-y-1 text-sm text-amber-600">
            {warnings.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}

        {candidates && candidates.length === 0 && otherPossibleMatches.length === 0 && !error && (
          <p className="mt-6 text-sm text-zinc-500">
            No matches found for that name across MBIE company records or web search.
          </p>
        )}

        {candidates && candidates.length > 0 && (
          <ul className="mt-6 space-y-3">
            {candidates.map((c, i) => (
              <CandidateCard key={i} candidate={c} />
            ))}
          </ul>
        )}

        {candidates && candidates.length === 0 && otherPossibleMatches.length > 0 && (
          <div className="mt-6">
            <p className="text-sm text-zinc-500">
              No confident matches, but here are the closest possible leads —
              treat these as unverified.
            </p>
            <ul className="mt-3 space-y-3">
              {otherPossibleMatches.map((c, i) => (
                <CandidateCard key={i} candidate={c} />
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
