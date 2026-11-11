"use client";

import Link from "next/link";
import {ArrowUpLeft,BellRing,ClipboardList,FileQuestion,GraduationCap,ShieldCheck} from "lucide-react";
import {PageHeading} from "@/components/UI";
import {useAdminNavigation} from "@/components/AppShell";
const links=[{href:"/exams",name:"الامتحانات والكوزات",desc:"المواعيد والمادة الداخلة",Icon:FileQuestion},{href:"/assignments",name:"الواجبات والتقارير",desc:"التكاليف وآخر موعد للتسليم",Icon:ClipboardList},{href:"/notifications",name:"الإشعارات وقنوات التليجرام",desc:"تفعيل إشعارات البوت + القنوات الرسمية للمرحلة والشعب والمواد",Icon:BellRing},{href:"/admin",name:"لوحة الإدارة",desc:"إدارة ونشر المحتوى",Icon:ShieldCheck},{href:"/about-department",name:"حول القسم",desc:"نشأة القسم ورسالته ورؤيته وأهدافه",Icon:GraduationCap},{href:"/support",name:"الدعم والاقتراحات",desc:"استفسار، اقتراح أو مشكلة",Icon:FileQuestion}];
export default function More(){const showAdmin=useAdminNavigation();return <><PageHeading title="المزيد" description="الأدوات والخدمات الإضافية للبوابة"/><div className="stack">{links.filter(link => link.href !== "/admin" || showAdmin).map(({href,name,desc,Icon})=><Link href={href} className="more-link" key={href}><div className="round-icon"><Icon size={21}/></div><div className="grow"><strong>{name}</strong><p className="subtle small">{desc}</p></div><ArrowUpLeft size={18}/></Link>)}</div></>}
