import { useEffect, useState } from "react";

export function useOnlineStatus(): boolean {
  // Default to true during SSR/hydration to avoid server/client mismatches.
  // The real value is set once the effect runs on the client.
  const [online, setOnline] = useState<boolean>(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return online;
}
