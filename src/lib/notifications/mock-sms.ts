/**
 * Mock SMS event bus
 *
 * Every code path in the project that triggers an outbound SMS — whether it
 * actually hits a real provider (GatewayAPI / Twilio / etc.) or is still a
 * placeholder — should call `emitMockSms(...)` for each recipient. The
 * `NotificationSimulator` overlay (mounted in `__root.tsx`) subscribes and
 * surfaces a smartphone-style preview so operators can verify routing in
 * dev / preview / staging without waiting on the real channel.
 *
 * Production sends and the popup are independent: the real provider call
 * still runs through the relevant server route. The popup is observational.
 */
import { useEffect } from "react";

export interface MockSmsPayload {
  recipient: string;
  body: string;
  source: string;
  dispatchedAt: string;
  reason?: string;
  reference?: string;
}

const EVENT_NAME = "lovable:mock-sms";

export function emitMockSms(
  input: Omit<MockSmsPayload, "dispatchedAt">,
): MockSmsPayload {
  const payload: MockSmsPayload = {
    ...input,
    dispatchedAt: new Date().toISOString(),
  };
  // eslint-disable-next-line no-console
  console.info(`[mock-sms][${payload.source}]`, payload);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
  }
  return payload;
}

export function useMockSmsListener(
  handler: (payload: MockSmsPayload) => void,
) {
  useEffect(() => {
    const onEvt = (e: Event) => {
      const ce = e as CustomEvent<MockSmsPayload>;
      handler(ce.detail);
    };
    window.addEventListener(EVENT_NAME, onEvt);
    return () => window.removeEventListener(EVENT_NAME, onEvt);
  }, [handler]);
}
