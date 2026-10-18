/**
 * Last-known hop headcount for a force-start before Release.
 * Saved while the tablet can still reach the server. IndexedDB meta store.
 */
import type { EventTransportRunCard } from "@/lib/api/event-hop-transport";
import {
  listExpectedPeopleForHop,
  type ExpectedHopPerson,
} from "@/lib/api/event-hop-transport";
import { listEventVenueStops } from "@/lib/api/event-outing";
import { operationalNowIso } from "@/lib/operational-clock";
import { idbGet, idbPut, STORE_META } from "./idb";

export type { ExpectedHopPerson };

export interface CachedExpectedHop {
  hopIndex: number;
  fromStopId: string;
  toStopId: string;
  label: string;
  originLabel: string;
  originAddress: string | null;
  toLabel: string;
  toAddress: string | null;
  people: ExpectedHopPerson[];
  savedAt: string;
}

interface ExpectedHopCache {
  key: string;
  hops: CachedExpectedHop[];
}

const PAPER_KEY = "yada.paperHeadcountTrips";

function cacheKey(eventId: string, sessionId: string, sessionDate: string): string {
  return `expectedHops:${eventId}:${sessionId}:${sessionDate.slice(0, 10)}`;
}

function destinationLabel(card: EventTransportRunCard): string {
  const parts = card.label.split("→").map((s) => s.trim());
  return parts.length > 1 ? parts[parts.length - 1]! : card.label;
}

export async function rememberExpectedHops(opts: {
  eventId: string;
  sessionId: string;
  sessionDate: string;
  hops: EventTransportRunCard[];
}): Promise<void> {
  const open = opts.hops.filter(
    (hop) =>
      hop.kind === "venue_hop" &&
      hop.status !== "completed" &&
      hop.hopIndex != null &&
      hop.fromStopId &&
      hop.toStopId,
  );
  if (!open.length) return;

  const stops = await listEventVenueStops(opts.eventId);
  const key = cacheKey(opts.eventId, opts.sessionId, opts.sessionDate);
  const existing = await idbGet<ExpectedHopCache>(STORE_META, key);
  const byHop = new Map((existing?.hops ?? []).map((hop) => [hop.hopIndex, hop]));

  for (const card of open) {
    const fromStopId = card.fromStopId!;
    const toStopId = card.toStopId!;
    const people = await listExpectedPeopleForHop({
      eventId: opts.eventId,
      eventDaySessionId: opts.sessionId,
      fromStopId,
    });
    const toStop = stops.find((stop) => stop.id === toStopId);
    byHop.set(card.hopIndex!, {
      hopIndex: card.hopIndex!,
      fromStopId,
      toStopId,
      label: card.label,
      originLabel: card.originLabel ?? "Where the group is",
      originAddress: card.originAddress ?? null,
      toLabel: destinationLabel(card),
      toAddress: toStop?.venue_street_address?.trim() || null,
      people,
      savedAt: operationalNowIso(),
    });
  }

  await idbPut(STORE_META, { key, hops: [...byHop.values()] } satisfies ExpectedHopCache);
}

export async function loadExpectedHops(opts: {
  eventId: string;
  sessionId: string;
  sessionDate: string;
}): Promise<CachedExpectedHop[]> {
  const key = cacheKey(opts.eventId, opts.sessionId, opts.sessionDate);
  const cache = await idbGet<ExpectedHopCache>(STORE_META, key);
  return cache?.hops ?? [];
}

export async function loadExpectedHop(opts: {
  eventId: string;
  sessionId: string;
  sessionDate: string;
  hopIndex: number;
}): Promise<CachedExpectedHop | null> {
  const key = cacheKey(opts.eventId, opts.sessionId, opts.sessionDate);
  const cache = await idbGet<ExpectedHopCache>(STORE_META, key);
  return cache?.hops.find((hop) => hop.hopIndex === opts.hopIndex) ?? null;
}

export async function refreshExpectedHop(opts: {
  eventId: string;
  sessionId: string;
  sessionDate: string;
  hop: CachedExpectedHop;
}): Promise<ExpectedHopPerson[]> {
  const people = await listExpectedPeopleForHop({
    eventId: opts.eventId,
    eventDaySessionId: opts.sessionId,
    fromStopId: opts.hop.fromStopId,
  });
  const key = cacheKey(opts.eventId, opts.sessionId, opts.sessionDate);
  const cache = await idbGet<ExpectedHopCache>(STORE_META, key);
  const hops = (cache?.hops ?? []).filter((row) => row.hopIndex !== opts.hop.hopIndex);
  hops.push({ ...opts.hop, people, savedAt: operationalNowIso() });
  await idbPut(STORE_META, { key, hops });
  return people;
}

function readPaperIds(): string[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(PAPER_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function markPaperHeadcountTrip(tripId: string): void {
  if (typeof sessionStorage === "undefined" || !tripId) return;
  const ids = new Set(readPaperIds());
  ids.add(tripId);
  sessionStorage.setItem(PAPER_KEY, JSON.stringify([...ids]));
}

export function isPaperHeadcountTrip(tripId: string): boolean {
  return readPaperIds().includes(tripId);
}
