"use client";

import {useEffect, useRef, useState} from "react";
import {Check, Copy, Download, Monitor, Smartphone} from "lucide-react";
import {SectionCard} from "@/components/UI";
import {usePortalInstallation} from "@/components/PortalInstallation";
import styles from "./install.module.css";

const PORTAL_URL = "https://dj3.top/";

const guides = {
  ios: {
    label: "iPhone أو iPad · Safari",
    icon: Smartphone,
    steps: [
      "افتح الصفحة الرئيسية للبوابة في Safari.",
      "اضغط زر المشاركة. إذا لم يظهر، افتح قائمة الصفحة ثم اختر مشاركة.",
      "اختر «إضافة إلى الشاشة الرئيسية». فعّل «فتح كتطبيق ويب» إذا ظهر وأردت فتح البوابة في نافذة مستقلة، ثم اضغط «إضافة».",
    ],
  },
  android: {
    label: "Android · Chrome",
    icon: Smartphone,
    steps: [
      "افتح الصفحة الرئيسية للبوابة في Chrome.",
      "من قائمة ⋮ اختر «التثبيت وإنشاء اختصار» أو «إضافة إلى الشاشة الرئيسية»، حسب إصدار Chrome.",
      "اختر «تثبيت» أو «إنشاء اختصار» حسب المتاح، ثم أكّد الإضافة.",
    ],
  },
  chrome: {
    label: "Windows أو Mac · Chrome",
    icon: Monitor,
    steps: [
      "افتح الصفحة الرئيسية للبوابة في Chrome.",
      "من قائمة ⋮ افتح «البث والحفظ والمشاركة»، ثم اختر «تثبيت الصفحة كتطبيق» وأكّد التثبيت.",
      "إذا أردت اختصاراً عادياً وكان خيار «إنشاء اختصار» متاحاً، اختره من القائمة نفسها.",
    ],
  },
  edge: {
    label: "Windows · Microsoft Edge",
    icon: Monitor,
    steps: [
      "افتح الصفحة الرئيسية للبوابة في Microsoft Edge.",
      "من قائمة ⋯ افتح «المزيد من الأدوات» ثم «التطبيقات» واختر «تثبيت هذا الموقع كتطبيق».",
      "لإضافة اختصار إلى سطح المكتب، افتح تفاصيل البوابة في صفحة تطبيقات Edge واختر «إنشاء اختصار لسطح المكتب».",
    ],
  },
  mac: {
    label: "Mac · Safari",
    icon: Monitor,
    steps: [
      "افتح الصفحة الرئيسية للبوابة في Safari على macOS Sonoma أو أحدث.",
      "اضغط «مشاركة» ثم «إضافة إلى Dock».",
      "اضغط «إضافة» وافتح البوابة من أيقونتها في Dock.",
    ],
  },
};

type Guide = keyof typeof guides;

function detectGuide(userAgent: string, platform: string, touchPoints: number): Guide | null {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (platform === "MacIntel" && touchPoints > 1)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  if (/Windows/i.test(userAgent) && /Edg\//i.test(userAgent)) return "edge";
  if (/Chrome\/|Chromium\//i.test(userAgent) && !/Edg\/|OPR\//i.test(userAgent)) return "chrome";
  if (/Macintosh/i.test(userAgent) && /Version\/.*Safari\//i.test(userAgent)) return "mac";
  return null;
}

export default function InstallGuide() {
  const [suggested, setSuggested] = useState<Guide | null>(null);
  const [selected, setSelected] = useState<Guide | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const linkInput = useRef<HTMLInputElement>(null);
  const {installed, canInstall, install} = usePortalInstallation();
  const guideId = selected ?? suggested;
  const guide = guideId ? guides[guideId] : null;

  useEffect(() => {
    setSuggested(detectGuide(navigator.userAgent, navigator.platform, navigator.maxTouchPoints));
  }, []);

  useEffect(() => {
    if (copyState === "manual") {
      linkInput.current?.focus();
      linkInput.current?.select();
    }
  }, [copyState]);

  async function copyPortalLink() {
    try {
      await navigator.clipboard.writeText(PORTAL_URL);
      setCopyState("copied");
    } catch {
      if (copyState === "manual") {
        linkInput.current?.focus();
        linkInput.current?.select();
      }
      setCopyState("manual");
    }
  }

  const devicePicker = (
    <div className={styles.picker}>
      <label htmlFor="install-device">اختر جهازك أو متصفحك</label>
      <select id="install-device" value={guideId ?? ""} onChange={event => setSelected(event.target.value as Guide)}>
        <option value="" disabled>اختر من القائمة</option>
        {Object.entries(guides).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
      </select>
    </div>
  );

  return (
    <div className={`stack ${styles.guide}`}>
      <SectionCard title="خطوات الإضافة">
        <div className={`panel-body ${styles.body}`}>
          {installed && <p role="status" className={styles.installed}><Check size={18} aria-hidden="true"/> البوابة مثبتة على هذا الجهاز</p>}
          {canInstall && <button className="action-button" type="button" onClick={install}><Download size={18} aria-hidden="true"/> تثبيت البوابة</button>}
          {!suggested && devicePicker}
          {guide && <div>
            <h3 className={styles.deviceHeading}><guide.icon size={19} aria-hidden="true"/>{guide.label}</h3>
            <ol className={styles.steps}>
              {guide.steps.map(step => <li key={step}>{step}</li>)}
            </ol>
          </div>}
          {suggested && <details className={styles.other}>
            <summary>أجهزة أخرى</summary>
            {devicePicker}
          </details>}
        </div>
      </SectionCard>

      <SectionCard title="تفتح البوابة من تيليجرام؟">
        <div className={`panel-body ${styles.body}`}>
          <p className="subtle">انسخ رابط البوابة وافتحه في Safari أو Chrome لتظهر خيارات الإضافة.</p>
          <button className="action-button secondary" type="button" onClick={copyPortalLink}><Copy size={17} aria-hidden="true"/> نسخ رابط البوابة</button>
          <span role="status" className={styles.copyStatus}>
            {copyState === "copied" ? "تم نسخ رابط البوابة" : copyState === "manual" ? "حدّد الرابط وانسخه يدوياً." : ""}
          </span>
          {copyState === "manual" && <input ref={linkInput} className={styles.link} dir="ltr" aria-label="رابط البوابة" readOnly value={PORTAL_URL} onClick={event => event.currentTarget.select()}/>}
        </div>
      </SectionCard>
    </div>
  );
}
