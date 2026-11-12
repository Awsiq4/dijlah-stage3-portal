import {canPublishMaterial, teacherSections, type AdminInfo} from "./rbac.ts";

export const PUBLISH_SECTIONS = ["A","B","C","F"] as const;

/** One calm default audience for all frequent Telegram publishing flows.
 * Explicit audience changes remain possible in the preview and are revalidated server-side.
 */
export function defaultAudience(admin: AdminInfo, subjectId: string): string[] {
  if (admin.role === "section_representative") return admin.assigned_section ? [admin.assigned_section] : [];
  if (admin.role === "teacher") {
    const allowed = teacherSections(admin,subjectId) || [...PUBLISH_SECTIONS];
    return allowed.filter(s=>PUBLISH_SECTIONS.includes(s as typeof PUBLISH_SECTIONS[number]));
  }
  return [...PUBLISH_SECTIONS];
}
export function validAudience(admin: AdminInfo, subjectId: string, sections: string[]): boolean {
  return !!subjectId && sections.length > 0 &&
    new Set(sections).size === sections.length &&
    sections.every(s=>PUBLISH_SECTIONS.includes(s as typeof PUBLISH_SECTIONS[number])) &&
    canPublishMaterial(admin,subjectId,sections);
}
export function canPublishScheduledExam(admin:AdminInfo,type:string):boolean {
  const canonical = type.trim().toLowerCase();
  // Midterm and Final are issued as owner-managed university schedules, not
  // arbitrary publisher quiz dates.
  if (canonical.includes("midterm")||canonical.includes("final")||
      canonical.includes("ميد")||canonical.includes("فاينل")||
      canonical.includes("نصف السنة")||canonical.includes("نهاية السنة"))
    return admin.role==="super_admin" || admin.role==="editor";
  return true;
}
