// The assignment deadline is a calendar day, not a clock time.
// Canonical storage: YYYY-MM-DD, based on Asia/Baghdad calendar dates.
export function validAssignmentDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year,month,day]=value.split("-").map(Number);
  const parsed=new Date(Date.UTC(year,month-1,day));
  return parsed.getUTCFullYear()===year && parsed.getUTCMonth()===month-1 &&
    parsed.getUTCDate()===day;
}
export function baghdadToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone:"Asia/Baghdad",year:"numeric",month:"2-digit",day:"2-digit",
  }).format(now);
}
export function assignmentDayAllowed(day:string, now: Date = new Date()): boolean {
  return validAssignmentDay(day) && day >= baghdadToday(now);
}
// Existing historical entries may have stored an ISO clock time. Public UI
// always displays their same first calendar date, without a time.
export function assignmentDisplayDay(value: unknown): string {
  const raw=String(value??"");
  const date=raw.slice(0,10);
  return validAssignmentDay(date) ? date : "غير محدد";
}
