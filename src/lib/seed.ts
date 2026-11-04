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
  lectures: [
    { id:"lec-nonlinear-optics-1",subjectId:"nonlinear-optics",number:1,title:"Nonlinear Optics — Lecture 1",description:"المحاضرة 1 من مادة البصريات اللاخطية — قسم هندسة الليزر والإلكترونيات البصرية (م.م. سجود باسم).",fileUrl:"/lectures/nonlinear-optics-lecture-1.pdf",fileName:"Nonlinear Optics 1.pdf",status:"published",updatedAt:"2026-11-04" },
    { id:"lec-nonlinear-optics-2",subjectId:"nonlinear-optics",number:2,title:"Nonlinear Optics — Lecture 2",description:"المحاضرة 2 من مادة البصريات اللاخطية (م.م. سجود باسم).",fileUrl:"/lectures/nonlinear-optics-lecture-2.pdf",fileName:"Nonlinear Optics 2.pdf",status:"published",updatedAt:"2026-11-04" },
    { id:"lec-nonlinear-optics-3",subjectId:"nonlinear-optics",number:3,title:"Nonlinear Optics — Lecture 3: Second Harmonic Generation (SHG)",description:"المحاضرة 3 — توليد التوافق الثاني (SHG) — مادة البصريات اللاخطية (م.م. سجود باسم).",fileUrl:"/lectures/nonlinear-optics-lecture-3.pdf",fileName:"Nonlinear Optics 3.pdf",status:"published",updatedAt:"2026-11-04" },
    { id:"lec-nonlinear-optics-4-5",subjectId:"nonlinear-optics",number:4,title:"Nonlinear Optics — Lectures 4 & 5",description:"المحاضرتان 4 و5 من مادة البصريات اللاخطية (م.م. سجود باسم).",fileUrl:"/lectures/nonlinear-optics-lectures-4-5.pdf",fileName:"Nonlinear Optics 4&5.pdf",status:"published",updatedAt:"2026-11-04" }
  ], schedule: SCHEDULE_2026_10_17, exams: [], announcements: [], assignments: [],
  telegram: {general:"",sections:{A:"",B:"",C:"",F:""},subjects:{}}
};
export const getSubject = (data: PortalData, id: string) => data.subjects.find(s => s.id === id);
export const formatDate = (input: string) => {
  if (!input) return "غير محدد";
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? input : new Intl.DateTimeFormat("ar-IQ", {dateStyle:"medium",timeZone:"Asia/Baghdad"}).format(d);
};
