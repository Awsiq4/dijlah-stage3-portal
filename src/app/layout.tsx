import "./globals.css";
import type {Metadata, Viewport} from "next";
import Script from "next/script";
import {PortalProvider} from "@/lib/storage";
import AppShell from "@/components/AppShell";
export const metadata:Metadata={title:"بوابة طلبة المرحلة الثالثة | هندسة الليزر والإلكترونيات البصرية",description:"مبادرة طلابية مستقلة لمساعدة طلبة المرحلة الثالثة في متابعة المحاضرات والجدول والتبليغات."};
export const viewport:Viewport={width:"device-width",initialScale:1};
export default function RootLayout({children}:{children:React.ReactNode}){
 const themeInit=`(function(){try{var t=localStorage.getItem("dijlah-stage3-theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.dataset.theme=d?"dark":"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;
 return <html lang="ar" dir="rtl" suppressHydrationWarning><body><Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{__html:themeInit}}/><PortalProvider><AppShell>{children}</AppShell></PortalProvider></body></html>;
}
