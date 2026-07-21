export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export type ConfidenceLabel = "High" | "Medium" | "Low";

export interface ContactDetailSource {
  sourceUrl?: string;
  sourceType: "YELLOW_PAGES" | "WEB_SEARCH";
}

export interface ContactDetail {
  type: "email" | "phone" | "other" | "address";
  value: string;
  sources: ContactDetailSource[];
}

export interface SearchCandidate {
  matchedName: string;
  /** Absent for candidates discovered only via AI web search (no MBIE role at all). */
  roleType?: string;
  status?: string;
  companyName?: string;
  companyNzbn?: string;
  address?: string;
  registeredAddress?: string;
  companyStatus?: string;
  contactDetails?: ContactDetail[];
  sourceType: "MBIE_ENTITY_ROLE" | "AI_WEB_SEARCH" | "AI_PROPERTY_CONNECTION";
  confidenceScore: number;
  confidenceLabel: ConfidenceLabel | null;
  rationale: string;
}

export interface SearchResponse {
  candidates: SearchCandidate[];
  otherPossibleMatches: SearchCandidate[];
  warnings: string[];
}

export async function searchOwner(
  ownerName: string,
  address: string,
): Promise<SearchResponse> {
  const res = await fetch(`${API_BASE_URL}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerName, address: address || undefined }),
  });

  if (!res.ok) {
    throw new Error(`Search request failed (${res.status})`);
  }

  return res.json();
}

export type SearchStatus = "PENDING" | "COMPLETED" | "FAILED";

export interface SearchHistoryItem {
  id: string;
  ownerName: string;
  propertyAddress: string | null;
  status: SearchStatus;
  createdAt: string;
}

export interface SearchHistoryDetail extends SearchHistoryItem {
  result: SearchResponse | null;
  errorMessage: string | null;
}

export async function getSearchHistory(limit = 20): Promise<SearchHistoryItem[]> {
  const res = await fetch(`${API_BASE_URL}/search/history?limit=${limit}`);

  if (!res.ok) {
    throw new Error(`Search history request failed (${res.status})`);
  }

  return res.json();
}

export async function getSearchHistoryDetail(id: string): Promise<SearchHistoryDetail> {
  const res = await fetch(`${API_BASE_URL}/search/history/${id}`);

  if (!res.ok) {
    throw new Error(`Search history detail request failed (${res.status})`);
  }

  return res.json();
}

export interface AddressSuggestion {
  description: string;
  placeId: string;
}

export async function getAddressSuggestions(
  input: string,
): Promise<AddressSuggestion[]> {
  const res = await fetch(
    `${API_BASE_URL}/places/autocomplete?input=${encodeURIComponent(input)}`,
  );

  if (!res.ok) {
    throw new Error(`Autocomplete request failed (${res.status})`);
  }

  const data = await res.json();
  return data.predictions ?? [];
}

