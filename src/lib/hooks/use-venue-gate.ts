/**
 * useVenueGate — strict compliance gate for venue selection in event pickers.
 *
 * Returns a `checkVenue(venueId)` function. When called it fetches usability
 * and, if the venue is blocked, sets `blockedMessage` which the caller renders
 * in a blocking AlertDialog. The selection is rejected and must not proceed.
 *
 * When the venue is in a deferral grace window the selection is allowed but
 * `warningMessage` is set so the caller can show a non-blocking warning.
 */
import { useState } from "react";
import { getVenueUsability } from "@/lib/api/venues";

export interface VenueGateState {
  checking: boolean;
  blockedMessage: string | null;
  warningMessage: string | null;
  clearMessages: () => void;
  checkVenue: (venueId: string | null | undefined) => Promise<boolean>;
}

export function useVenueGate(): VenueGateState {
  const [checking, setChecking] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  function clearMessages() {
    setBlockedMessage(null);
    setWarningMessage(null);
  }

  async function checkVenue(venueId: string | null | undefined): Promise<boolean> {
    if (!venueId) return true; // no venue selected — not a gate issue
    setChecking(true);
    try {
      const u = await getVenueUsability(venueId);
      if (!u.canUse) {
        setBlockedMessage(u.message);
        return false;
      }
      if (u.reason === "compliance_deferred_grace") {
        setWarningMessage(u.message);
      }
      return true;
    } catch {
      // Network failure — fail open with a warning so the user isn't silently blocked.
      setWarningMessage(
        "Unable to verify venue compliance status. Proceed with caution and confirm sign-off before the outing.",
      );
      return true;
    } finally {
      setChecking(false);
    }
  }

  return { checking, blockedMessage, warningMessage, clearMessages, checkVenue };
}
