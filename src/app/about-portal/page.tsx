import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown, ArrowRight, BookOpen, CalendarDays, CalendarRange,
  ClipboardCheck, ClipboardList, FileQuestion, GraduationCap,
  Lightbulb, Megaphone, Presentation, Send, Smartphone, Target, UsersRound,
  Video,
} from "lucide-react";
import styles from "./about.module.css";

export const metadata: Metadata = {
  title: "حول البوابة | بوابة طلبة المرحلة الثالثة",
  description: "تعرّف على فكرة بوابة طلبة المرحلة الثالثة والميزات التي تساعد الطلبة على متابعة دراستهم في جامعة دجلة.",
  alternates: { canonical: "/about-portal" },
};

const features = [
  { title: "المحاضرات والملخصات", description: "عرض الملفات الدراسية وتحميلها من صفحة كل مادة.", Icon: BookOpen },
  { title: "الجدول الدراسي", description: "أوقات المحاضرات وقاعاتها وتغييرات جدول شعبتك.", Icon: CalendarDays },
  { title: "التبليغات", description: "تبليغات التدريسيين والممثلين، مع تمييز المهم والعاجل.", Icon: Megaphone },
  { title: "الامتحانات والكوزات", description: "مواعيد الامتحانات وتفاصيلها والمواضيع المطلوبة.", Icon: ClipboardCheck },
  { title: "أسئلة الامتحانات السابقة", description: "ملفات أسئلة منشورة للمراجعة والاستعداد.", Icon: FileQuestion },
  { title: "الواجبات", description: "تعليمات الواجبات وآخر مواعيد تسليمها.", Icon: ClipboardList },
  { title: "هذا الأسبوع", description: "كوزات شعبتك وواجباتها وتغييرات جدولها لهذا الأسبوع.", Icon: CalendarRange },
  { title: "إشعارات Telegram", description: "مستجدات البوابة عبر البوت بعد تفعيل الاشتراك.", Icon: Send },
  { title: "مصادر تعليمية", description: "شروحات ومواد مساندة حيث تتوفر في صفحات المواد.", Icon: Video },
  { title: "الوصول السريع", description: "من الهاتف أو الحاسوب، مع وضع مظلم واختصار للبوابة.", Icon: Smartphone },
];

export default function AboutPortal() {
  return (
    <article className={styles.page}>
      <Link href="/more" className={styles.back}>
        <ArrowRight size={17} aria-hidden="true" />
        العودة إلى المزيد
      </Link>

      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <h1>حول البوابة</h1>
          <p className={styles.tagline}>من طالب، إلى منظومة تخدم الطلاب.</p>
          <p>بوابة رقمية تجمع احتياجات طلبة المرحلة الثالثة في مكان واحد، لتجعل متابعة الدراسة أكثر تنظيماً وسهولة.</p>
        </div>
        <div className={styles.heroArt}>
          <Image
            src="/images/university-mark.png"
            width={72}
            height={72}
            alt="شعار جامعة دجلة"
            className={styles.logo}
          />
        </div>
      </header>

      <section className={`${styles.panel} ${styles.story}`} aria-labelledby="portal-story">
        <h2 id="portal-story" className={styles.iconHeading}>
          <span className={styles.icon}><Lightbulb size={21} aria-hidden="true" /></span>
          كيف بدأت الفكرة؟
        </h2>
        <p><strong>أنا أوس فارس، طالب في قسم هندسة الليزر والإلكترونيات البصرية بجامعة دجلة.</strong></p>
        <p>جاءت فكرة البوابة بعدما لاحظتُ خلال المراحل الدراسية السابقة تشتت المحاضرات والتبليغات بين مجموعات التواصل المختلفة، وصعوبة الوصول إليها عند الحاجة.</p>
        <p>وبعد الاطلاع على أنظمة الإدارة الأكاديمية في عدد من الجامعات ودراسة تجاربها، عملتُ على تصميم وتطوير بوابة طلابية تجمع احتياجاتنا الدراسية في نظام واحد، وتستفيد من التقنيات الحديثة لتسهيل تجربتنا الجامعية.</p>
      </section>

      <section aria-labelledby="portal-features">
        <h2 id="portal-features" className={styles.sectionHeading}>ماذا تقدم البوابة؟</h2>
        <ul className={styles.features} role="list">
          {features.map(({ title, description, Icon }) => (
            <li key={title} className={styles.feature}>
              <span className={styles.icon}><Icon size={20} aria-hidden="true" /></span>
              <h3>{title}</h3>
              <p>{description}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${styles.panel} ${styles.workflow}`} aria-labelledby="portal-workflow">
        <h2 id="portal-workflow" className={styles.sectionHeading}>كيف يعمل النظام؟</h2>
        <div className={styles.publishers}>
          <div className={styles.role}>
            <h3 className={styles.iconHeading}><Presentation size={21} aria-hidden="true" /> التدريسيون</h3>
            <p>ينشرون محاضرات موادهم وتبليغاتها وواجباتها وكوزاتها اليومية، ويحدّثون منشوراتهم ضمن صلاحياتهم.</p>
          </div>
          <div className={styles.role}>
            <h3 className={styles.iconHeading}><UsersRound size={21} aria-hidden="true" /> الممثل العام وممثلو الشعب</h3>
            <p>ينشر الممثل العام التبليغات العامة، وينشر ممثل الشعبة تبليغات شعبته. ويساهمون في نشر المحتوى الدراسي للشعب المعنية وفق صلاحياتهم.</p>
          </div>
        </div>
        <div className={styles.channel}>
          <p>ينشر المخوّلون عبر لوحة الإدارة أو أدوات النشر المتاحة في بوت Telegram بعد ربط حسابهم.</p>
          <ArrowDown size={18} aria-hidden="true" />
        </div>
        <div className={`${styles.role} ${styles.students}`}>
          <h3 className={styles.iconHeading}><GraduationCap size={22} aria-hidden="true" /> الطلاب</h3>
          <p>يتابعون المنشورات ويصلون إلى معلومات موادهم وشعبهم دون الحاجة إلى تسجيل الدخول.</p>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.vision}`} aria-labelledby="portal-vision">
        <h2 id="portal-vision" className={styles.iconHeading}>
          <span className={styles.icon}><Target size={21} aria-hidden="true" /></span>
          الرؤية
        </h2>
        <p>أن تكون البوابة نموذجاً لمبادرة طلابية توظّف التكنولوجيا في تنظيم الدراسة وتسهيل الوصول إلى المعلومات، وتساهم في تقديم تجربة جامعية أكثر تطوراً ومرونة.</p>
        <p className={styles.visionLine}>«حتى تكون المرحلة الثالثة أسهل علينا جميعاً.»</p>
      </section>

      <section className={`${styles.panel} ${styles.credit}`} aria-labelledby="portal-credit">
        <div>
          <h2 id="portal-credit">فكرة وتصميم وتطوير</h2>
          <p className={styles.signature} dir="ltr"><bdi lang="en">Aws Faris</bdi> <span aria-hidden="true">|</span> <bdi lang="ar">أوس فارس</bdi></p>
          <p>طالب في قسم هندسة الليزر والإلكترونيات البصرية<br />كلية الهندسة – جامعة دجلة</p>
        </div>
        <bdi className={styles.year}>2026–2027</bdi>
        <p className={styles.creditNote}>مبادرة طلابية مستقلة طُوّرت لخدمة طلبة المرحلة الثالثة.</p>
      </section>
    </article>
  );
}
