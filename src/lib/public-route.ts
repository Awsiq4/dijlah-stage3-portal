// Client-only route classification used by both AppShell and PortalProvider.
// Prevents the student shell from rendering unverified/stale DB collections.
export function needsPublicContent(pathname:string|null|undefined):boolean {
  if(!pathname)return false;
  return pathname==="/" ||
    /^\/(?:subjects|schedule|announcements|assignments|exams|lectures|questions|this-week|notifications)(?:\/|$)/.test(pathname);
}
