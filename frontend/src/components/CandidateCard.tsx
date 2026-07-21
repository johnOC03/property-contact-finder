import type { ConfidenceLabel, SearchCandidate } from "@/lib/api";

const SOURCE_LABELS: Record<SearchCandidate["sourceType"], string> = {
  MBIE_ENTITY_ROLE: "MBIE Entity/Role Search",
  AI_WEB_SEARCH: "AI Web Search",
  AI_PROPERTY_CONNECTION: "AI Web Search · different name",
};

const CONFIDENCE_STYLES: Record<ConfidenceLabel | "None", string> = {
  High: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  Medium: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  Low: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300",
  None: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const CONTACT_SOURCE_LABELS: Record<
  NonNullable<SearchCandidate["contactDetails"]>[number]["sources"][number]["sourceType"],
  string
> = {
  YELLOW_PAGES: "Yellow Pages",
  WEB_SEARCH: "Web search",
};

export function CandidateCard({ candidate }: { candidate: SearchCandidate }) {
  const confidenceKey = candidate.confidenceLabel ?? "None";

  return (
    <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-lg font-semibold">{candidate.matchedName}</p>
          {candidate.roleType ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {candidate.roleType}
              {candidate.companyName ? ` at ${candidate.companyName}` : ""} ·{" "}
              <span className="capitalize">{candidate.status}</span>
              {candidate.companyStatus && (
                <>
                  {" "}
                  · company: <span>{candidate.companyStatus}</span>
                </>
              )}
            </p>
          ) : candidate.sourceType === "AI_PROPERTY_CONNECTION" ? (
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              ⚠ Different name than searched — found via a connection to the property address (AI web search only).
            </p>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No MBIE company/director record found — this lead comes from public web search only.
            </p>
          )}
          {candidate.address && (
            <p className="mt-1 text-sm text-zinc-500">{candidate.address}</p>
          )}
          {candidate.registeredAddress &&
            candidate.registeredAddress !== candidate.address && (
              <p className="mt-1 text-sm text-zinc-500">
                Registered office: {candidate.registeredAddress}
              </p>
            )}
          {candidate.contactDetails && candidate.contactDetails.length > 0 && (
            <ul className="mt-2 space-y-1">
              {candidate.contactDetails.map((detail, index) => (
                <li key={index} className="text-sm text-zinc-600 dark:text-zinc-400">
                  <span className="font-medium capitalize">{detail.type}:</span>{" "}
                  {detail.value}{" "}
                  <span className="text-xs text-zinc-400">
                    (
                    {detail.sources.map((source, sourceIndex) => (
                      <span key={sourceIndex}>
                        {sourceIndex > 0 ? ", " : ""}
                        {CONTACT_SOURCE_LABELS[source.sourceType]}
                        {source.sourceUrl ? (
                          <>
                            {" \u2013 "}
                            <a
                              href={source.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                            >
                              source{detail.sources.length > 1 ? ` ${sourceIndex + 1}` : ""}
                            </a>
                          </>
                        ) : null}
                      </span>
                    ))}
                    )
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${CONFIDENCE_STYLES[confidenceKey]}`}
          >
            {candidate.confidenceLabel ?? "Below threshold"} · {candidate.confidenceScore}
          </span>
          <span className="whitespace-nowrap rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {SOURCE_LABELS[candidate.sourceType]}
          </span>
        </div>
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {candidate.rationale}
      </p>
    </li>
  );
}
