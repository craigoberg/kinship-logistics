import type { TransportTrip, TripLeg } from "@/lib/data-store";

export interface ManifestLegRoute {
  fromLabel: string;
  toLabel: string;
  fromAddress: string | null;
  toAddress: string | null;
}

/** Resolve origin/destination for navigation — event outings + Day Centre runs. */
export function resolveManifestLegRoute(
  leg: TripLeg,
  trip: TransportTrip,
  legs: TripLeg[],
): ManifestLegRoute {
  const toAddress = leg.targetAddress?.trim() || null;

  let fromAddress: string | null = null;
  if (leg.legKind === "depot_to_client") {
    fromAddress = trip.originAddress?.trim() || null;
  } else {
    const priorCompleted = legs
      .filter((l) => l.legIndex < leg.legIndex && l.status === "completed")
      .sort((a, b) => b.legIndex - a.legIndex)[0];
    if (priorCompleted?.targetAddress?.trim()) {
      fromAddress = priorCompleted.targetAddress.trim();
    } else {
      fromAddress = trip.originAddress?.trim() || null;
    }
  }

  return {
    fromLabel: leg.fromLabel,
    toLabel: leg.toLabel,
    fromAddress,
    toAddress,
  };
}

/** Google Maps directions deep link (no API key — opens native / web Maps). */
export function buildGoogleMapsDirectionsUrl(route: ManifestLegRoute): string | null {
  const destination = route.toAddress || route.toLabel;
  if (!destination) return null;
  const origin = route.fromAddress || route.fromLabel;
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function formatRouteEndpoint(label: string, address: string | null): string {
  if (address) return address;
  return label;
}
