import type { NormalizedEvent } from "./types.js";

const MIN_TERM_LENGTH = 3;

function extractQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((term) => term.trim())
    .filter((term) => term.length >= MIN_TERM_LENGTH);
}

function serializeEvent(event: NormalizedEvent): string {
  return [
    event.type,
    event.source,
    event.severity,
    JSON.stringify(event.metadata)
  ]
    .join(" ")
    .toLowerCase();
}

export function filterEventsByQuery(events: NormalizedEvent[], query?: string): NormalizedEvent[] {
  const normalizedQuery = query?.trim();
  if (!normalizedQuery) {
    return events;
  }

  const terms = extractQueryTerms(normalizedQuery);
  if (!terms.length) {
    return events;
  }

  return events.filter((event) => {
    const haystack = serializeEvent(event);
    const matchCount = terms.filter((term) => haystack.includes(term)).length;
    const requiredMatches = Math.min(2, terms.length);
    return matchCount >= requiredMatches;
  });
}
