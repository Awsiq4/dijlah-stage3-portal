"use client";
import {Send} from "lucide-react";
import {usePortal} from "@/lib/storage";
import {SECTIONS} from "@/lib/seed";
import {Badge,Empty,ExternalLink,PageHeading} from "@/components/UI";

const REP_CHANNEL={name:"قناة مندوب المرحلة — إعلانات عامة",link:"https://t.me/laserandopto1"};

export default function Notifications(){
  const {data,section}=usePortal();
  const general=[{name:"القناة الرسمية لطلبة المرحلة الثالثة",link:data.telegram.general},REP_CHANNEL].filter(x=>x.link);
  const others=SECTIONS.filter(s=>s!==section);
  const subjectChannels=data.subjects.filter(s=>data.telegram.subjects[s.id]);
  return <>
    <PageHeading title="قنوات التليجرام" description="القنوات الرسمية للمرحلة والشعب والمواد — انضم لتصلك إشعارات التحديثات أولًا بأول"/>
    <section className="panel">
      <div className="panel-heading"><h2><Send size={19}/> قنوات عامة</h2></div>
      <div className="panel-body"><div className="stack">
        {general.map(c=><div className="list-row" key={c.link}><div className="round-icon"><Send size={19}/></div><strong className="grow">{c.name}</strong><ExternalLink href={c.link}>فتح القناة</ExternalLink></div>)}
      </div></div>
    </section>
    <section className="panel">
      <div className="panel-heading"><h2><Send size={19}/> قنوات الشعب</h2></div>
      <div className="panel-body"><div className="stack">
        <div className="list-row">
          <div className="round-icon"><Send size={19}/></div>
          <div className="grow"><strong>قناة شعبة {section}</strong><div className="subtle small"><Badge>شعبتك الحالية</Badge></div></div>
          {data.telegram.sections[section]?<ExternalLink href={data.telegram.sections[section]}>فتح القناة</ExternalLink>:<span className="status">غير متوفرة</span>}
        </div>
        {others.map(s=>{
          const link=data.telegram.sections[s];
          return <div className="list-row" key={s}>
            <div className="round-icon"><Send size={19}/></div>
            <strong className="grow">قناة شعبة {s}</strong>
            {link?<ExternalLink href={link}>فتح</ExternalLink>:<span className="status">غير متوفرة بعد</span>}
          </div>;
        })}
      </div></div>
    </section>
    <section className="panel">
      <div className="panel-heading"><h2><Send size={19}/> قنوات المواد</h2></div>
      <div className="panel-body">
        {subjectChannels.length?<div className="stack">{subjectChannels.map(s=><div className="list-row" key={s.id}><div className="round-icon"><Send size={19}/></div><strong className="grow">{s.name}</strong><ExternalLink href={data.telegram.subjects[s.id]}>فتح القناة</ExternalLink></div>)}</div>:<Empty description="روابط قنوات المواد غير متوفرة في الملف الأصلي — لا تُضاف إلا بمصدر موثّق."/>}
      </div>
    </section>
<p className="note">اشترك في القناة وألغِ الاشتراك متى شئت — تصلك إشعارات المحاضرات والامتحانات والتبليغات الجديدة دون تكرارها هنا.</p>
  </>;
}
