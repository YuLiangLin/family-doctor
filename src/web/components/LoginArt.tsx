// 登入頁的海獺插圖：Dr.水獺 浮在水上、穿小白袍、戴額鏡、雙手捧臉頰（同 App 圖示，scripts/gen-icons.mjs）。
// 會跟著水波上下漂、眨眼、漣漪一圈圈往外；動畫都是 CSS（styles.css 的 .la-*），系統要求減少動態時停住。
import { useId } from 'react';

export function LoginArt({ mood = 'calm' }: { mood?: 'calm' | 'concerned' }) {
  const id = useId().replace(/:/g, '');
  const hd = `la-hd-${id}`;
  const ch = `la-ch-${id}`;
  const wt = `la-wt-${id}`;
  return (
    <svg className="login-art" viewBox="0 0 120 104" role="img" aria-label="Dr.水獺">
      <defs>
        <radialGradient id={hd} cx="50%" cy="36%" r="64%">
          <stop offset="0" stopColor="#f8f4ec" />
          <stop offset="1" stopColor="#d6c7b2" />
        </radialGradient>
        <linearGradient id={ch} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bca386" />
          <stop offset="1" stopColor="#432f25" />
        </linearGradient>
        <radialGradient id={wt} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="var(--la-water-a)" />
          <stop offset="0.6" stopColor="var(--la-water-b)" />
          <stop offset="1" stopColor="var(--la-water-b)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 水面與漣漪 */}
      <ellipse cx="60" cy="92" rx="58" ry="11" fill={`url(#${wt})`} />
      <ellipse className="la-ripple" cx="60" cy="92" rx="30" ry="5.6" />
      <ellipse className="la-ripple r2" cx="60" cy="92" rx="30" ry="5.6" />
      <ellipse className="la-ripple r3" cx="60" cy="92" rx="30" ry="5.6" />

      <g className="la-bob">
        <g transform="translate(10 2)">
          {/* 小白袍、胸口的毛、聽診器 */}
          <path d="M26 90c-1.2-14 1.6-26 8.4-33h31.2c6.8 7 9.6 19 8.4 33z" fill="#f3f5f8" />
          <path d="M40 62l10 22 10-22z" fill={`url(#${ch})`} />
          <path d="M45 76.5l5 9.5 5-9.5" fill="none" stroke="#dfe5ec" strokeWidth="0.8" />
          <path d="M36 64c2.5 8.5 8 14 14 15.5 6-1.5 11.5-7 14-15.5" stroke="#3a86ff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <circle cx="50" cy="80.8" r="3.6" fill="#eef2f6" stroke="#b8c2cd" strokeWidth="0.8" />
          <rect x="63" y="71" width="7" height="0.9" rx="0.45" fill="#d5dce5" />
          <rect x="66.2" y="66.5" width="1.6" height="5.6" rx="0.8" fill="#3a86ff" />
          {/* 袖子 */}
          <path d="M24 74c-2-4-1.6-8 .6-10.6l7.4 3.2c-.8 3-.4 6 1 8.6z" fill="#f3f5f8" />
          <path d="M76 74c2-4 1.6-8-.6-10.6l-7.4 3.2c.8 3 .4 6-1 8.6z" fill="#f3f5f8" />
          {/* 耳朵、頭 */}
          <circle cx="21.5" cy="34" r="4.6" fill="#8a735e" />
          <circle cx="78.5" cy="34" r="4.6" fill="#8a735e" />
          <path
            d="M50 18c18 0 31 10.5 31 26 0 10-5 17.5-12.6 21.8C63.4 68.6 57 70 50 70s-13.4-1.4-18.4-4.2C24 61.5 19 54 19 44c0-15.5 13-26 31-26z"
            fill={`url(#${hd})`}
          />
          {/* 額鏡 */}
          <path d="M19.6 37.5C26.5 29.5 37.4 25.5 50 25.5s23.5 4 30.4 12" stroke="#3b4a5e" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <circle cx="64" cy="25.5" r="7" fill="#eef3f8" stroke="#9aa9bd" strokeWidth="1.6" />
          <circle cx="64" cy="25.5" r="2" fill="#3b4a5e" />
          <path className="la-glint" d="M59.6 22.6a5.4 5.4 0 0 1 3.4-2.6" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          {/* 眉毛（擔心時） */}
          {mood === 'concerned' && (
            <g stroke="#a48d74" strokeWidth="1.6" strokeLinecap="round">
              <path d="M34.5 37.6l6-1.8" />
              <path d="M65.5 37.6l-6-1.8" />
            </g>
          )}
          {/* 鬍鬚墊（ω）、眼睛、鼻子 */}
          <ellipse cx="44.4" cy="57.4" rx="6.6" ry="5.2" fill="#faf6ef" />
          <ellipse cx="55.6" cy="57.4" rx="6.6" ry="5.2" fill="#faf6ef" />
          <path d="M40 60c2.4 2.5 6.6 2.7 10 .4 3.4 2.3 7.6 2.1 10-.4" stroke="#b09a86" strokeWidth="1.1" fill="none" strokeLinecap="round" />
          <g className="la-eyes">
            <circle cx="39" cy="44.5" r="3.6" fill="#120d0b" />
            <circle cx="61" cy="44.5" r="3.6" fill="#120d0b" />
            <circle cx="40.1" cy="43.2" r="1.2" fill="#fff" />
            <circle cx="62.1" cy="43.2" r="1.2" fill="#fff" />
          </g>
          <path d="M42 50.2c0-2.5 3.6-3.8 8-3.8s8 1.3 8 3.8c0 3.1-4.4 6.6-8 6.6s-8-3.5-8-6.6z" fill="#1b1411" />
          <ellipse cx="46.6" cy="48.6" rx="2" ry="0.9" fill="#fff" opacity="0.55" />
          <g className="la-whiskers" stroke="var(--la-whisker)" strokeWidth="0.8" strokeLinecap="round">
            <path d="M37 56.5c-6-2-12-2.8-19-2.4M37 58.8c-6-1-12.5-1-19.5.4M37.5 61c-5.5-.2-11 .4-17 2" fill="none" />
            <path d="M63 56.5c6-2 12-2.8 19-2.4M63 58.8c6-1 12.5-1 19.5.4M62.5 61c5.5-.2 11 .4 17 2" fill="none" />
          </g>
          {/* 捧著臉頰的爪子 */}
          <ellipse cx="28.5" cy="66" rx="5.8" ry="7" fill="#2e211a" transform="rotate(-20 28.5 66)" />
          <ellipse cx="71.5" cy="66" rx="5.8" ry="7" fill="#2e211a" transform="rotate(20 71.5 66)" />
        </g>
      </g>

      {/* 前面的水線：蓋住身體下緣 */}
      <path d="M33 92.4c4 2.8 12.6 4.6 27 4.6s23-1.8 27-4.6c-6.4-1.6-15.6-2.6-27-2.6s-20.6 1-27 2.6z" fill="var(--la-water-front)" />
      <path className="la-shine" d="M44 92.8c4 .9 9.4 1.3 16 1.3" stroke="#fff" strokeWidth="0.9" fill="none" strokeLinecap="round" />
    </svg>
  );
}
