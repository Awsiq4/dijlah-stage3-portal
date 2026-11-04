import React from "react";

export default function HeroArt(){
  return <div className="hero-art" aria-hidden="true">
    <svg viewBox="0 0 800 420" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        <linearGradient id="beamA" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#d7f27a" stopOpacity=".95"/>
          <stop offset=".4" stopColor="#20c0f8" stopOpacity=".6"/>
          <stop offset="1" stopColor="#20c0f8" stopOpacity="0"/>
        </linearGradient>
        <linearGradient id="beamB" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7ad8f7" stopOpacity=".9"/>
          <stop offset=".5" stopColor="#0090b0" stopOpacity=".5"/>
          <stop offset="1" stopColor="#0090b0" stopOpacity="0"/>
        </linearGradient>
        <radialGradient id="srcGlow" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#eafcff" stopOpacity=".95"/>
          <stop offset=".35" stopColor="#20c0f8" stopOpacity=".55"/>
          <stop offset="1" stopColor="#20c0f8" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <circle className="laser-glow" cx="70" cy="210" r="46" fill="url(#srcGlow)"/>
      <circle className="laser-ring r1" cx="70" cy="210" r="16"/>
      <circle className="laser-ring r2" cx="70" cy="210" r="16"/>
      <circle className="laser-src" cx="70" cy="210" r="4.5" fill="#f2fdff"/>
      <line className="beam b1" x1="70" y1="210" x2="800" y2="118" stroke="url(#beamA)" strokeWidth="2.6" strokeLinecap="round"/>
      <line className="beam b2" x1="70" y1="210" x2="800" y2="210" stroke="url(#beamA)" strokeWidth="2" strokeLinecap="round"/>
      <line className="beam b3" x1="70" y1="210" x2="800" y2="302" stroke="url(#beamB)" strokeWidth="1.6" strokeLinecap="round"/>
      <polygon className="prism" points="548,148 648,210 548,272"/>
      <line className="beam b4" x1="648" y1="210" x2="800" y2="176" stroke="#20c0f8" strokeWidth="1.6" strokeLinecap="round" opacity=".7"/>
      <line className="beam b5" x1="648" y1="210" x2="800" y2="214" stroke="#90b808" strokeWidth="1.4" strokeLinecap="round" opacity=".6"/>
      <line className="beam b6" x1="648" y1="210" x2="800" y2="252" stroke="#b8d038" strokeWidth="1.2" strokeLinecap="round" opacity=".5"/>
      <path className="wave" d="M0,348 C50,312 100,384 150,348 S250,312 300,348 S400,384 450,348 S550,312 600,348 S700,384 750,348 L800,348" fill="none" stroke="url(#beamA)" strokeWidth="1.4"/>
      <circle className="pt p1" cx="180" cy="300" r="2"/>
      <circle className="pt p2" cx="300" cy="330" r="1.6"/>
      <circle className="pt p3" cx="420" cy="290" r="2.2"/>
      <circle className="pt p4" cx="520" cy="330" r="1.5"/>
      <circle className="pt p5" cx="620" cy="300" r="2"/>
      <circle className="pt p6" cx="720" cy="330" r="1.7"/>
      <circle className="pt p7" cx="250" cy="120" r="1.8"/>
      <circle className="pt p8" cx="700" cy="110" r="2.1"/>
    </svg>
  </div>;
}
