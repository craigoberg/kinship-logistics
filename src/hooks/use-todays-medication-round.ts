/**
 * Day Centre medication round — thin wrapper over useMedicationRound.
 */
import { useMedicationRound } from "@/hooks/use-medication-round";

export function useTodaysMedicationRound() {
  return useMedicationRound(undefined);
}
