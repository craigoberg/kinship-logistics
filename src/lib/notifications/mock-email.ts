/**
 * Mock email event bus — observational preview in NotificationSimulator.
 * Real send still goes through /api/internal/app-ticket-notify (Postmark).
 */
import { useEffect } from "react";

export interface MockEmailPayload {
  recipient: string;
  subject: string;
  body: string;
  source: string;
  dispatchedAt: string;
  reason?: string;
}

const EVENT_NAME = "lovable:mock-email";

export function emitMockEmail(
  input: Omit<MockEmailPayload, "dispatchedAt">,
): MockEmailPayload {
  const payload: MockEmailPayload = {
    ...input,
    dispatchedAt: new Date().toISOString(),
  };
  // eslint-disable-next-line no-console
  console.info(`[mock-email][${payload.source}]`, payload);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
  }
  return payload;
}

export function useMockEmailListener(
  handler: (payload: MockEmailPayload) => void,
) {
  useEffect(() => {
    const onEvt = (e: Event) => {
      const ce = e as CustomEvent<MockEmailPayload>;
      handler(ce.detail);
    };
    window.addEventListener(EVENT_NAME, onEvt);
    return () => window.removeEventListener(EVENT_NAME, onEvt);
  }, [handler]);
}
