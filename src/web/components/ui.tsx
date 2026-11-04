import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { Member } from '../../shared/apiTypes';
import type { ApiRequestError } from '../api';

export function ErrorBox({ error }: { error: ApiRequestError | null | undefined }) {
  if (!error) return null;
  return (
    <div className="error" role="alert">
      {error.message}
      {error.details.length > 0 && (
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {error.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Who({ member, size }: { member: Member | undefined; size?: 'sm' }) {
  if (!member) return <span className="muted">（已移除的家人）</span>;
  return (
    <span className="who" style={{ ['--c' as string]: member.color, fontSize: size === 'sm' ? '0.85rem' : undefined }}>
      <span className="dot" aria-hidden>
        {member.emoji}
      </span>
      {member.name}
    </span>
  );
}

/** 選家人（橫向一排） */
export function MemberPicker({
  members,
  value,
  onChange,
  allowAll,
}: {
  members: Member[];
  value: number | null;
  onChange: (id: number | null) => void;
  allowAll?: boolean;
}) {
  return (
    <div className="chips" role="group" aria-label="家人">
      {allowAll && (
        <button type="button" className="chip" aria-pressed={value === null} onClick={() => onChange(null)}>
          全家
        </button>
      )}
      {members.map((m) => (
        <button
          key={m.id}
          type="button"
          className="chip"
          aria-pressed={value === m.id}
          style={{ ['--c' as string]: m.color }}
          onClick={() => onChange(m.id)}
        >
          <span aria-hidden>{m.emoji}</span>
          {m.name}
        </button>
      ))}
    </div>
  );
}

/** 從下面滑上來的面板（手機）／置中對話框（電腦） */
export function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <div className="panel-grip" aria-hidden />
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2 id={id}>{title}</h2>
          <button type="button" className="btn quiet small" onClick={onClose}>
            關閉
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 醫師拿原子筆圈起來的那一筆（每次畫的形狀都不太一樣） */
export function InkCircle({ draw, seed = 0 }: { draw: boolean; seed?: number }) {
  const j = (n: number) => ((Math.sin(seed * 9.17 + n * 3.1) + 1) / 2) * 4 - 2;
  const d = `M ${50 + j(1)} ${6 + j(2)} C ${86 + j(3)} ${4 + j(4)}, ${98 + j(5)} ${30 + j(6)}, ${92 + j(7)} ${44 + j(8)}
    C ${84 + j(9)} ${60 + j(10)}, ${22 + j(11)} ${62 + j(12)}, ${8 + j(13)} ${44 + j(14)}
    C ${-2 + j(15)} ${28 + j(16)}, ${20 + j(17)} ${6 + j(18)}, ${58 + j(19)} ${9 + j(20)}`;
  return (
    <svg className={`ink-circle${draw ? ' draw' : ''}`} viewBox="0 0 100 66" preserveAspectRatio="none" aria-hidden>
      <path d={d} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Loading({ text = '載入中…' }: { text?: string }) {
  return <div className="loading">{text}</div>;
}

/** 附件縮圖（同網域的 cookie 會帶上，img 可以直接讀） */
export function AttachmentImage({ id, alt, contentType }: { id: number; alt: string; contentType?: string }) {
  if (contentType === 'application/pdf') {
    return (
      <a href={`/api/attachments/${id}/file`} target="_blank" rel="noreferrer">
        PDF
      </a>
    );
  }
  return (
    <a href={`/api/attachments/${id}/file`} target="_blank" rel="noreferrer">
      <img src={`/api/attachments/${id}/file`} alt={alt} loading="lazy" />
    </a>
  );
}

// ---- 圖示（線條，跟文字同色） ----

const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const Icon = {
  today: () => (
    <Svg>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16M9 15l2 2 4-4" />
    </Svg>
  ),
  log: () => (
    <Svg>
      <path d="M6 4h9l3 3v13H6z" />
      <path d="M9 10h6M9 14h6M9 18h3" />
    </Svg>
  ),
  family: () => (
    <Svg>
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="10" r="2.4" />
      <path d="M3 20c0-3 2.2-5 5-5s5 2 5 5M13.5 20c.3-2.4 1.7-4 3.5-4s3.2 1.6 3.5 4" />
    </Svg>
  ),
  visit: () => (
    <Svg>
      <path d="M12 4v4M10 6h4" />
      <rect x="4" y="9" width="16" height="11" rx="2" />
      <path d="M9 14h6M12 11v6" />
    </Svg>
  ),
  mic: () => (
    <Svg>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </Svg>
  ),
  send: () => (
    <Svg>
      <path d="M4 12l16-8-6 16-2-7z" />
    </Svg>
  ),
  camera: () => (
    <Svg>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </Svg>
  ),
  speaker: () => (
    <Svg>
      <path d="M4 10v4h4l5 4V6L8 10z" />
      <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />
    </Svg>
  ),
  muted: () => (
    <Svg>
      <path d="M4 10v4h4l5 4V6L8 10z" />
      <path d="M17 10l4 4M21 10l-4 4" />
    </Svg>
  ),
  plus: () => (
    <Svg>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
};

/** 分頁列中間的水獺頭（2D 小圖，3D 在 Dr.Claude 頁） */
export function OtterFace({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <circle cx="8.5" cy="17" r="3.2" fill="#6e4429" />
      <circle cx="31.5" cy="17" r="3.2" fill="#6e4429" />
      <ellipse cx="20" cy="21" rx="14" ry="12.5" fill="#8a5a3b" />
      <ellipse cx="20" cy="26.5" rx="10" ry="6.5" fill="#f3e3cc" />
      <circle cx="14.5" cy="19" r="2" fill="#1b1410" />
      <circle cx="25.5" cy="19" r="2" fill="#1b1410" />
      <circle cx="15.1" cy="18.4" r="0.6" fill="#fff" />
      <circle cx="26.1" cy="18.4" r="0.6" fill="#fff" />
      <ellipse cx="20" cy="23.5" rx="2.8" ry="1.8" fill="#2a1a12" />
      <path d="M20 25.3v1.7M17.5 28c1.4 1 3.6 1 5 0" stroke="#2a1a12" strokeWidth="1" fill="none" strokeLinecap="round" />
      <path d="M12 25.5h-5M12 27l-4.5 1.2M28 25.5h5M28 27l4.5 1.2" stroke="#3a2a20" strokeWidth="0.6" strokeLinecap="round" />
      <circle cx="20" cy="10.5" r="3.4" fill="#e9eef5" stroke="#9aa9bd" strokeWidth="1" />
      <circle cx="20" cy="10.5" r="1.2" fill="#9aa9bd" />
    </svg>
  );
}
