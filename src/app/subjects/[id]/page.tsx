"use client";
import {useParams} from "next/navigation";
import Link from "next/link";
import {ArrowUpLeft,BookOpen,FileText,MessageSquare,ClipboardList,Send,Play,Video,X,ExternalLink as ExternalLinkIcon} from "lucide-react";
import {useEffect,useState} from "react";
import {usePortal} from "@/lib/storage";
import {Empty,PageHeading,Status,ExternalLink} from "@/components/UI";
import {formatDate} from "@/lib/seed";

// These five optional video explanations belong only to Optoelectronics.
// They are independent of the lecture PDF/PPTX publishing and upload system.
const OPTOELECTRONICS_VIDEOS = [
  {number: 1, title: "المحاضرة الأولى", youtubeId: "xw86PhlM2Ps"},
  {number: 2, title: "المحاضرة الثانية", youtubeId: "y6kGvhApc9A"},
  {number: 3, title: "المحاضرة الثالثة", youtubeId: "USx9gJswdNY"},
  {number: 4, title: "المحاضرة الرابعة", youtubeId: "pZFhy_6xhYU"},
  {number: 5, title: "المحاضرة الخامسة", youtubeId: "Z63NeqH2LlQ"},
] as const;

function OptoelectronicsVideos() {
  const [activeId, setActiveId] = useState<string | null>(null);
  return <section className="opto-videos" aria-label="شروحات المحاضرات على يوتيوب">
    <div className="opto-videos-heading">
      <div className="opto-videos-mark"><Video size={24}/></div>
      <div className="grow">
        <h2>شروحات محاضرات الإلكترونيات البصرية</h2>
        <p>شاهد الشرح داخل البوابة، أو افتح الفيديو مباشرة على يوتيوب.</p>
      </div>
      <span className="opto-videos-count">5 فيديوهات</span>
    </div>
    <div className="opto-videos-grid">
      {OPTOELECTRONICS_VIDEOS.map(video => {
        const open = activeId === video.youtubeId;
        const watchUrl = `https://www.youtube.com/watch?v=${video.youtubeId}`;
        return <article className="opto-video-card" key={video.youtubeId}>
          <div className="opto-video-media">
            {open ? <iframe
              src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?autoplay=1&playsinline=1&rel=0`}
              title={`شرح ${video.title} — الإلكترونيات البصرية`}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            /> : <button type="button" className="opto-video-cover"
              onClick={() => setActiveId(video.youtubeId)}
              aria-label={`تشغيل شرح ${video.title}`}>
              <img src={`https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`}
                alt={`صورة الفيديو التعليمي — ${video.title}`} loading="lazy" decoding="async"/>
              <span className="opto-video-play"><Play size={28} fill="currentColor"/></span>
            </button>}
          </div>
          <div className="opto-video-info">
            <div className="opto-video-title-line">
              <span className="opto-video-number">{String(video.number).padStart(2, "0")}</span>
              <div><strong>شرح {video.title}</strong><p>الإلكترونيات البصرية · فيديو تعليمي</p></div>
            </div>
            <div className="opto-video-actions">
              <button type="button" className="opto-video-watch"
                aria-expanded={open} onClick={() => setActiveId(open ? null : video.youtubeId)}>
                {open ? <><X size={16}/> إغلاق المشغّل</> : <><Play size={16}/> مشاهدة الشرح</>}
              </button>
              <a className="opto-video-youtube" href={watchUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon size={15}/> يوتيوب
              </a>
            </div>
          </div>
        </article>;
      })}
    </div>
  </section>;
}

export default function SubjectDetail(){const p=useParams<{id:string}>();const {data,section}=usePortal();const subject=data.subjects.find(s=>s.id===p.id);const [tab,setTab]=useState("lectures");useEffect(()=>{if(new URLSearchParams(window.location.search).get("tab")==="questions")setTab("questions");},[]);if(!subject)return <Empty title="المادة غير موجودة"/>;const ls=data.lectures.filter(l=>l.subjectId===subject.id&&l.status==="published").sort((a,b)=>a.number-b.number);const anns=data.announcements.filter(a=>a.scope==="teacher"&&a.subjectId===subject.id&&(a.section==="all"||a.section===section));const assignments=data.assignments.filter(a=>a.subjectId===subject.id&&a.sections.includes(section));const exams=data.exams.filter(e=>e.subjectId===subject.id&&e.sections.includes(section));const questions=(data.questions||[]).filter(item=>item.subjectId===subject.id&&item.sections.includes(section));const summaries=(data.summaries||[]).filter(item=>item.subjectId===subject.id&&item.status==="published");const tabs=[{id:"lectures",name:"المحاضرات",n:ls.length},...(subject.id==="optoelectronics"?[{id:"videos",name:"شروحات يوتيوب",n:OPTOELECTRONICS_VIDEOS.length}]:[]),{id:"announcements",name:"التبليغات",n:anns.length},{id:"assignments",name:"الواجبات",n:assignments.length},{id:"exams",name:"الامتحانات",n:exams.length},{id:"questions",name:"أسئلة الامتحانات السابقة",n:questions.length},{id:"summaries",name:"الملخصات",n:summaries.length}];return <><Link className="back-link" href="/subjects">المواد الدراسية <ArrowUpLeft size={15}/></Link><div className="subject-banner" style={{"--subject-color":subject.color} as React.CSSProperties}><div className="subject-big-icon"><BookOpen size={28}/></div><div><h1>{subject.name}</h1><p>{subject.englishName}</p><p className="teacher-line">التدريسي: {subject.teacher||"لم يضف بعد"}</p></div></div><div className="tabs">{tabs.map(t=><button className={tab===t.id?"selected":""} key={t.id} onClick={()=>setTab(t.id)}>{t.name} <span>{t.n}</span></button>)}</div>{data.telegram.subjects[subject.id]&&<div className="panel"><div className="panel-body"><div className="list-row"><div className="round-icon"><Send size={19}/></div><div className="grow"><strong>قناة المادة على تليجرام</strong><p className="subtle small">{subject.englishName}</p></div><ExternalLink href={data.telegram.subjects[subject.id]}>فتح القناة</ExternalLink></div></div></div>}{subject.id==="optoelectronics"&&tab==="videos"&&<OptoelectronicsVideos/>}{tab!=="videos"&&<div className="panel"><div className="panel-body">{tab==="lectures"&&(ls.length?ls.map(l=><Link key={l.id} className="list-row" href={`/lectures/${l.id}`}><FileText size={20}/><div className="grow"><strong>{l.number}. {l.title}</strong><p className="subtle small">{l.description} · {formatDate(l.updatedAt)}</p></div><ArrowUpLeft size={16}/></Link>):<Empty/>)}{tab==="announcements"&&(anns.length?anns.map(a=><div className="list-row" key={a.id}><MessageSquare size={19}/><div className="grow"><strong>{a.title}</strong><p>{a.body}</p><p className="subtle small">{a.author||subject.teacher||"تدريسي المادة"} · {formatDate(a.publishedAt)}</p></div></div>):<Empty/>)}{tab==="assignments"&&(assignments.length?assignments.map(a=><div className="list-row" key={a.id}><ClipboardList size={19}/><div className="grow"><strong>{a.title}</strong><p>{a.instructions}</p><p className="subtle small">التسليم: {formatDate(a.dueAt)}</p></div></div>):<Empty/>)}{tab==="exams"&&(exams.length?exams.map(e=><div className="list-row" key={e.id}><div className="grow"><strong>{e.title}</strong><p className="subtle small">{formatDate(e.date)}{e.type==="كوز يومي"||!e.startTime?"":" · "+e.startTime}{e.room?" · "+e.room:""}</p></div><Status tone={e.status==="confirmed"?"success":"warning"}>{e.status==="confirmed"?"مؤكد":e.status==="cancelled"?"ملغى":"مؤقت"}</Status></div>):<Empty/>)}{tab==="questions"&&(questions.length?questions.map(item=><Link key={item.id} className="list-row" href={`/questions/${encodeURIComponent(item.id)}?section=${section}`}><FileText size={20}/><div className="grow"><strong>{item.title}</strong><p className="subtle small">{item.examKind==="quiz"?"كوز يومي":item.examKind==="midterm"?"Midterm":"Final"}{item.academicYear?" · "+item.academicYear:""} · {formatDate(item.createdAt)}</p></div><span className="subtle small">عرض الملف</span><ArrowUpLeft size={16}/></Link>):<Empty title="لا توجد أسئلة امتحانات سابقة منشورة لهذه المادة بعد"/>)}{tab==="summaries"&&(summaries.length?summaries.map(item=><Link key={item.id} className="list-row" href={`/lectures/${item.id}`}><FileText size={20}/><div className="grow"><strong>{item.title}</strong><p className="subtle small">{item.description ? item.description+" · " : ""}{formatDate(item.updatedAt)}</p></div><ArrowUpLeft size={16}/></Link>):<Empty title="لا توجد ملخصات منشورة لهذه المادة بعد"/>)}</div></div>}</>}
