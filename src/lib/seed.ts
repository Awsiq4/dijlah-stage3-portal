import type { PortalData, Section } from "./types";
import { SCHEDULE_2026_10_17 } from "./schedule-2026-10-17";

// The original site database/export was unavailable. These are verified subject names,
// not a reproduction of 36 previously imported timetable entries. Teacher names below
// were transcribed from the archived timetable dated 2026-10-17; verify recent changes.
export const SECTIONS: Section[] = ["A", "B", "C", "F"];
export const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
export const PORTAL_NAME = "بوابة طلبة المرحلة الثالثة";
export const SEED: PortalData = {
  subjects: [
    { id:"digital-systems",name:"الأنظمة التسلسلية الرقمية",englishName:"Sequential Digital Systems",teacher:"أ.م.د. علي يوسف (نظري) / م.م. حيدر سامي (عملي)",description:"المحاضرات والتطبيقات الخاصة بالمادة.",color:"#3586d9" },
    { id:"numerical-analysis",name:"التحليلات الهندسية والعددية",englishName:"Engineering & Numerical Analysis",teacher:"م.م. أثير عدنان",description:"المحاضرات والواجبات الخاصة بالمادة.",color:"#9273da" },
    { id:"laser-safety",name:"الوقاية من الليزر",englishName:"Laser Safety",teacher:"م.م. دعاء محمود",description:"المحتوى والمواد الإرشادية الخاصة بالوقاية من الليزر.",color:"#c18c2e" },
    { id:"optoelectronics",name:"الإلكترونيات البصرية",englishName:"Optoelectronics",teacher:"م.م. رامي سالار",description:"محاضرات الإلكترونيات البصرية.",color:"#119aa5" },
    { id:"nonlinear-optics",name:"بصريات لاخطية",englishName:"Nonlinear Optics",teacher:"م.م. سجود باسم",description:"المحاضرات والتمارين الخاصة بالبصريات اللاخطية.",color:"#cd6894" },
    { id:"industrial-lasers",name:"تطبيقات الليزر الصناعية",englishName:"Industrial Laser Applications",teacher:"م.م. أحمد حميد",description:"المحاضرات والتطبيقات الصناعية.",color:"#55935b" },
    { id:"quantum-mechanics",name:"ميكانيك الكم",englishName:"Quantum Mechanics",teacher:"د. زهراء عبد الأمير",description:"المحاضرات والمسائل الخاصة بميكانيك الكم.",color:"#6179ba" }
  ],
  lectures: [], schedule: SCHEDULE_2026_10_17, exams: [], announcements: [], assignments: [],
  telegram: {general:"",sections:{A:"",B:"",C:"",F:""},subjects:{}}
};
export const getSubject = (data: PortalData, id: string) => data.subjects.find(s => s.id === id);
export const formatDate = (input: string) => {
  if (!input) return "غير محدد";
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? input : new Intl.DateTimeFormat("ar-IQ", {dateStyle:"medium",timeZone:"Asia/Baghdad"}).format(d);
};
