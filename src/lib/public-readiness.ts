import type {Section} from "./types.ts";

// A server-verified snapshot belongs to exactly one section.
// Route changes do not invalidate it, while section changes do.
export function hasVerifiedSection(
  hydrated:boolean,
  status:"loading"|"ready"|"error",
  loadedSection:Section|null,
  selectedSection:Section,
):boolean {
  return hydrated && status==="ready" && loadedSection===selectedSection;
}

// Revalidate infrequently as the student navigates; show the last verified
// snapshot while the refresh runs, avoiding a blocking loading screen.
export function shouldRevalidate(lastRequestedAt:number, now:number, interval=120_000):boolean {
  return now-lastRequestedAt>=interval;
}
