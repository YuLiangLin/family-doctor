import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { tokenActorName, type Member } from '../../shared/apiTypes';
import type { Slot } from '../../shared/meds';
import type { ApiRequestError } from '../api';

// ---------------------------------------------------------------------------
// 錯誤、提示、空狀態
// ---------------------------------------------------------------------------

export function ErrorBox({ error }: { error: ApiRequestError | null | undefined }) {
  if (!error) return null;
  return (
    <div className="alert error" role="alert">
      <Icon.alert />
      <div>
        {error.message}
        {error.details.length > 0 && (
          <ul>
            {error.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Alert({ kind = 'info', icon, children }: { kind?: 'info' | 'warn' | 'error' | 'ok'; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      {icon ?? (kind === 'ok' ? <Icon.check /> : kind === 'info' ? <Icon.info /> : <Icon.alert />)}
      <div className="grow">{children}</div>
    </div>
  );
}

/** 用 API token（Claude Code 等程式）建的紀錄：標出是哪一把 */
export function ViaTag({ by }: { by: string | null | undefined }) {
  const name = tokenActorName(by);
  if (!name) return null;
  return (
    <span className="tag" title="用 API token 建的紀錄">
      <Icon.key />
      經 API：{name}
    </span>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="art">{icon}</div>}
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ text = '載入中' }: { text?: string }) {
  return (
    <div className="inline-loading" role="status">
      <span className="dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      {text}
    </div>
  );
}

/** 頁面骨架：資料回來前先排出版面，不會整頁跳 */
export function PageSkeleton({ wide }: { wide?: boolean }) {
  return (
    <div className={`page${wide ? ' wide' : ''}`} aria-busy="true" aria-label="載入中">
      <div className="skel" style={{ width: 120, height: 14, marginBottom: 10 }} />
      <div className="skel" style={{ width: 220, height: 30, marginBottom: 26 }} />
      <div className="stack">
        <div className="skel" style={{ height: 150, borderRadius: 24 }} />
        <div className="skel" style={{ height: 88, borderRadius: 18 }} />
        <div className="skel" style={{ height: 220, borderRadius: 18 }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 頁首
// ---------------------------------------------------------------------------

export function PageHead({
  title,
  eyebrow,
  sub,
  actions,
  back,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  back?: { label: string; onClick: () => void };
}) {
  return (
    <>
      {back && (
        <button type="button" className="back-link" onClick={back.onClick}>
          <Icon.chevronLeft />
          {back.label}
        </button>
      )}
      <header className="page-head">
        <div className="titles">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </header>
    </>
  );
}

// ---------------------------------------------------------------------------
// 家人
// ---------------------------------------------------------------------------

export function Avatar({ member, size = 36, title }: { member: Pick<Member, 'emoji' | 'color'> | undefined; size?: number; title?: string }) {
  const style = { ['--s' as string]: `${size}px`, ['--c' as string]: member?.color ?? 'var(--text-3)' } as CSSProperties;
  return (
    <span className="avatar" style={style} aria-hidden={!title} title={title}>
      {member?.emoji ?? '？'}
    </span>
  );
}

/** 登入帳號的頭像：有 Google 照片用照片，沒有用名字第一個字 */
export function UserAvatar({ picture, name, size = 36 }: { picture: string; name: string; size?: number }) {
  const style = { ['--s' as string]: `${size}px` } as CSSProperties;
  if (picture)
    return (
      <span className="avatar" style={style} aria-hidden>
        <img src={picture} alt="" referrerPolicy="no-referrer" />
      </span>
    );
  return (
    <span className="avatar initial" style={style} aria-hidden>
      {(name || '我').slice(0, 1)}
    </span>
  );
}

export function Who({ member, size = 22 }: { member: Member | undefined; size?: number }) {
  if (!member) return <span className="muted">（已移除的家人）</span>;
  return (
    <span className="who">
      <Avatar member={member} size={size} />
      {member.name}
    </span>
  );
}

/** 選家人（手機橫向捲動、電腦換行） */
export function MemberPicker({
  members,
  value,
  onChange,
  allowAll,
  label = '家人',
}: {
  members: Member[];
  value: number | null;
  onChange: (id: number | null) => void;
  allowAll?: boolean;
  label?: string;
}) {
  return (
    <div className="members-pick" role="group" aria-label={label}>
      {allowAll && (
        <button type="button" className="member-chip all" aria-pressed={value === null} onClick={() => onChange(null)}>
          全家
        </button>
      )}
      {members.map((m) => (
        <button
          key={m.id}
          type="button"
          className="member-chip"
          aria-pressed={value === m.id}
          style={{ ['--c' as string]: m.color } as CSSProperties}
          onClick={() => onChange(m.id)}
        >
          <Avatar member={m} size={30} />
          {m.name}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 面板：手機從下面滑上來，電腦置中
// ---------------------------------------------------------------------------

export function Panel({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    // 手機上自動 focus 會跳出鍵盤擋住畫面：只在有實體鍵盤的裝置才 focus 第一個欄位
    if (window.matchMedia('(pointer: fine)').matches) {
      ref.current?.querySelector<HTMLElement>('.panel-body input:not([type=radio]):not([type=checkbox]), .panel-body textarea')?.focus();
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  // 畫在 body 底下：頁面有進場動畫（transform），面板放在頁面裡會被框在頁面範圍內
  return createPortal(
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} style={wide ? { maxWidth: 680 } : undefined}>
        <div className="panel-grip" aria-hidden />
        <div className="panel-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="關閉">
            <Icon.close />
          </button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// 對話框（取代 confirm／prompt）與提示訊息（取代 alert）
// ---------------------------------------------------------------------------

interface DialogRequest {
  title: string;
  message?: string;
  confirmText?: string;
  danger?: boolean;
  /** 有 input 就是 prompt */
  input?: { label: string; placeholder?: string; defaultValue?: string; required?: boolean };
  resolve: (v: string | boolean | null) => void;
}

let pushDialog: ((d: DialogRequest) => void) | null = null;

/** 確認：按確定回 true */
export function confirmDialog(opts: { title: string; message?: string; confirmText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    if (!pushDialog) return resolve(window.confirm(opts.title));
    pushDialog({ ...opts, resolve: (v) => resolve(v === true) });
  });
}

/** 請使用者輸入一句話（例：停藥原因）；按取消回 null */
export function promptDialog(opts: {
  title: string;
  message?: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  confirmText?: string;
  danger?: boolean;
}): Promise<string | null> {
  const { label, placeholder, defaultValue, required, ...rest } = opts;
  return new Promise((resolve) => {
    if (!pushDialog) return resolve(window.prompt(opts.title, defaultValue ?? ''));
    pushDialog({ ...rest, input: { label, placeholder, defaultValue, required }, resolve: (v) => resolve(typeof v === 'string' ? v : null) });
  });
}

export function DialogHost() {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const current = queue[0];
  useEffect(() => {
    pushDialog = (d) => setQueue((q) => [...q, d]);
    return () => {
      pushDialog = null;
    };
  }, []);
  useEffect(() => {
    if (!current) return;
    setValue(current.input?.defaultValue ?? '');
    const t = window.setTimeout(() => (current.input ? input.current?.focus() : confirmBtn.current?.focus()), 30);
    return () => window.clearTimeout(t);
  }, [current]);
  if (!current) return null;
  const close = (v: string | boolean | null) => {
    current.resolve(v);
    setQueue((q) => q.slice(1));
  };
  const disabled = !!current.input?.required && !value.trim();
  return (
    <div className="backdrop dialog-backdrop" onClick={(e) => e.target === e.currentTarget && close(current.input ? null : false)}>
      <form
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={current.title}
        onKeyDown={(e) => e.key === 'Escape' && close(current.input ? null : false)}
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled) close(current.input ? value.trim() : true);
        }}
      >
        <h2>{current.title}</h2>
        {current.message && <p>{current.message}</p>}
        {current.input && (
          <label className="field">
            <span>{current.input.label}</span>
            <input ref={input} value={value} onChange={(e) => setValue(e.target.value)} placeholder={current.input.placeholder} />
          </label>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn secondary" onClick={() => close(current.input ? null : false)}>
            取消
          </button>
          <button ref={confirmBtn} className={`btn${current.danger ? ' danger solid' : ''}`} disabled={disabled}>
            {current.confirmText ?? '確定'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface ToastItem {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}
let pushToast: ((t: ToastItem) => void) | null = null;
let toastSeq = 0;

/** 畫面下方跳一行字，兩秒多自己消失 */
export function toast(text: string, kind: 'ok' | 'error' = 'ok') {
  pushToast?.({ id: ++toastSeq, text, kind });
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      setItems((cur) => [...cur.slice(-2), t]);
      window.setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), t.kind === 'error' ? 4200 : 2600);
    };
    return () => {
      pushToast = null;
    };
  }, []);
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          {t.kind === 'ok' ? <Icon.checkCircle /> : <Icon.alert />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 原子筆：圈起來＋打勾（每一格畫的形狀都不太一樣）
// ---------------------------------------------------------------------------

export function InkMark({ draw, seed = 0 }: { draw: boolean; seed?: number }) {
  const j = (n: number) => ((Math.sin(seed * 9.17 + n * 3.1) + 1) / 2) * 3 - 1.5;
  const circle = `M ${26 + j(1)} ${3 + j(2)} C ${44 + j(3)} ${2 + j(4)}, ${50 + j(5)} ${18 + j(6)}, ${47 + j(7)} ${30 + j(8)}
    C ${43 + j(9)} ${45 + j(10)}, ${14 + j(11)} ${50 + j(12)}, ${5 + j(13)} ${34 + j(14)}
    C ${-1 + j(15)} ${20 + j(16)}, ${10 + j(17)} ${3 + j(18)}, ${32 + j(19)} ${5 + j(20)}`;
  const check = `M ${15 + j(21)} ${26 + j(22)} L ${22 + j(23)} ${33 + j(24)} L ${36 + j(25)} ${16 + j(26)}`;
  return (
    <svg className={`ink${draw ? ' draw' : ''}`} viewBox="0 0 52 52" aria-hidden>
      <path className="circle" d={circle} />
      <path className="check" d={check} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Dr.Claude 回覆：段落與條列（不吃 HTML，只認 - 條列、1. 編號、**粗體**）
// ---------------------------------------------------------------------------

const LIST_RE = /^\s*(?:[-•*・]|\d{1,2}[.)、])\s+/;
const ORDERED_RE = /^\s*\d{1,2}[.)、]\s+/;

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={blocks.length}>
          {para.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {inline(l.replace(/^#{1,4}\s+/, ''))}
            </Fragment>
          ))}
        </p>,
      );
    }
    para = [];
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    }
    list = null;
  };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    if (LIST_RE.test(line)) {
      flushPara();
      const ordered = ORDERED_RE.test(line);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(line.replace(LIST_RE, ''));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className="rich">{blocks}</div>;
}

// ---------------------------------------------------------------------------
// 附件
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 圖示（24 格線、1.75 線寬、跟文字同色）
// ---------------------------------------------------------------------------

const Svg = ({ children, sw = 1.75 }: { children: ReactNode; sw?: number }) => (
  <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const Icon = {
  today: () => (
    <Svg>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M8 3v4M16 3v4M3.5 10h17M9 15.2l2.1 2.1 4-4.2" />
    </Svg>
  ),
  log: () => (
    <Svg>
      <path d="M6.5 3.5h8l4 4v12a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19.5v-14.5a1.5 1.5 0 0 1 1.5-1.5z" />
      <path d="M14.5 3.5v4h4M8.5 12.5h7M8.5 16.5h4.5" />
    </Svg>
  ),
  family: () => (
    <Svg>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c.4-3.3 2.6-5.3 5.5-5.3s5.1 2 5.5 5.3" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M15.6 14.4c.5-.2 1-.3 1.6-.3 2.1 0 3.6 1.5 3.9 4" />
    </Svg>
  ),
  visit: () => (
    <Svg>
      <rect x="3.5" y="7" width="17" height="13" rx="2.5" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M12 10.5v6M9 13.5h6" />
    </Svg>
  ),
  plus: () => (
    <Svg sw={2}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  plusSquare: () => (
    <Svg>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </Svg>
  ),
  mic: () => (
    <Svg>
      <rect x="9" y="3" width="6" height="11.5" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </Svg>
  ),
  send: () => (
    <Svg sw={2.1}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Svg>
  ),
  camera: () => (
    <Svg>
      <path d="M4.5 7.5h2.8l1.6-2.2a1 1 0 0 1 .8-.4h4.6a1 1 0 0 1 .8.4l1.6 2.2h2.8a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V9a1.5 1.5 0 0 1 1.5-1.5z" />
      <circle cx="12" cy="13.2" r="3.4" />
    </Svg>
  ),
  speaker: () => (
    <Svg>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
      <path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 6.8a7.5 7.5 0 0 1 0 10.4" />
    </Svg>
  ),
  muted: () => (
    <Svg>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
      <path d="M16 10l4.5 4.5M20.5 10L16 14.5" />
    </Svg>
  ),
  wave: () => (
    <Svg>
      <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
    </Svg>
  ),
  keyboard: () => (
    <Svg>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9" />
    </Svg>
  ),
  stop: () => (
    <Svg>
      <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
    </Svg>
  ),
  history: () => (
    <Svg>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3.5 4.5V8H7M12 7.5V12l3 2" />
    </Svg>
  ),
  compose: () => (
    <Svg>
      <path d="M12 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V12" />
      <path d="M17.6 3.6a1.9 1.9 0 0 1 2.8 2.8L12.5 14.3 9 15l.7-3.5z" />
    </Svg>
  ),
  close: () => (
    <Svg sw={2}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  ),
  chevronLeft: () => (
    <Svg sw={2}>
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </Svg>
  ),
  chevronRight: () => (
    <Svg sw={2}>
      <path d="M9.5 5.5L16 12l-6.5 6.5" />
    </Svg>
  ),
  chevronDown: () => (
    <Svg sw={2}>
      <path d="M6 9.5l6 6 6-6" />
    </Svg>
  ),
  check: () => (
    <Svg sw={2.2}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  ),
  checkCircle: () => (
    <Svg sw={2}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.3l2.8 2.8L16.2 9.6" />
    </Svg>
  ),
  thermometer: () => (
    <Svg>
      <path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z" />
      <path d="M12 9v7.5" />
    </Svg>
  ),
  note: () => (
    <Svg>
      <path d="M5.5 4.5h9l4 4v11a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1z" />
      <path d="M8.5 11.5h7M8.5 15h4.5" />
      <path d="M14.5 4.5v4h4" />
    </Svg>
  ),
  heartPulse: () => (
    <Svg>
      <path d="M19.5 12.6c1.6-1.7 2-4.6.3-6.5a4.6 4.6 0 0 0-6.8 0L12 7.2l-1-1.1a4.6 4.6 0 0 0-6.8 0c-1.7 1.9-1.3 4.8.3 6.5L12 20z" />
      <path d="M3.5 12h4l1.5-2.5 2.5 5 1.5-2.5h3" />
    </Svg>
  ),
  pill: () => (
    <Svg>
      <rect x="2.8" y="8.2" width="18.4" height="7.6" rx="3.8" transform="rotate(-45 12 12)" />
      <path d="M8.9 8.9l6.2 6.2" />
    </Svg>
  ),
  scale: () => (
    <Svg>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M8 9.5a5 5 0 0 1 8 0M12 9.5l1.5-2" />
    </Svg>
  ),
  ruler: () => (
    <Svg>
      <rect x="8" y="2.5" width="8" height="19" rx="1.5" />
      <path d="M8 6.5h3M8 10h2M8 13.5h3M8 17h2" />
    </Svg>
  ),
  droplet: () => (
    <Svg>
      <path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z" />
    </Svg>
  ),
  gauge: () => (
    <Svg>
      <path d="M4 16a8 8 0 1 1 16 0" />
      <path d="M12 16l3.5-4.5M4 19.5h16" />
    </Svg>
  ),
  settings: () => (
    <Svg>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1v-.3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1z" />
    </Svg>
  ),
  logout: () => (
    <Svg>
      <path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M10 16.5L5.5 12 10 7.5M5.5 12h10" />
    </Svg>
  ),
  trash: () => (
    <Svg>
      <path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12" />
    </Svg>
  ),
  edit: () => (
    <Svg>
      <path d="M16.5 4.2a2.1 2.1 0 0 1 3 3L8.5 18.2 4.5 19.5l1.3-4z" />
    </Svg>
  ),
  alert: () => (
    <Svg>
      <path d="M10.3 4.3L2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 17h.01" />
    </Svg>
  ),
  info: () => (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.8h.01" />
    </Svg>
  ),
  phone: () => (
    <Svg>
      <path d="M20.5 16.6v2.6a1.7 1.7 0 0 1-1.9 1.7 17 17 0 0 1-7.4-2.6 16.8 16.8 0 0 1-5.2-5.2A17 17 0 0 1 3.4 5.6 1.7 1.7 0 0 1 5.1 3.7h2.6a1.7 1.7 0 0 1 1.7 1.5c.1.8.3 1.7.6 2.4a1.7 1.7 0 0 1-.4 1.8L8.5 10.5a13.6 13.6 0 0 0 5.2 5.2l1.1-1.1a1.7 1.7 0 0 1 1.8-.4c.8.3 1.6.5 2.4.6a1.7 1.7 0 0 1 1.5 1.8z" />
    </Svg>
  ),
  bell: () => (
    <Svg>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15.5 6 9.5zM10.2 20.5a2 2 0 0 0 3.6 0" />
    </Svg>
  ),
  sparkle: () => (
    <Svg>
      <path d="M12 3.5l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8zM19 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </Svg>
  ),
  calendar: () => (
    <Svg>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </Svg>
  ),
  clock: () => (
    <Svg>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  ),
  user: () => (
    <Svg>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20c.6-3.7 3.6-6 7.5-6s6.9 2.3 7.5 6" />
    </Svg>
  ),
  shield: () => (
    <Svg>
      <path d="M12 3.5l7 2.8v5.3c0 4.4-3 7.7-7 8.9-4-1.2-7-4.5-7-8.9V6.3z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </Svg>
  ),
  download: () => (
    <Svg>
      <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M4.5 19.5h15" />
    </Svg>
  ),
  sun: () => (
    <Svg>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
    </Svg>
  ),
  moon: () => (
    <Svg>
      <path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z" />
    </Svg>
  ),
  sunrise: () => (
    <Svg>
      <path d="M7 17a5 5 0 0 1 10 0M12 4.5v4M4.6 9.6L6 11M19.4 9.6L18 11M2.5 17h2M19.5 17h2M3 20.5h18" />
      <path d="M9.5 6.5L12 4l2.5 2.5" />
    </Svg>
  ),
  sunset: () => (
    <Svg>
      <path d="M7 17a5 5 0 0 1 10 0M12 4v4.5M4.6 9.6L6 11M19.4 9.6L18 11M2.5 17h2M19.5 17h2M3 20.5h18" />
      <path d="M9.5 6L12 8.5 14.5 6" />
    </Svg>
  ),
  monitor: () => (
    <Svg>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M8.5 20h7M12 16.5V20" />
    </Svg>
  ),
  image: () => (
    <Svg>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M20.5 15.5l-4.5-4.5-8.5 8.5" />
    </Svg>
  ),
  key: () => (
    <Svg>
      <circle cx="8" cy="15" r="4.5" />
      <path d="M11.2 11.8L20 3M16.5 6.5l2.5 2.5M14 9l2 2" />
    </Svg>
  ),
  copy: () => (
    <Svg>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
      <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
    </Svg>
  ),
  chat: () => (
    <Svg>
      <path d="M20.5 11.5a8 8 0 0 1-11.8 7L3.5 20l1.4-4.6A8 8 0 1 1 20.5 11.5z" />
    </Svg>
  ),
};

/** 時段的圖示（取代 emoji：每台手機的 emoji 長得不一樣） */
export function SlotIcon({ slot }: { slot: Slot }) {
  if (slot === 'morning') return <Icon.sunrise />;
  if (slot === 'noon') return <Icon.sun />;
  if (slot === 'evening') return <Icon.sunset />;
  return <Icon.moon />;
}

/** 2D 水獺頭（分頁列、側邊欄、沒有 WebGL 時；3D 在 Dr.Claude 頁） */
export function OtterFace({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <circle cx="8.5" cy="17" r="3.2" fill="#6e4429" />
      <circle cx="31.5" cy="17" r="3.2" fill="#6e4429" />
      <circle cx="8.5" cy="17" r="1.5" fill="#c99a78" />
      <circle cx="31.5" cy="17" r="1.5" fill="#c99a78" />
      <ellipse cx="20" cy="21" rx="14" ry="12.5" fill="#8a5a3b" />
      <ellipse cx="20" cy="26.5" rx="10" ry="6.5" fill="#f3e3cc" />
      <circle cx="14.5" cy="19" r="2" fill="#1b1410" />
      <circle cx="25.5" cy="19" r="2" fill="#1b1410" />
      <circle cx="15.1" cy="18.4" r="0.65" fill="#fff" />
      <circle cx="26.1" cy="18.4" r="0.65" fill="#fff" />
      <ellipse cx="12" cy="23.2" rx="1.8" ry="1.1" fill="#f2a08a" opacity="0.55" />
      <ellipse cx="28" cy="23.2" rx="1.8" ry="1.1" fill="#f2a08a" opacity="0.55" />
      <ellipse cx="20" cy="23.5" rx="2.8" ry="1.8" fill="#2a1a12" />
      <path d="M20 25.3v1.7M17.5 28c1.4 1 3.6 1 5 0" stroke="#2a1a12" strokeWidth="1" fill="none" strokeLinecap="round" />
      <path d="M12 25.5h-5M12 27l-4.5 1.2M28 25.5h5M28 27l4.5 1.2" stroke="#3a2a20" strokeWidth="0.6" strokeLinecap="round" />
      <circle cx="20" cy="10.5" r="3.4" fill="#e9eef5" stroke="#9aa9bd" strokeWidth="1" />
      <circle cx="20" cy="10.5" r="1.2" fill="#9aa9bd" />
    </svg>
  );
}
