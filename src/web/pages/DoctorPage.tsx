import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Attachment, ChatAction, ChatMessage, Conversation, ConversationDetail, Mood } from '../../shared/apiTypes';
import { api } from '../api';
import { ErrorBox, Icon, MemberPicker, OtterFace, Panel } from '../components/ui';
import { canListen, canSpeak, listen, speak } from '../doctor/speech';
import { dayLabel, hhmm } from '../format';
import { useAction, useApi, usePoll, useSession } from '../hooks';
import { uploadPhoto } from '../imageTools';
import type { DraftState } from './VisitPages';
import type { OtterState } from '../doctor/Otter3D';
import { canUseWebGL } from '../doctor/webgl';

const Otter3D = lazy(() => import('../doctor/Otter3D'));

const SUGGESTIONS = [
  '幫我記：剛量體溫 37.6 度',
  '我現在吃的藥分別是什麼？',
  '整理這次生病的經過，回診時給醫生看',
  '小朋友發燒 38.5 度，要注意什麼？',
];

const STAGE_TEXT: Record<string, string> = {
  start: 'Dr.Claude 翻病歷中…',
  reading: 'Dr.Claude 看照片中…',
  thinking: 'Dr.Claude 想一下…',
  writing: 'Dr.Claude 寫回覆中…',
};

const TTS_KEY = 'fd-tts';
const readTts = () => {
  try {
    return localStorage.getItem(TTS_KEY) === 'on';
  } catch {
    return false;
  }
};

export default function DoctorPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const nav = useNavigate();
  const { me, members } = useSession();
  const convId = params.id ? Number(params.id) : null;
  const detail = useApi<ConversationDetail>(convId ? `/chat/conversations/${convId}` : null);
  const [focus, setFocus] = useState<number | null>(search.get('memberId') ? Number(search.get('memberId')) : (me.memberId ?? null));
  const [text, setText] = useState('');
  const [files, setFiles] = useState<{ att: Attachment; url: string }[]>([]);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [tts, setTts] = useState(readTts);
  const [history, setHistory] = useState(false);
  const act = useAction();
  const fileInput = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const stopListening = useRef<() => void>(() => undefined);
  const lastSpoken = useRef<number>(0);
  const webgl = useMemo(canUseWebGL, []);
  const reduceMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  const d = detail.data;
  const pending = d?.pending && (d.pending.status === 'queued' || d.pending.status === 'running') ? d.pending : null;
  usePoll(detail.reload, 2000, !!pending);

  useEffect(() => {
    if (d?.conversation.memberId !== undefined) setFocus(d.conversation.memberId);
  }, [d?.conversation.memberId]);

  // 新回覆：捲到最下面；開了朗讀就念出來
  const lastMsg = d?.messages.at(-1);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    if (!lastMsg || lastMsg.role !== 'assistant') return;
    if (lastSpoken.current === 0) {
      lastSpoken.current = lastMsg.id; // 剛打開頁面：舊的不念
      return;
    }
    if (lastMsg.id <= lastSpoken.current) return;
    lastSpoken.current = lastMsg.id;
    if (tts && canSpeak()) {
      speak(lastMsg.body, { start: () => setSpeaking(true), end: () => setSpeaking(false) });
    } else {
      // 沒朗讀：讓水獺「講」一下子
      setSpeaking(true);
      const t = window.setTimeout(() => setSpeaking(false), Math.min(6000, 1200 + lastMsg.body.length * 25));
      return () => window.clearTimeout(t);
    }
  }, [lastMsg, tts, pending]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const mood: Mood | '' = useMemo(() => {
    const last = [...(d?.messages ?? [])].reverse().find((m) => m.role === 'assistant');
    return last?.mood ?? (d ? '' : 'happy');
  }, [d]);
  const otterState: OtterState = listening ? 'listening' : pending ? 'thinking' : speaking ? 'talking' : 'idle';

  const send = useCallback(
    async (body: string) => {
      const attachmentIds = files.map((f) => f.att.id);
      if (!body.trim() && attachmentIds.length === 0) return;
      const res = await act.run(async () => {
        let id = convId;
        if (!id) id = (await api.post<Conversation>('/chat/conversations', { memberId: focus })).id;
        await api.post<ConversationDetail>(`/chat/conversations/${id}/messages`, { body: body.trim(), attachmentIds });
        return id;
      });
      if (!res) return;
      setText('');
      files.forEach((f) => URL.revokeObjectURL(f.url));
      setFiles([]);
      if (res !== convId) nav(`/doctor/${res}`, { replace: !convId });
      else detail.reload();
    },
    [act, convId, files, focus, nav, detail],
  );

  const toggleMic = () => {
    if (listening) {
      stopListening.current();
      return;
    }
    window.speechSynthesis?.cancel();
    setListening(true);
    const base = text ? `${text} ` : '';
    stopListening.current = listen(
      (heard) => setText(base + heard),
      (error) => {
        setListening(false);
        if (error) alert(error);
      },
    );
  };

  const runnerOffline = d ? !d.runner.online : false;
  const statusText = listening
    ? '我在聽…'
    : pending
      ? pending.status === 'queued'
        ? runnerOffline
          ? '家裡的主機好像沒開，開機後會回覆你'
          : 'Dr.Claude 走過來了…'
        : (STAGE_TEXT[pending.stage] ?? 'Dr.Claude 想一下…')
      : d?.messages.length
        ? ''
        : `${greetName(members.find((m) => m.id === me.memberId)?.name)}今天哪裡不舒服？`;

  return (
    <div className="doctor">
      <div className="stage">
        <div className="stage-bar">
          <button className="btn quiet small" onClick={() => setHistory(true)} style={{ background: 'var(--sheet)' }}>
            對話紀錄
          </button>
          <div className="row" style={{ gap: 6 }}>
            {canSpeak() && (
              <button
                className="icon-btn"
                aria-pressed={tts}
                aria-label={tts ? '關掉朗讀' : '朗讀回覆'}
                onClick={() => {
                  const next = !tts;
                  setTts(next);
                  if (!next) window.speechSynthesis.cancel();
                  try {
                    localStorage.setItem(TTS_KEY, next ? 'on' : 'off');
                  } catch {
                    // 這台不能存：只在這次有效
                  }
                }}
              >
                {tts ? <Icon.speaker /> : <Icon.muted />}
              </button>
            )}
            <button
              className="btn quiet small"
              style={{ background: 'var(--sheet)' }}
              onClick={() => {
                window.speechSynthesis?.cancel();
                nav('/doctor');
                setText('');
              }}
            >
              新對話
            </button>
          </div>
        </div>
        {webgl ? (
          <Suspense fallback={<div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><OtterFace size={110} /></div>}>
            <Otter3D state={otterState} mood={mood} reduceMotion={reduceMotion} />
          </Suspense>
        ) : (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <OtterFace size={120} />
          </div>
        )}
        {statusText && <div className={`status-line${runnerOffline && pending ? ' offline' : ''}`} aria-live="polite">{statusText}</div>}
      </div>

      <div className="chat">
        {!convId && (
          <div className="stack" style={{ gap: 10 }}>
            <div className="small muted">關於誰？</div>
            <MemberPicker members={members} value={focus} onChange={setFocus} allowAll />
            <div className="small muted" style={{ marginTop: 6 }}>
              可以這樣問：
            </div>
            <div className="stack" style={{ gap: 6 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn quiet small" style={{ justifyContent: 'flex-start', whiteSpace: 'normal' }} onClick={() => setText(s)}>
                  {s}
                </button>
              ))}
            </div>
            <p className="small muted">Dr.Claude 看得到全家的看診、用藥和身體狀況紀錄。他不是醫師；緊急狀況請直接打 119。</p>
          </div>
        )}
        {convId && !d && !detail.error && <div className="muted small">載入中…</div>}
        <ErrorBox error={detail.error} />
        {d?.messages.map((m) => <Bubble key={m.id} msg={m} convMemberId={d.conversation.memberId} />)}
        {pending && (
          <div className="bubble assistant" aria-label="Dr.Claude 正在回覆">
            <span className="typing">
              <span />
              <span />
              <span />
            </span>
            {pending.status === 'queued' && runnerOffline && <div className="small muted">家裡的主機沒有回應：開機後會自動回覆。</div>}
            <div>
              <button className="btn quiet small" style={{ marginTop: 6 }} onClick={() => act.run(() => api.post(`/chat/jobs/${pending.id}/cancel`, {})).then(detail.reload)}>
                取消
              </button>
            </div>
          </div>
        )}
        {d?.pending?.status === 'failed' && (
          <div className="error">
            {d.pending.error || 'Dr.Claude 這次沒有回覆'}
            <div>
              <button className="btn small" style={{ marginTop: 6 }} onClick={() => act.run(() => api.post(`/chat/jobs/${d.pending!.id}/retry`, {})).then(detail.reload)}>
                再試一次
              </button>
            </div>
          </div>
        )}
        <ErrorBox error={act.error} />
        <div ref={chatEnd} />
      </div>

      {files.length > 0 && (
        <div className="thumbs">
          {files.map((f) => (
            <div key={f.att.id} className="thumb">
              <img src={f.url} alt={f.att.filename} />
              <button aria-label="拿掉這張" onClick={() => setFiles(files.filter((x) => x !== f))}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={async (e) => {
            const picked = [...(e.target.files ?? [])];
            e.target.value = '';
            await act.run(async () => {
              const added: { att: Attachment; url: string }[] = [];
              for (const f of picked.slice(0, 6 - files.length)) added.push({ att: await uploadPhoto(f, 'chat', { memberId: focus }), url: URL.createObjectURL(f) });
              setFiles((cur) => [...cur, ...added]);
            });
          }}
        />
        <button type="button" className="icon-btn" aria-label="附照片（藥袋、患部）" onClick={() => fileInput.current?.click()} disabled={act.busy}>
          <Icon.camera />
        </button>
        <textarea
          rows={1}
          value={text}
          placeholder={pending ? 'Dr.Claude 回完再問' : '問 Dr.Claude'}
          aria-label="訊息"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
              e.preventDefault();
              void send(text);
            }
          }}
        />
        {canListen() && (
          <button type="button" className={`icon-btn${listening ? ' listening' : ''}`} aria-label={listening ? '停止' : '用說的'} onClick={toggleMic}>
            <Icon.mic />
          </button>
        )}
        <button className="icon-btn primary" aria-label="送出" disabled={act.busy || !!pending || (!text.trim() && files.length === 0)}>
          <Icon.send />
        </button>
      </form>

      {history && <HistoryPanel onClose={() => setHistory(false)} />}
    </div>
  );
}

function greetName(name: string | undefined) {
  return name ? `${name}，` : '';
}

function Bubble({ msg, convMemberId }: { msg: ChatMessage; convMemberId: number | null }) {
  const { members } = useSession();
  const nav = useNavigate();
  return (
    <div className={`bubble ${msg.role}${msg.mood === 'urgent' ? ' urgent' : ''}`}>
      {msg.attachmentIds.length > 0 && (
        <div className="imgs">
          {msg.attachmentIds.map((id) => (
            <a key={id} href={`/api/attachments/${id}/file`} target="_blank" rel="noreferrer">
              <img src={`/api/attachments/${id}/file`} alt="附圖" loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {msg.body}
      {msg.actions.length > 0 && (
        <div className="action-note">
          {msg.actions.map((a, i) => (
            <ActionLine
              key={i}
              action={a}
              memberName={members.find((m) => m.id === a.memberId)?.name ?? ''}
              onReview={() => {
                if (a.type !== 'visit_draft') return;
                const state: DraftState = {
                  draft: a.draft,
                  memberId: a.memberId ?? convMemberId,
                  fromMessage: { messageId: msg.id, actionIndex: i },
                  attachmentIds: msg.attachmentIds,
                };
                nav('/visits/new', { state });
              }}
            />
          ))}
        </div>
      )}
      <div className="small" style={{ opacity: 0.6, marginTop: 4, textAlign: 'right' }}>
        {hhmm(msg.createdAt)}
      </div>
    </div>
  );
}

function ActionLine({ action, memberName, onReview }: { action: ChatAction; memberName: string; onReview: () => void }) {
  if (action.type === 'note') return <div>🦦 已幫{memberName}記下：{action.summary}</div>;
  if (action.type === 'measurement') return <div>🦦 已幫{memberName}記下：{action.summary}</div>;
  const dr = action.draft;
  return (
    <div className="draft-card">
      <strong>看診草稿</strong>・{memberName} {dr.visitDate} {dr.clinic}
      <div className="small">{dr.medications.map((m) => m.name).join('、') || '（沒有藥）'}</div>
      {action.savedVisitId ? (
        <Link to={`/visits/${action.savedVisitId}`} className="btn small ghost" style={{ marginTop: 6 }}>
          已存成看診紀錄
        </Link>
      ) : (
        <button className="btn small" style={{ marginTop: 6 }} onClick={onReview}>
          核對後存起來
        </button>
      )}
    </div>
  );
}

function HistoryPanel({ onClose }: { onClose: () => void }) {
  const list = useApi<Conversation[]>('/chat/conversations');
  const { members } = useSession();
  const nav = useNavigate();
  return (
    <Panel title="對話紀錄" onClose={onClose}>
      <ErrorBox error={list.error} />
      {list.data?.length === 0 && <div className="empty">還沒有跟 Dr.Claude 聊過</div>}
      <div className="sheet ruled">
        {list.data?.map((c) => (
          <button
            key={c.id}
            style={{ all: 'unset', display: 'block', cursor: 'pointer', padding: '12px 14px' }}
            onClick={() => {
              onClose();
              nav(`/doctor/${c.id}`);
            }}
          >
            <div className="spread">
              <strong>{c.title || '（沒有標題）'}</strong>
              <span className="small muted">{dayLabel(c.updatedAt.slice(0, 10))}</span>
            </div>
            <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.memberId && `${members.find((m) => m.id === c.memberId)?.name ?? ''}・`}
              {c.lastMessage}
            </div>
          </button>
        ))}
      </div>
    </Panel>
  );
}
