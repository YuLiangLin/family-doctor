import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Attachment, ChatAction, ChatMessage, Conversation, ConversationDetail, Mood } from '../../shared/apiTypes';
import { api } from '../api';
import { Alert, Avatar, ErrorBox, Icon, MemberPicker, OtterFace, Panel, RichText, toast } from '../components/ui';
import type { OtterState } from '../doctor/Otter3D';
import { canListen, canSpeak, listen, speak, stopSpeaking, unlockSpeech } from '../doctor/speech';
import { canUseWebGL } from '../doctor/webgl';
import { dayLabel, hhmm } from '../format';
import { emitDataChanged, useAction, useApi, usePoll, useSession } from '../hooks';
import { uploadPhoto } from '../imageTools';
import { useIsDark } from '../theme';
import type { DraftState } from './VisitPages';

const Otter3D = lazy(() => import('../doctor/Otter3D'));

const SUGGESTIONS = ['幫我記：剛量體溫 37.6 度', '我現在吃的藥分別是什麼？', '整理這次生病的經過，回診時給醫生看', '小朋友發燒 38.5 度，要注意什麼？'];

const STAGE_TEXT: Record<string, string> = {
  start: '翻一下病歷…',
  reading: '看照片中…',
  thinking: '想一下…',
  writing: '寫回覆中…',
};

const TTS_KEY = 'fd-tts';
const VOICE_KEY = 'fd-voice';
const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) === 'on';
  } catch {
    return false;
  }
};
const saveFlag = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // 這台不能存：只在這次有效
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
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [tts, setTts] = useState(() => readFlag(TTS_KEY));
  const [voice, setVoice] = useState(() => readFlag(VOICE_KEY) && canListen());
  const [history, setHistory] = useState(false);
  const act = useAction();
  const fileInput = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const stopListening = useRef<(cancel?: boolean) => void>(() => undefined);
  const lastSpoken = useRef<number>(0);
  const voiceRef = useRef(voice);
  const webgl = useMemo(canUseWebGL, []);
  const dark = useIsDark();
  const reduceMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const speakOn = tts || voice;

  const d = detail.data;
  const pending = d?.pending && (d.pending.status === 'queued' || d.pending.status === 'running') ? d.pending : null;
  usePoll(detail.reload, 2000, !!pending);

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  useEffect(() => {
    if (d?.conversation.memberId !== undefined) setFocus(d.conversation.memberId);
  }, [d?.conversation.memberId]);

  // 換對話：從頭算哪些已經念過
  useEffect(() => {
    lastSpoken.current = 0;
  }, [convId]);

  // 輸入框跟著字數長高
  useLayoutEffect(() => {
    const t = textRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(160, t.scrollHeight)}px`;
  }, [text, voice]);

  const say = useCallback((body: string) => {
    speak(body, {
      start: () => {
        setSpeaking(true);
        setVoicePlaying(true);
      },
      end: () => {
        setSpeaking(false);
        setVoicePlaying(false);
      },
    });
  }, []);

  // 新回覆：捲到最下面；開了朗讀（或語音對話）就念出來
  const lastMsg = d?.messages.at(-1);
  const pendingId = pending?.id;
  useEffect(() => {
    if (lastMsg || pendingId) chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lastMsg?.id, pendingId]);
  useEffect(() => {
    if (!lastMsg || lastMsg.role !== 'assistant') return;
    if (lastSpoken.current === 0) {
      lastSpoken.current = lastMsg.id; // 剛打開頁面：舊的不念
      return;
    }
    if (lastMsg.id <= lastSpoken.current) return;
    lastSpoken.current = lastMsg.id;
    if (lastMsg.actions.length) emitDataChanged(); // Dr.水獺 幫忙記了東西：其他畫面重抓
    if (speakOn && canSpeak()) {
      say(lastMsg.body);
    } else {
      // 沒朗讀：讓海獺「講」一下子
      setSpeaking(true);
      const t = window.setTimeout(() => setSpeaking(false), Math.min(6000, 1200 + lastMsg.body.length * 25));
      return () => {
        window.clearTimeout(t);
        setSpeaking(false);
      };
    }
  }, [lastMsg, speakOn, say]);

  useEffect(
    () => () => {
      stopSpeaking();
      stopListening.current(true);
    },
    [],
  );

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
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  /**
   * 開始聽；語音對話模式下說完（停頓）就自動送出。
   * 按停止、取消時畫面馬上回來，不等瀏覽器（iPhone 常常不回「結束」，speech.ts 會自己收尾、只呼叫一次 onEnd）。
   */
  const listenSeq = useRef(0);
  const startListening = () => {
    stopListening.current(true);
    stopSpeaking();
    setVoicePlaying(false);
    setListening(true);
    const seq = ++listenSeq.current;
    const base = voiceRef.current || !text ? '' : `${text} `;
    let heard = '';
    const stop = listen(
      (t) => {
        if (seq !== listenSeq.current) return;
        heard = t;
        setText(base + t);
      },
      (error, cancelled) => {
        if (seq !== listenSeq.current) return;
        setListening(false);
        if (error) {
          toast(error, 'error');
          return;
        }
        const said = (base + heard).trim();
        if (voiceRef.current && !cancelled && said) void sendRef.current(said);
      },
    );
    stopListening.current = (cancel = false) => {
      if (seq !== listenSeq.current) return;
      if (cancel) {
        listenSeq.current++;
        setListening(false);
      }
      stop(cancel);
    };
  };

  const toggleMic = () => {
    if (listening) stopListening.current();
    else startListening();
  };

  const toggleVoice = () => {
    const next = !voice;
    if (next) unlockSpeech();
    else {
      stopListening.current(true);
      stopSpeaking();
    }
    setVoice(next);
    saveFlag(VOICE_KEY, next);
    toast(next ? '語音對話：說完自動送出，回覆念給你聽' : '回到打字');
  };

  const newChat = () => {
    stopSpeaking();
    stopListening.current(true);
    setText('');
    nav('/doctor');
  };

  const runnerOffline = d ? !d.runner.online : false;
  const myName = members.find((m) => m.id === me.memberId)?.name;
  let status: { text: string; warn?: boolean } | null = null;
  if (listening) status = { text: '我在聽…' };
  else if (pending)
    status =
      pending.status === 'queued'
        ? runnerOffline
          ? { text: '家裡的主機好像沒開，開機後會回覆你', warn: true }
          : { text: '我走過來了…' }
        : { text: STAGE_TEXT[pending.stage] ?? '想一下…' };
  else if (voicePlaying) status = { text: '我說給你聽' };
  else if (!d?.messages.length) status = { text: `${myName ? `${myName}，` : ''}今天哪裡不舒服？` };

  const busy = act.busy || !!pending;
  const convMember = d?.conversation.memberId ? members.find((m) => m.id === d.conversation.memberId) : undefined;

  return (
    <div className="doctor">
      <div className="doctor-side">
        <div className={`stage${d?.messages.length ? ' compact' : ''}${webgl ? ' water' : ''}`}>
          <div className="stage-bar">
            <button type="button" className="icon-btn glass history-btn" aria-label="對話紀錄" onClick={() => setHistory(true)}>
              <Icon.history />
            </button>
            <span className="spacer" />
            {canListen() && (
              <button type="button" className="voice-toggle" aria-pressed={voice} onClick={toggleVoice}>
                <Icon.wave />
                語音對話
              </button>
            )}
            {canSpeak() && !voice && (
              <button
                type="button"
                className={`icon-btn glass${tts ? ' on' : ''}`}
                aria-pressed={tts}
                aria-label={tts ? '關掉朗讀' : '回覆念給我聽'}
                title={tts ? '關掉朗讀' : '回覆念給我聽'}
                onClick={() => {
                  const next = !tts;
                  if (next) unlockSpeech();
                  else stopSpeaking();
                  setTts(next);
                  saveFlag(TTS_KEY, next);
                }}
              >
                {tts ? <Icon.speaker /> : <Icon.muted />}
              </button>
            )}
            <button type="button" className="icon-btn glass" aria-label="新對話" title="新對話" onClick={newChat}>
              <Icon.compose />
            </button>
          </div>
          <div className="otter-wrap">
            {webgl ? (
              <Suspense
                fallback={
                  <div className="otter2d">
                    <OtterFace size={110} />
                  </div>
                }
              >
                <Otter3D state={otterState} mood={mood} reduceMotion={reduceMotion} dark={dark} />
              </Suspense>
            ) : (
              <div className="otter2d">
                <OtterFace size={120} />
              </div>
            )}
          </div>
          {status && (
            <div key={status.text} className={`say${status.warn ? ' warn' : ''}`} aria-live="polite">
              {status.text}
              {voicePlaying && (
                <button
                  type="button"
                  className="stop"
                  onClick={() => {
                    stopSpeaking();
                    setVoicePlaying(false);
                    setSpeaking(false);
                  }}
                >
                  停止
                </button>
              )}
            </div>
          )}
        </div>
        <div className="history-side">
          <div className="head">
            <h2>對話紀錄</h2>
            <button type="button" className="btn ghost sm" onClick={newChat}>
              <Icon.compose />
              新對話
            </button>
          </div>
          <div className="body">
            <HistoryList activeId={convId} onPick={(id) => nav(`/doctor/${id}`)} />
          </div>
        </div>
      </div>

      <div className="doctor-main">
        <div className="chat-head">
          <strong className="ellipsis">{d?.conversation.title || (convId ? '對話' : '新對話')}</strong>
          {convMember && (
            <span className="tag">
              <Avatar member={convMember} size={16} />
              {convMember.name}
            </span>
          )}
        </div>
        <div className="chat">
          <div className="chat-inner">
            {!convId && (
              <div className="intro">
                <div>
                  <div className="label">關於誰？</div>
                  <MemberPicker members={members} value={focus} onChange={setFocus} allowAll label="關於誰" />
                </div>
                <div>
                  <div className="label">可以這樣問</div>
                  <div className="suggests">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="suggest"
                        onClick={() => {
                          if (voice) void send(s);
                          else {
                            setText(s);
                            textRef.current?.focus();
                          }
                        }}
                      >
                        <Icon.sparkle />
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="disclaimer">
                  <Icon.shield />
                  Dr.水獺 看得到全家的看診、用藥和身體狀況紀錄。他不是醫師，回答僅供參考；緊急狀況請直接打 119。
                </p>
              </div>
            )}
            {convId && !d && !detail.error && (
              <div className="stack sm">
                <div className="skel" style={{ height: 52, width: '60%', alignSelf: 'flex-end', marginLeft: 'auto', borderRadius: 20 }} />
                <div className="skel" style={{ height: 140, width: '80%', borderRadius: 20 }} />
              </div>
            )}
            <ErrorBox error={detail.error} />
            {d?.messages.map((m) => <Bubble key={m.id} msg={m} convMemberId={d.conversation.memberId} onSpeak={say} />)}
            {pending && (
              <div className="msg assistant" aria-label="Dr.水獺 正在回覆">
                <div className="msg-from">
                  <span className="face">
                    <OtterFace size={20} />
                  </span>
                  Dr.水獺
                </div>
                <div className="bubble">
                  <span className="typing-bubble">
                    <span className="dots" aria-hidden>
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="hand">{pending.status === 'queued' ? (runnerOffline ? '家裡的主機沒有回應' : '我來了') : (STAGE_TEXT[pending.stage] ?? '想一下…')}</span>
                  </span>
                  {pending.status === 'queued' && runnerOffline && <div className="small muted" style={{ marginTop: 6 }}>開機後會自動回覆，不用重問。</div>}
                  <div style={{ marginTop: 8 }}>
                    <button type="button" className="btn ghost sm" onClick={() => act.run(() => api.post(`/chat/jobs/${pending.id}/cancel`, {})).then(detail.reload)}>
                      取消
                    </button>
                  </div>
                </div>
              </div>
            )}
            {d?.pending?.status === 'failed' && (
              <Alert kind="error">
                {d.pending.error || 'Dr.水獺 這次沒有回覆'}
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn sm" onClick={() => act.run(() => api.post(`/chat/jobs/${d.pending!.id}/retry`, {})).then(detail.reload)}>
                    再試一次
                  </button>
                </div>
              </Alert>
            )}
            <ErrorBox error={act.error} />
            <div ref={chatEnd} />
          </div>
        </div>

        <div className="composer-wrap">
          <div className="composer-inner">
            {files.length > 0 && (
              <div className="thumbs">
                {files.map((f) => (
                  <div key={f.att.id} className="thumb">
                    <img src={f.url} alt={f.att.filename} />
                    <button type="button" aria-label="拿掉這張" onClick={() => setFiles(files.filter((x) => x !== f))}>
                      <Icon.close />
                    </button>
                  </div>
                ))}
              </div>
            )}
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
            {voice ? (
              <VoicePad
                listening={listening}
                playing={voicePlaying}
                busy={busy}
                heard={text}
                hasFiles={files.length > 0}
                onMic={() => {
                  if (listening) stopListening.current();
                  else startListening();
                }}
                onCancel={() => {
                  stopListening.current(true);
                  setText('');
                }}
                onKeyboard={toggleVoice}
                onCamera={() => fileInput.current?.click()}
                onSendPhotos={() => void send('')}
              />
            ) : (
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(text);
                }}
              >
                <div className="composer-box">
                  <button type="button" className="icon-btn" aria-label="附照片（藥袋、患部）" title="附照片" onClick={() => fileInput.current?.click()} disabled={act.busy}>
                    <Icon.camera />
                  </button>
                  <textarea
                    ref={textRef}
                    rows={1}
                    value={text}
                    placeholder={pending ? 'Dr.水獺 回完再問' : listening ? '說吧，我在聽…' : '問 Dr.水獺'}
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
                    <button type="button" className={`icon-btn${listening ? ' listening-mic' : ''}`} aria-label={listening ? '停止' : '用說的'} title={listening ? '停止' : '用說的'} onClick={toggleMic}>
                      {listening ? <Icon.stop /> : <Icon.mic />}
                    </button>
                  )}
                </div>
                <button className="send-btn" aria-label="送出" disabled={busy || (!text.trim() && files.length === 0)}>
                  <Icon.send />
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {history && <HistoryPanel activeId={convId} onClose={() => setHistory(false)} />}
    </div>
  );
}

/** 語音對話：大麥克風。按一下說話 → 停頓就送出 → 回覆念出來 → 再按一下回話 */
function VoicePad({
  listening,
  playing,
  busy,
  heard,
  hasFiles,
  onMic,
  onCancel,
  onKeyboard,
  onCamera,
  onSendPhotos,
}: {
  listening: boolean;
  playing: boolean;
  busy: boolean;
  heard: string;
  hasFiles: boolean;
  onMic: () => void;
  onCancel: () => void;
  onKeyboard: () => void;
  onCamera: () => void;
  onSendPhotos: () => void;
}) {
  const hint = busy ? 'Dr.水獺 回覆中…' : playing ? 'Dr.水獺 說話中，按麥克風可以打斷他' : hasFiles ? '說說照片是什麼，或直接送出照片' : '按一下麥克風，說說哪裡不舒服';
  return (
    <div>
      <div className={`voice-heard${!listening || !heard ? ' hint' : ''}`} aria-live="polite">
        {listening ? heard || '我在聽…' : hint}
      </div>
      <div className="voice-pad">
        <div className="side">
          {listening ? (
            <button type="button" className="icon-btn" aria-label="取消，不送出" title="取消" onClick={onCancel} style={{ ['--s' as string]: '48px' }}>
              <Icon.close />
            </button>
          ) : (
            <button type="button" className="icon-btn" aria-label="改用打字" title="改用打字" onClick={onKeyboard} style={{ ['--s' as string]: '48px' }}>
              <Icon.keyboard />
            </button>
          )}
        </div>
        <button
          type="button"
          className={`big-mic${listening ? ' listening' : playing ? ' speaking' : ''}`}
          aria-label={listening ? '說完了，送出' : playing ? '打斷並開始說話' : '開始說話'}
          disabled={busy && !listening}
          onClick={onMic}
        >
          {listening ? <Icon.stop /> : <Icon.mic />}
        </button>
        <div className="side">
          {hasFiles && !listening && !busy ? (
            <button type="button" className="icon-btn primary" aria-label="送出照片" title="送出照片" onClick={onSendPhotos} style={{ ['--s' as string]: '48px' }}>
              <Icon.send />
            </button>
          ) : (
            <button type="button" className="icon-btn" aria-label="附照片" title="附照片" onClick={onCamera} disabled={listening} style={{ ['--s' as string]: '48px' }}>
              <Icon.camera />
            </button>
          )}
        </div>
      </div>
      {listening && <div className="voice-label">說完停一下就會送出</div>}
    </div>
  );
}

function Bubble({ msg, convMemberId, onSpeak }: { msg: ChatMessage; convMemberId: number | null; onSpeak: (body: string) => void }) {
  const { members } = useSession();
  const nav = useNavigate();
  const assistant = msg.role === 'assistant';
  const urgent = msg.mood === 'urgent';
  return (
    <div className={`msg ${msg.role}${urgent ? ' urgent' : ''}`}>
      {assistant && (
        <div className="msg-from">
          <span className="face">
            <OtterFace size={20} />
          </span>
          Dr.水獺
        </div>
      )}
      <div className="bubble">
        {urgent && (
          <div className="urgent-head">
            <Icon.alert />
            建議盡快就醫
            <a className="btn danger solid sm" href="tel:119">
              <Icon.phone />
              119
            </a>
          </div>
        )}
        {msg.attachmentIds.length > 0 && (
          <div className="imgs">
            {msg.attachmentIds.map((id) => (
              <a key={id} href={`/api/attachments/${id}/file`} target="_blank" rel="noreferrer">
                <img src={`/api/attachments/${id}/file`} alt="附圖" loading="lazy" />
              </a>
            ))}
          </div>
        )}
        {assistant ? <RichText text={msg.body} /> : msg.body}
        {msg.actions.length > 0 && (
          <div className="actions-done">
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
      </div>
      <div className="msg-meta num">
        {hhmm(msg.createdAt)}
        {assistant && canSpeak() && (
          <button type="button" className="icon-btn" aria-label="念給我聽" title="念給我聽" onClick={() => onSpeak(msg.body)}>
            <Icon.speaker />
          </button>
        )}
      </div>
    </div>
  );
}

function ActionLine({ action, memberName, onReview }: { action: ChatAction; memberName: string; onReview: () => void }) {
  if (action.type === 'note' || action.type === 'measurement')
    return (
      <div className="done-chip">
        <Icon.checkCircle />
        已幫{memberName}記下：{action.summary}
      </div>
    );
  const dr = action.draft;
  return (
    <div className="draft-card">
      <div className="t">
        <Icon.visit />
        看診草稿・{memberName}
      </div>
      <div className="small soft">
        {[dr.visitDate, dr.clinic].filter(Boolean).join(' ')}
        <br />
        {dr.medications.map((m) => m.name).join('、') || '（沒有藥）'}
      </div>
      {action.savedVisitId ? (
        <Link to={`/visits/${action.savedVisitId}`} className="btn secondary sm">
          <Icon.check />
          已存成看診紀錄
        </Link>
      ) : (
        <button type="button" className="btn sm" onClick={onReview}>
          核對後存起來
        </button>
      )}
    </div>
  );
}

function HistoryList({ activeId, onPick }: { activeId: number | null; onPick: (id: number) => void }) {
  const list = useApi<Conversation[]>('/chat/conversations');
  const { members } = useSession();
  if (list.error) return <ErrorBox error={list.error} />;
  if (!list.data)
    return (
      <div className="stack xs" style={{ padding: 6 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="skel" style={{ height: 52 }} />
        ))}
      </div>
    );
  if (list.data.length === 0) return <div className="empty small">還沒有跟 Dr.水獺 聊過</div>;
  return (
    <div className="stack xs">
      {list.data.map((c) => {
        const member = members.find((m) => m.id === c.memberId);
        return (
          <button key={c.id} type="button" className={`history-item${c.id === activeId ? ' active' : ''}`} onClick={() => onPick(c.id)}>
            <span className="t">
              {member && <Avatar member={member} size={20} />}
              <span className="ellipsis grow">{c.title || '（沒有標題）'}</span>
              <time className="num">{dayLabel(c.updatedAt.slice(0, 10)).replace(/（.）$/, '')}</time>
            </span>
            <span className="p">{c.lastMessage}</span>
          </button>
        );
      })}
    </div>
  );
}

function HistoryPanel({ activeId, onClose }: { activeId: number | null; onClose: () => void }) {
  const nav = useNavigate();
  return (
    <Panel title="對話紀錄" onClose={onClose}>
      <HistoryList
        activeId={activeId}
        onPick={(id) => {
          onClose();
          nav(`/doctor/${id}`);
        }}
      />
    </Panel>
  );
}
