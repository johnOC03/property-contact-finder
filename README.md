# Property Contact Finder

Given a property owner's **name** and **property address** (New Zealand), this
app searches public/official sources and returns any contact details it can
find for that person — each with a **confidence score**, its **source**, and a
plain-English **rationale** explaining the match.

It cross-references the **MBIE Companies Register / Entity-Role Search** (is
this person a director/shareholder of a company registered at, or near, that
address?) with an **AI-assisted public web search** (Yellow/White Pages,
professional registries, real estate agency pages, news, etc.), and combines
both into a single, explainable ranking. Past searches are saved to Postgres
so they can be reviewed or re-run without retyping anything.

## Contents

- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Running the apps](#running-the-apps)
- [Features](#features)
- [How matching/confidence works](#how-matchingconfidence-works)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Known limitations / trade-offs](#known-limitations--trade-offs)

## Architecture

```mermaid
flowchart TD
    U[User] -->|name + address| FE[Next.js Frontend]
    FE -->|POST /search| BE[NestJS Orchestrator]
    BE --> P1[MBIE Entity/Role Search]
    BE --> P2[AI Web Search - OpenRouter]
    P1 -->|per candidate company NZBN| P3[MBIE NZBN Entity Detail]
    P3 --> MERGE
    P2 --> MERGE
    MERGE[Matching / Scoring Engine] --> BE2[NestJS API]
    BE2 --> DB[(PostgreSQL)]
    BE2 -->|candidates + confidence + sources + warnings| FE
    FE --> U
```

Every source is queried independently and in parallel (`Promise.allSettled`) —
a failure or timeout in one source never discards results that already
succeeded from another; it's surfaced instead as a `warnings[]` entry in the
API response. The scoring engine is deterministic (not LLM-generated), so its
output can always be explained on demand. See
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the full design rationale.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router, TypeScript, Tailwind) |
| Backend | NestJS (TypeScript) |
| Database | PostgreSQL (native local install) + Prisma ORM |
| AI web search | OpenRouter, `perplexity/sonar` (built-in live web search with citations) |
| Address autocomplete | Google Places Autocomplete (server-proxied — the key never reaches the browser) |
| Company/director data | MBIE Entity/Role Search + NZBN Entity Detail |

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL running locally (native install, not Docker — see
  [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for why)
- API keys for: OpenRouter, MBIE Companies Register, MBIE Entity/Role Search,
  Google Places

### Install

```powershell
cd backend; npm install
cd ../frontend; npm install
```

### Set up the database

```powershell
# create the database (adjust user/host as needed for your local install)
createdb -U postgres property_contact_finder

# from backend/, apply the Prisma schema
cd backend
npm run prisma:migrate
```

## Environment variables

Copy `.env.example` to `.env` at the repo root (used by the backend and by
Prisma) and fill in real values:

```
OPENROUTER_API_KEY=
MBIE_COMPANIES_REGISTER_API_KEY=
MBIE_ENTITY_ROLE_SEARCH_API_KEY=
GOOGLE_PLACES_API_KEY=
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/property_contact_finder
PORT=3001
NODE_ENV=development
```

The frontend only needs `frontend/.env.local`:

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

`.env*` files are gitignored; only `.env.example` is committed.

## Running the apps

In two terminals:

```powershell
cd backend; npm run start:dev    # NestJS API on http://localhost:3001
cd frontend; npm run dev         # Next.js app on http://localhost:3000
```

Open `http://localhost:3000` and enter an owner name and address to run a
search.

## Features

- **Owner + address search** — enter a name and a New Zealand property
  address (autocompleted via Google Places) to find public contact leads.
- **Multi-source enrichment** — combines MBIE company/director records with
  an AI-assisted public web search (Yellow/White Pages, professional
  registries such as the Law Society/REAA/LBP/Charities Register, real
  estate agency staff pages, news, and other public listings).
- **Confidence scoring** — every candidate gets a 0–100 score and a
  High/Medium/Low label, with a plain-English rationale explaining exactly
  why it scored the way it did.
- **Fuzzy, corroborated name matching** — an AI-search lead is only accepted
  as supporting evidence when the surname matches exactly, the first name is
  an exact or close (Jaro-Winkler) match, and there's an independent
  corroborating address signal — this avoids both false negatives (e.g.
  "Alison May Dymond" vs "Allison Dymond") and false positives from a bare
  name match alone.
- **Recent searches** — every search is saved to Postgres. A collapsible
  "Recent searches" panel lets you:
  - **View** a past search's saved results instantly, with no new API calls.
  - **Search again** — re-run a past search's exact name/address with one
    click, with no retyping required.
- **Partial-failure resilience** — if any one source (MBIE or the AI search)
  fails or times out, the search still completes using whatever succeeded,
  with a warning noting what was unavailable.

## How matching/confidence works

Each candidate's score is computed deterministically from independent
signals (never LLM-generated — only the rationale's wording is templated):

| Signal | Points |
|---|---|
| Name similarity (Jaro-Winkler, normalised) | 0–40 |
| Address similarity (best-matching known address) | 0–40 |
| Corroboration bonus (independent AI web-search hit under the same name) | +20 |
| Stale status discount (inactive role / non-active company) | −10 |

The total is clamped to 0–100 and mapped to a label:

- **80–100 → High**
- **50–79 → Medium**
- **20–49 → Low**
- **< 20 → not shown** (surfaced only as an "other possible match" if nothing
  else qualifies)

A single MBIE-only match (exact name + exact address, active status) caps at
80 by design — reaching the top of the range requires independent
corroboration from the AI web search, since single-source certainty is
deliberately not treated as 100% verified.

## Project structure

```
backend/
  src/
    search/      # /search + /search/history endpoints, orchestration, persistence
    mbie/        # Entity/Role Search + NZBN Entity Detail clients
    ai/          # OpenRouterService (Sonar web search + prompt template)
    matching/    # deterministic scoring engine (pure, unit-tested)
    places/      # server-side Google Places Autocomplete proxy
    prisma/      # PrismaService/PrismaModule
  prisma/
    schema.prisma
frontend/
  src/
    app/page.tsx           # search form, recent searches, results
    components/            # CandidateCard, etc.
    lib/api.ts             # typed API client
```

## Testing

```powershell
cd backend; npm run test    # Jest unit tests (matching engine, lead matching, services)
cd backend; npm run build   # TypeScript build check
cd frontend; npm run build  # Next.js production build/typecheck
```

## Known limitations / trade-offs

- The AI web search step is inherently non-deterministic — identical queries
  can occasionally return different results between runs.
- No scraping of Yellow/White Pages directly; delegated to the Sonar model's
  own web search rather than a dedicated scraper.
- Name matching doesn't handle nicknames (e.g. "Bill" vs "William").
- No authentication/multi-user support — this is a local, single-user
  prototype, not hardened for production PII handling.
- Confidence thresholds (80/50/20) are reasonable starting points, not
  empirically tuned against a labelled dataset.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the full design
notes, including the reasoning behind every architectural decision above.