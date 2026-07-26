import { api } from "../api";

export interface UsageEventInput {
  event: string;
  section?: string;
  metadata?: Record<string, unknown>;
}

let queue: UsageEventInput[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_DELAY_MS = 4000;

function hasToken(): boolean {
  return Boolean(localStorage.getItem("ops_token"));
}

async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0 || !hasToken()) {
    queue = [];
    return;
  }
  const batch = queue;
  queue = [];
  try {
    await api.trackUsage(batch);
  } catch {
    // Usage tracking is best-effort — never surface errors to the user.
  }
}

/** Queue a usage event; flushes are batched to minimize network chatter. */
export function trackEvent(input: UsageEventInput): void {
  if (!hasToken()) return;
  queue.push(input);
  if (queue.length >= 20) {
    void flush();
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(() => void flush(), FLUSH_DELAY_MS);
  }
}

// Best-effort flush when the tab is hidden or closed.
if (typeof window !== "undefined") {
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
  window.addEventListener("beforeunload", () => void flush());
}
