import { useEffect } from "react";
import { trackEvent } from "../lib/usage";

/** Record a `section_view` event whenever the active dashboard section changes. */
export function useTrackSection(section: string | undefined): void {
  useEffect(() => {
    if (!section) return;
    trackEvent({ event: "section_view", section });
  }, [section]);
}
