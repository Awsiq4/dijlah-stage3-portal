"use client";
import {useState} from "react";
import {BrainCircuit,Send,ShieldAlert} from "lucide-react";
import {PageHeading} from "@/components/UI";
export default function AiAssistant(){const [message,setMessage]=useState("");return <><PageHeading title="المساعد الذكي" description="مساعد دراسي يعتمد على ملفات المحاضرات ومراجعها"/><div className="ai-layout"><div className="ai-panel"><div className="ai-welcome"><BrainCircuit size={34}/><h2>اسأل عن محاضراتك</h2><p>ميزة الإجابة المستندة إلى PDF لم تُربط بعد. لازم يصير استخراج وفهرسة للمحاضرات مع توثيق الصفحة والمصدر.</p></div><div className="ai-caution"><ShieldAlert size={18}/><p>هذا نموذج للواجهة فقط. لن يرسل السؤال لأي خدمة خارجية ولن يولّد إجابات تخمينية.</p></div><form className="ai-input" onSubmit={e=>e.preventDefault()}><input value={message} onChange={e=>setMessage(e.target.value)} placeholder="اكتب سؤالك هنا..." aria-label="سؤالك"/><button disabled aria-label="الإرسال غير مفعل"><Send size={18}/></button></form></div></div></>}
