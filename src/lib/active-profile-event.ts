/** Fired when the signed-in floor profile is written or cleared. */
export const ACTIVE_PROFILE_EVENT = "yada-active-profile";

export function notifyActiveProfileChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ACTIVE_PROFILE_EVENT));
}
