"use client";
import { useEffect, useRef } from "react";
import { browserAuth } from "@/lib/browser";
export function StaffUpdates({
  eventId,
  onUpdate,
}: {
  eventId?: string;
  onUpdate: () => Promise<void>;
}) {
  const callback = useRef(onUpdate);
  callback.current = onUpdate;
  useEffect(() => {
    if (!eventId) return;
    const auth = browserAuth();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (running || document.hidden) return;
        running = true;
        try {
          await callback.current();
        } catch {
        } finally {
          running = false;
        }
      }, 200);
    };
    const channel = auth
      .channel(`fgl:${eventId}`, { config: { private: true } })
      .on("broadcast", { event: "revision" }, refresh)
      .subscribe();
    const fallback = setInterval(refresh, 5000);
    return () => {
      clearTimeout(timer);
      clearInterval(fallback);
      void auth.removeChannel(channel);
    };
  }, [eventId]);
  return null;
}
