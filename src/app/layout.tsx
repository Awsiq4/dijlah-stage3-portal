import "./globals.css";
import type {Metadata, Viewport} from "next";
import Script from "next/script";
import {PortalProvider} from "@/lib/storage";
import AppShell from "@/components/AppShell";
export const metadata:Metadata={
 metadataBase:new URL("https://dj3.top"),
 title:"بوابة طلبة المرحلة الثالثة | هندسة الليزر والإلكترونيات البصرية",
 description:"مبادرة طلابية مستقلة لمساعدة طلبة المرحلة الثالثة في متابعة المحاضرات والجدول والتبليغات والواجبات.",
 openGraph:{
  type:"website",locale:"ar_IQ",siteName:"بوابة طلبة المرحلة الثالثة",
  title:"بوابة طلبة المرحلة الثالثة – جامعة دجلة",
  description:"المحاضرات والجداول والتبليغات والواجبات في مكان واحد.",
  url:"https://dj3.top",
  images:[{url:"/images/university-mark.png",width:1024,height:1024,alt:"شعار جامعة دجلة"}],
 },
 twitter:{card:"summary"},
};
export const viewport:Viewport={width:"device-width",initialScale:1};
export default function RootLayout({children}:{children:React.ReactNode}){
 const themeInit=`(function(){try{var t=localStorage.getItem("dijlah-stage3-theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.dataset.theme=d?"dark":"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;
 return <html lang="ar" dir="rtl" suppressHydrationWarning><body><Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{__html:themeInit}}/><PortalProvider><AppShell>{children}</AppShell></PortalProvider></body></html>;
}
