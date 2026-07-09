import { ExternalLink, MapPin, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TransportTrip, TripLeg } from "@/lib/data-store";
import {
  buildGoogleMapsDirectionsUrl,
  formatRouteEndpoint,
  resolveManifestLegRoute,
} from "@/lib/manifest-route";

interface Props {
  leg: TripLeg;
  trip: TransportTrip;
  legs: TripLeg[];
  className?: string;
}

/**
 * Phase 0 route preview — placeholder map until BL-015 live Google Maps embed.
 * Shown while leg.status === "en_route" (after Depart Stop).
 */
export function ManifestRouteMap({ leg, trip, legs, className }: Props) {
  const route = resolveManifestLegRoute(leg, trip, legs);
  const mapsUrl = buildGoogleMapsDirectionsUrl(route);
  const fromDisplay = formatRouteEndpoint(route.fromLabel, route.fromAddress);
  const toDisplay = formatRouteEndpoint(route.toLabel, route.toAddress);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-slate-600 bg-slate-950 text-white",
        className,
      )}
      aria-label="Route preview map"
    >
      {/* Placeholder map canvas */}
      <div className="relative min-h-[40vh] max-h-[50vh] bg-gradient-to-b from-slate-800 to-slate-900 md:min-h-[280px] md:max-h-[360px]">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "linear-gradient(rgba(148,163,184,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.15) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-slate-900/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-300">
          <Navigation className="h-3 w-3" />
          Route preview
        </div>

        {/* Simulated route line */}
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 400 240"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path
            d="M 48 180 Q 120 140, 200 120 T 352 60"
            fill="none"
            stroke="rgb(59, 130, 246)"
            strokeWidth="4"
            strokeDasharray="8 6"
            strokeLinecap="round"
          />
          <circle cx="48" cy="180" r="10" fill="rgb(34, 197, 94)" stroke="white" strokeWidth="2" />
          <circle cx="352" cy="60" r="10" fill="rgb(239, 68, 68)" stroke="white" strokeWidth="2" />
        </svg>

        <div className="absolute bottom-3 left-3 right-3 space-y-1 rounded-lg bg-slate-900/90 px-3 py-2 text-xs backdrop-blur-sm">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-green-500" />
            <span className="line-clamp-2 text-slate-200">{fromDisplay}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
            <span className="line-clamp-2 font-medium text-white">{toDisplay}</span>
          </div>
        </div>
      </div>

      <div className="space-y-2 border-t border-slate-700 p-3">
        <p className="text-center text-[11px] leading-relaxed text-slate-400">
          Simulated route — live Google Maps navigation is planned (BL-015). Tap below to open
          directions in Google Maps.
        </p>
        {mapsUrl ? (
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full touch-manipulation border-slate-600 bg-slate-800 text-sm font-semibold text-white hover:bg-slate-700 hover:text-white"
            asChild
          >
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Open in Google Maps
            </a>
          </Button>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            No street address on file — use passenger labels or enter destination manually in Maps.
          </div>
        )}
      </div>
    </div>
  );
}
