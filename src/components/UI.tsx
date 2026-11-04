"use client";
import Link from "next/link";
import React from "react";
import {ChevronLeft,Info} from "lucide-react";
export function PageHeading({title,description,action}:{title:string;description?:string;action?:React.ReactNode}){return <div className="page-heading"><div><h1>{title}</h1>{description&&<p className="subtle">{description}</p>}</div>{action}</div>}
export function Empty({title="ماكو بيانات منشورة حالياً",description="عند إضافة المحتوى من لوحة الإدارة، راح يظهر هنا تلقائياً."}:{title?:string;description?:string}){return <div className="empty"><Info size={26}/><strong>{title}</strong><span>{description}</span></div>}
export function SectionCard({title,href,children,subtitle}:{title:string;href?:string;children:React.ReactNode;subtitle?:string}){return <section className="panel"><div className="panel-heading"><div><h2>{title}</h2>{subtitle&&<p className="subtle small">{subtitle}</p>}</div>{href&&<Link className="text-link" href={href}>عرض الكل <ChevronLeft size={16}/></Link>}</div>{children}</section>}
export function Status({children,tone="muted"}:{children:React.ReactNode;tone?:"muted"|"success"|"warning"|"danger"|"info"}){return <span className={`status ${tone}`}>{children}</span>}
export function Badge({children}:{children:React.ReactNode}){return <span className="pill">{children}</span>}
export function ExternalLink({href,children}:{href:string;children:React.ReactNode}){return /^https:\/\//.test(href)?<a className="action-button" target="_blank" rel="noopener noreferrer" href={href}>{children}</a>:<span className="subtle small">الرابط غير متوفر</span>}
