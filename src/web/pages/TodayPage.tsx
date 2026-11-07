import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { DoseLog, Medication, Member, TodayResponse, Visit } from '../../shared/apiTypes';
import { taipeiNow } from '../../shared/dates';
import {
  isActive,
  packCourses,
  packsOn,
  shortClinic,
  SLOT_INFO,
  SLOTS,
  takenAtProblem,
  TIMING_LABEL,
  type DosePack,
  type PackCourse,
  type PackStatus,
  type Slot,
} from '../../shared/meds';
import { api, ApiRequestError } from '../api';
import { DrugLightbox, DrugPhoto } from '../components/DrugPhoto';
import { MEASURE_ICON } from '../components/QuickAdd';
import { Avatar, ErrorBox, Icon, InkMark, OtterFace, PageHead, PageSkeleton, Panel, SlotIcon, toast, UserAvatar } from '../components/ui';
import { dayLabel, hhmm, weekday } from '../format';
import { emitDataChanged, useApi, usePoll, useQuick, useSession } from '../hooks';

/** 現在是哪個時段（過了上一個時段的時間就算下一個） */
function currentSlot(): Slot {
  const t = taipeiNow().slice(11, 16);
  if (t < '11:00') return 'morning';
  if (t < '16:30') return 'noon';
  if (t < '20:30') return 'evening';
  return 'bedtime';
}

function greeting(): string {
  const h = Number(taipeiNow().slice(11, 13));
  if (h < 5) return '夜深了';
  if (h < 11) return '早安';
  if (h < 14) return '午安';
  if (h < 18) return '下午好';
  return '晚安';
}

const tint = (bg: string, ink: string) => ({ ['--tint' as string]: bg, ['--tint-ink' as string]: ink }) as CSSProperties;
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const isDone = (s: PackStatus) => s === 'taken' || s === 'skipped';

/** 這一份藥叫什麼：看診開的叫診所名稱，自己買的叫藥名 */
function groupTitle(visit: Visit | undefined, meds: Medication[]): string {
  if (meds[0]?.visitId) return (visit && shortClinic(visit.clinic)) || visit?.department || '看診開的藥';
  return meds[0]?.name ?? '';
}

export function TodayPage() {
  const { me, members } = useSession();
  const nav = useNavigate();
  const today = useApi<TodayResponse>('/today');
  usePoll(today.reload, 60_000);
  const quick = useQuick();
  const [expanded, setExpanded] = useState<Partial<Record<Slot, boolean>>>({});
  const data = today.data;
  if (!data) return today.error ? <div className="page"><ErrorBox error={today.error} /></div> : <PageSkeleton wide />;

  const meds = data.medications;
  const visits = new Map((data.visits ?? []).map((v) => [v.id, v]));
  const order = (memberId: number) => members.findIndex((m) => m.id === memberId);
  // 一包一包：同一次看診（同一位醫生開的）同一個時段的藥是一包
  const packs = packsOn(meds, data.doseLogs, data.date).sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || order(a.memberId) - order(b.memberId));
  const prn = meds.filter((m) => m.asNeeded && isActive(m, data.date));
  const courses = packCourses(meds, data.doseLogs, data.date)
    .filter((c) => c.startDate <= data.date)
    .sort((a, b) => order(a.memberId) - order(b.memberId));
  const now = currentSlot();
  const myName = members.find((m) => m.id === me.memberId)?.name || me.name;
  const [, mm, dd] = data.date.split('-').map(Number);

  const quickRow = (
    <div className="quick">
      <button type="button" className="quick-btn" onClick={() => nav('/visits/new')}>
        <span className="ic">
          <Icon.camera />
        </span>
        拍藥袋
      </button>
      <button type="button" className="quick-btn" style={tint('var(--amber-soft)', 'var(--amber)')} onClick={() => quick.open('note')}>
        <span className="ic">
          <Icon.note />
        </span>
        身體狀況
      </button>
      <button type="button" className="quick-btn" style={tint('var(--red-soft)', 'var(--red)')} onClick={() => quick.open('temperature')}>
        <span className="ic">
          <Icon.thermometer />
        </span>
        量體溫
      </button>
      <button type="button" className="quick-btn" style={tint('var(--otter-soft)', 'var(--otter)')} onClick={() => nav('/doctor')}>
        <span className="ic" style={{ background: 'var(--otter)' }}>
          <OtterFace size={28} />
        </span>
        Dr.水獺
      </button>
    </div>
  );

  return (
    <div className="page wide">
      <PageHead
        eyebrow={
          <span className="num">
            {mm}月{dd}日・星期{weekday(data.date)}
          </span>
        }
        title={myName ? `${greeting()}，${myName}` : greeting()}
        actions={
          <Link to="/settings" className="me-btn" aria-label="設定">
            {me.picture ? <UserAvatar picture={me.picture} name={me.name} size={42} /> : <Icon.settings />}
          </Link>
        }
      />

      <div className="cols">
        <div className="stack">
          {packs.length === 0 && prn.length === 0 ? (
            <section className="card">
              <div className="empty" style={{ padding: '34px 22px' }}>
                <div className="art" style={{ background: 'var(--otter)' }}>
                  <OtterFace size={56} />
                </div>
                <h3>今天沒有要吃的藥</h3>
                <p>看完醫生拍一下藥袋，Dr.水獺 會幫你排好每天吃藥的時間，時間到了提醒你。</p>
                <Link className="btn" to="/visits/new" style={{ marginTop: 6 }}>
                  <Icon.camera />
                  拍藥袋
                </Link>
              </div>
            </section>
          ) : (
            <Hero packs={packs} now={now} hasPrn={prn.length > 0} />
          )}

          <div className="hide-wide">{quickRow}</div>

          {SLOTS.map((slot) => {
            const list = packs.filter((p) => p.slot === slot);
            if (list.length === 0) return null;
            const info = SLOT_INFO[slot];
            const taken = list.filter((p) => p.status === 'taken').length;
            const allDone = list.every((p) => isDone(p.status));
            const open = expanded[slot] ?? !(allDone && slot !== now);
            return (
              <section key={slot} id={`slot-${slot}`} className={`card slot-card${slot === now ? ' now' : ''}`} aria-label={`${info.label}的藥`}>
                <button type="button" className="slot-head" aria-expanded={open} onClick={() => setExpanded({ ...expanded, [slot]: !open })}>
                  <span className="slot-ic">
                    <SlotIcon slot={slot} />
                  </span>
                  <span>
                    <h3>
                      {info.label}
                      {slot === now && <span className="tag live">現在</span>}
                    </h3>
                    <span className="time num">{info.time}</span>
                  </span>
                  <span className="count num">
                    {allDone ? (
                      <span className="slot-done-line">都吃了</span>
                    ) : (
                      <>
                        {taken}/{list.length} 包
                      </>
                    )}
                    <span className="chev">
                      <Icon.chevronDown />
                    </span>
                  </span>
                </button>
                {open && (
                  <div className="doses">
                    {list.map((p) => (
                      <PackRow
                        key={p.key}
                        pack={p}
                        meds={p.doses.map((d) => meds.find((m) => m.id === d.medicationId)!)}
                        visit={p.visitId ? visits.get(p.visitId) : undefined}
                        splitTiming={list.filter((x) => x.groupKey === p.groupKey).length > 1}
                        date={data.date}
                        now={now}
                        logs={data.doseLogs}
                        onChanged={today.reload}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}

          {prn.length > 0 && (
            <section className="card slot-card" aria-label="需要時才吃">
              <div className="slot-head">
                <span className="slot-ic">
                  <Icon.pill />
                </span>
                <span>
                  <h3>需要時才吃</h3>
                  <span className="time">不舒服時再吃，吃了記一下</span>
                </span>
              </div>
              <div className="doses">
                {prn.map((m) => (
                  <PrnRow key={m.id} med={m} date={data.date} logs={data.doseLogs} onChanged={today.reload} />
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="stack sticky">
          <div className="show-wide">{quickRow}</div>

          {data.followUps.length > 0 && (
            <section className="card">
              <div className="card-head">
                <h2>回診</h2>
                <span className="aside">兩週內</span>
              </div>
              <div className="list" style={{ paddingBottom: 6 }}>
                {data.followUps.map((f) => {
                  const member = members.find((x) => x.id === f.memberId);
                  return (
                    <Link key={f.visitId} to={`/visits/${f.visitId}`} className="item follow">
                      <span className="date-block num">
                        <span className="m">{Number(f.date.slice(5, 7))}月</span>
                        <span className="d">{Number(f.date.slice(8, 10))}</span>
                      </span>
                      <span className="grow">
                        <strong className="ellipsis" style={{ display: 'block' }}>
                          {f.clinic || '回診'}
                        </strong>
                        <span className="tiny muted">
                          {member?.name}・{dayLabel(f.date, data.date)}
                        </span>
                      </span>
                      <span className="ic18 muted">
                        <Icon.chevronRight />
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {courses.length > 0 && (
            <section className="card">
              <div className="card-head">
                <h2>療程</h2>
                <span className="aside">
                  {courses.length} 份・{courses.reduce((n, c) => n + c.medicationIds.length, 0)} 種藥
                </span>
              </div>
              <div style={{ paddingBottom: 4 }}>
                {courses.map((c) => (
                  <Course
                    key={c.groupKey}
                    course={c}
                    meds={c.medicationIds.map((id) => meds.find((m) => m.id === id)!)}
                    visit={c.visitId ? visits.get(c.visitId) : undefined}
                  />
                ))}
              </div>
            </section>
          )}

          <button type="button" className="card item" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px' }} onClick={() => quick.open('measure')}>
            <span className="entry-ic" style={tint('var(--green-soft)', 'var(--green)')}>
              {MEASURE_ICON.weight()}
            </span>
            <span className="grow">
              <strong style={{ display: 'block' }}>記體重、身高、血壓</strong>
              <span className="tiny muted">小朋友長多高，也記在這裡</span>
            </span>
            <span className="ic18 muted">
              <Icon.chevronRight />
            </span>
          </button>
        </aside>
      </div>
    </div>
  );
}

/** 藥袋卡：今天的藥總覽＋四個時段格子（一包一包算） */
function Hero({ packs, now, hasPrn }: { packs: DosePack[]; now: Slot; hasPrn: boolean }) {
  const total = packs.length;
  const taken = packs.filter((p) => p.status === 'taken').length;
  const left = packs.filter((p) => !isDone(p.status)).length;
  const pending = (s: Slot) => packs.filter((p) => p.slot === s && !isDone(p.status)).length;
  const nowIdx = SLOTS.indexOf(now);
  const missed = SLOTS.slice(0, nowIdx).filter((s) => pending(s) > 0);
  const next = SLOTS.slice(nowIdx).find((s) => pending(s) > 0);

  let big = '';
  let sub = '';
  if (total === 0) {
    big = '今天沒有固定時間的藥';
    sub = hasPrn ? '下面是需要時才吃的藥' : '';
  } else if (left === 0) {
    big = '今天的藥都吃完了';
    sub = '辛苦了，明天見';
  } else {
    big = `還有 ${left} 包要吃`;
    if (next === now) sub = `現在是${SLOT_INFO[now].label}，有 ${pending(now)} 包`;
    else if (next) sub = `下一次：${SLOT_INFO[next].label} ${SLOT_INFO[next].time}`;
    if (missed.length) sub += `${sub ? '・' : ''}${missed.map((s) => SLOT_INFO[s].label).join('、')}的還沒打勾`;
  }
  const C = 2 * Math.PI * 34;
  const pct = total ? taken / total : 0;

  return (
    <section className="hero" aria-label="今天的藥">
      <div className="hero-top">
        <div className="grow">
          <h2>今天的藥</h2>
          <div className="hero-big">{big}</div>
          {sub && <div className="hero-sub">{sub}</div>}
        </div>
        {total > 0 && (
          <div className="ring" role="img" aria-label={`吃了 ${taken} 包，共 ${total} 包`}>
            <svg viewBox="0 0 76 76">
              <circle className="track" cx="38" cy="38" r="34" />
              <circle className="fill" cx="38" cy="38" r="34" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
            </svg>
            <span className="label num">
              {taken}
              <small>/ {total} 包</small>
            </span>
          </div>
        )}
      </div>
      {total > 0 && (
        <div className="slot-strip">
          {SLOTS.map((s) => {
            const n = packs.filter((p) => p.slot === s).length;
            const t = packs.filter((p) => p.slot === s && p.status === 'taken').length;
            const done = n > 0 && pending(s) === 0;
            return (
              <button
                key={s}
                type="button"
                className={`slot-cell${s === now ? ' now' : ''}${done ? ' done' : ''}${n === 0 ? ' none' : ''}`}
                disabled={n === 0}
                onClick={() => document.getElementById(`slot-${s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                aria-label={`${SLOT_INFO[s].label}：${n ? `${t}/${n} 包` : '沒有藥'}`}
              >
                {done ? <Icon.check /> : <SlotIcon slot={s} />}
                <strong>{SLOT_INFO[s].label}</strong>
                <span className="cnt num">{n ? `${t}/${n}` : '—'}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function errText(e: unknown) {
  return e instanceof ApiRequestError ? e.message : '沒有存到，請再試一次';
}

/** 有藥品照片就放照片（右下角是誰的頭像），沒有就放頭像 */
function MedVisual({ med, member, size = 48, onZoom }: { med: Medication; member: Member | undefined; size?: number; onZoom: () => void }) {
  if (!med.drugLicense) return <Avatar member={member} size={Math.round(size * 0.8)} />;
  return <DrugPhoto license={med.drugLicense} size={size} badge={<Avatar member={member} size={Math.round(size * 0.42)} />} onClick={onZoom} label={`看 ${med.name} 的照片`} />;
}

/** 一包藥的樣子：夾鏈藥袋，裡面是誰的頭像、角落是幾種藥 */
function PackBag({ member, count }: { member: Member | undefined; count: number }) {
  return (
    <span className="pack-bag" style={{ ['--c' as string]: member?.color ?? 'var(--text-3)' } as CSSProperties} aria-hidden>
      <span className="emoji">{member?.emoji ?? '？'}</span>
      {count > 1 && <span className="n num">{count}</span>}
    </span>
  );
}

/** 打勾的圈圈：空心＝還沒吃；原子筆圈起來打勾＝吃了；只勾了幾種顯示幾分之幾 */
function Tick({
  status,
  draw,
  seed,
  label,
  partial,
  small,
  disabled,
  onClick,
}: {
  status: PackStatus;
  draw: boolean;
  seed: number;
  label: string;
  partial?: string;
  small?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`tick${small ? ' sm' : ''}${status === 'taken' ? ' on' : status === 'skipped' ? ' skipped' : status === 'partial' ? ' partial' : ''}`}
      aria-pressed={status === 'taken'}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="ring0">{status === 'partial' && partial && <span className="part num">{partial}</span>}</span>
      {status === 'taken' && <InkMark draw={draw} seed={seed} />}
    </button>
  );
}

interface SheetState {
  title: string;
  /** HH:MM */
  initial: string;
  /** 改已經記的時間（按鈕寫「改成 08:20」） */
  edit?: boolean;
  /** 送出 HH:MM；回 false＝沒存到（已經跳過錯誤訊息），面板留著 */
  save: (hm: string) => Promise<boolean | void>;
  remove?: () => Promise<boolean | void>;
}

/** 幾點吃的：預設現在或表定時間，可以點「剛剛」「表定」或自己選 */
function TimeSheet({ sheet, date, scheduled, onClose }: { sheet: SheetState; date: string; scheduled?: string; onClose: () => void }) {
  const [nowAt] = useState(() => taipeiNow());
  const nowHm = nowAt.slice(11, 16);
  const [hm, setHm] = useState(sheet.initial);
  const [busy, setBusy] = useState(false);
  const problem = /^\d{2}:\d{2}$/.test(hm) ? takenAtProblem(date, `${date} ${hm}`, nowAt) : '請選時間';
  const chips: { label: string; hm: string }[] = [{ label: '剛剛', hm: nowHm }];
  if (scheduled && scheduled <= nowHm) chips.push({ label: '表定', hm: scheduled });
  const go = async (fn: () => Promise<boolean | void>) => {
    setBusy(true);
    let ok: boolean | void = false;
    try {
      ok = await fn();
    } catch (e) {
      toast(errText(e), 'error');
    }
    if (ok === false) setBusy(false);
    else onClose();
  };
  return (
    <Panel title={sheet.title} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) void go(() => sheet.save(hm));
        }}
      >
        <p className="small soft" style={{ margin: 0 }}>
          不準時沒關係，記實際吃的時間就好。
        </p>
        <div className="choices" role="group" aria-label="常用時間">
          {chips.map((c) => (
            <button key={c.label} type="button" className="choice num" aria-pressed={hm === c.hm} onClick={() => setHm(c.hm)}>
              {c.label} {c.hm}
            </button>
          ))}
        </div>
        <label className="field">
          <span>吃藥時間</span>
          <input type="time" className="num" value={hm} onChange={(e) => setHm(e.target.value)} required style={{ fontSize: '1.5rem', fontWeight: 700, minHeight: 56 }} />
        </label>
        {problem && hm && <div className="small" style={{ color: 'var(--red)' }}>{problem}</div>}
        <button className="btn lg block" disabled={busy || !!problem}>
          {sheet.edit ? `改成 ${hm}` : `記下 ${hm} 吃了`}
        </button>
        {sheet.remove && (
          <button type="button" className="btn ghost block" style={{ color: 'var(--red)' }} disabled={busy} onClick={() => void go(sheet.remove!)}>
            <Icon.trash />
            這次記錯了，刪掉
          </button>
        )}
      </form>
    </Panel>
  );
}

/**
 * 一包藥（同一次看診、同一個時段）：右邊的圈圈一次勾整包；點藥名那一行打開，看每一種、單獨勾。
 * 自己買的藥（沒有看診）一種一包，跟以前一樣一列。
 * 時間：勾現在這個時段＝記現在；勾之前的時段（例：早上的下午才勾）先問幾點吃的；勾了之後點時間可以改。
 */
function PackRow({
  pack,
  meds,
  visit,
  splitTiming,
  date,
  now,
  logs,
  onChanged,
}: {
  pack: DosePack;
  meds: Medication[];
  visit: Visit | undefined;
  splitTiming: boolean;
  date: string;
  now: Slot;
  logs: DoseLog[];
  onChanged: () => void;
}) {
  const { members } = useSession();
  const member = members.find((m) => m.id === pack.memberId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [justDrew, setJustDrew] = useState<'pack' | number | null>(null);
  // 送出去、新資料還沒回來之前先照按的畫（新的 logs 一到就以資料庫為準）
  const [optimistic, setOptimistic] = useState<Record<number, 'taken' | null> | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [zoom, setZoom] = useState<Medication | null>(null);
  useEffect(() => setOptimistic(null), [logs]);

  const slot = pack.slot;
  const info = SLOT_INFO[slot];
  const single = !pack.visitId && meds.length === 1;
  const logOf = (id: number) => logs.find((l) => l.medicationId === id && l.doseDate === date && l.slot === slot);
  const stateOf = (id: number): 'taken' | 'skipped' | null => (optimistic && id in optimistic ? optimistic[id] : (logOf(id)?.status ?? null));
  const ids = meds.map((m) => m.id);
  const states = ids.map(stateOf);
  const takenIds = ids.filter((id) => stateOf(id) === 'taken');
  const markedN = states.filter(Boolean).length;
  const status: PackStatus = markedN === 0 ? null : markedN < ids.length ? 'partial' : takenIds.length ? 'taken' : 'skipped';
  const times = [...new Set(takenIds.map((id) => logOf(id)?.takenAt).filter((t): t is string => !!t))].sort();
  const late = SLOTS.indexOf(slot) < SLOTS.indexOf(now);
  const title = groupTitle(visit, meds);
  const timing = slot !== 'bedtime' && TIMING_LABEL[pack.timing] ? `${info.meal}${TIMING_LABEL[pack.timing]}` : '';
  const what = single ? title : `${title}${splitTiming && timing ? `（${timing}）` : ''}${info.label}那包`;

  /** 送出去；失敗就跳錯誤訊息、畫面回到原本的樣子，回 false */
  const send = async (fn: () => Promise<unknown>, opt: Record<number, 'taken' | null>): Promise<boolean> => {
    setBusy(true);
    setOptimistic({ ...(optimistic ?? {}), ...opt });
    try {
      await fn();
      onChanged();
      return true;
    } catch (e) {
      setOptimistic(null);
      setJustDrew(null);
      toast(errText(e), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const mark = (list: number[], takenAt?: string) =>
    send(() => api.post('/doses', { medicationIds: list, date, slot, status: 'taken', takenAt }), Object.fromEntries(list.map((id) => [id, 'taken'])));
  const clear = (list: number[]) => send(() => api.post('/doses/clear', { medicationIds: list, date, slot }), Object.fromEntries(list.map((id) => [id, null])));

  /** 勾起來：這包已經有勾過的就用同一個時間；之前的時段先問幾點吃的；其他記現在 */
  const take = (list: number[], drew: 'pack' | number) => {
    const ink = () => {
      setJustDrew(drew);
      if (navigator.vibrate) navigator.vibrate(12);
    };
    if (times.length) {
      ink();
      void mark(list, times[times.length - 1]);
    } else if (late) {
      setSheet({
        title: `${single ? title : `${info.label}那包`}幾點吃的？`,
        initial: info.time,
        save: (hm) => {
          ink();
          return mark(list, `${date} ${hm}`);
        },
      });
    } else {
      ink();
      void mark(list);
    }
  };
  const togglePack = () => {
    if (status === 'taken') {
      setJustDrew(null);
      void clear(ids);
    } else take(ids.filter((id) => stateOf(id) !== 'taken'), 'pack');
  };
  const toggleOne = (id: number) => {
    if (stateOf(id) === 'taken') void clear([id]);
    else take([id], id);
  };
  const editTime = () =>
    setSheet({
      title: '改吃藥時間',
      initial: hhmm(times[times.length - 1] ?? taipeiNow()),
      edit: true,
      save: (hm) => mark(takenIds, `${date} ${hm}`),
    });

  const timeChip = times.length > 0 && (
    <>
      ・
      <button type="button" className="done-at num time-edit" onClick={editTime} aria-label={`${what}是 ${times.map(hhmm).join('、')} 吃的，按一下改時間`}>
        {times.map(hhmm).join('、')} 吃了
        <Icon.edit />
      </button>
    </>
  );
  const sheetEl = sheet && <TimeSheet sheet={sheet} date={date} scheduled={info.time} onClose={() => setSheet(null)} />;
  const zoomEl = zoom?.drugLicense && <DrugLightbox license={zoom.drugLicense} title={zoom.name} onClose={() => setZoom(null)} />;

  if (single) {
    const med = meds[0];
    const sub = [member?.name, med.dose, timing, med.appearance].filter(Boolean).join('・');
    return (
      <div className={`dose${status === 'taken' ? ' done' : ''}`}>
        <MedVisual med={med} member={member} onZoom={() => setZoom(med)} />
        {zoomEl}
        {sheetEl}
        <div className="grow">
          <div className="med-name">
            {med.name}
            {med.category && <span className="tag blue">{med.category}</span>}
          </div>
          <div className="med-sub">
            {sub}
            {status === 'taken' && timeChip}
            {status === 'skipped' && <>・<span style={{ color: 'var(--amber)' }}>跳過</span></>}
          </div>
        </div>
        <Tick
          status={status}
          draw={justDrew === 'pack'}
          seed={med.id * 7 + SLOTS.indexOf(slot)}
          label={`${med.name} ${info.label}${status === 'taken' ? '已吃，按一下取消' : '按一下記已吃'}`}
          disabled={busy}
          onClick={togglePack}
        />
      </div>
    );
  }

  const sub = [member?.name, visit?.doctor, visit ? `${md(visit.visitDate)} 看診` : '', timing].filter(Boolean).join('・');
  return (
    <div className={`pack${status === 'taken' ? ' done' : ''}`}>
      {zoomEl}
      {sheetEl}
      <div className="dose pack-top">
        <PackBag member={member} count={meds.length} />
        <div className="grow">
          <div className="med-name">
            {title}
            {splitTiming && timing && <span className="tag amber">{TIMING_LABEL[pack.timing]}</span>}
          </div>
          <div className="med-sub">
            {sub}
            {status === 'taken' && timeChip}
            {status === 'partial' && (
              <>
                ・<span className="num">{markedN}/{ids.length} 種勾了</span>
                {timeChip}
              </>
            )}
            {status === 'skipped' && <>・<span style={{ color: 'var(--amber)' }}>跳過</span></>}
          </div>
        </div>
        <Tick
          status={status}
          draw={justDrew === 'pack'}
          seed={(pack.visitId ?? 0) * 7 + SLOTS.indexOf(slot)}
          partial={`${markedN}/${ids.length}`}
          label={`${what}（${meds.length} 種藥）${status === 'taken' ? '已吃，按一下取消' : '按一下整包記已吃'}`}
          disabled={busy}
          onClick={togglePack}
        />
      </div>
      <button type="button" className="pack-list" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="names">{open ? '每一種也可以單獨勾' : meds.map((m) => m.name).join('、')}</span>
        <span className="more">
          {open ? '收起' : `${meds.length} 種`}
          <Icon.chevronDown />
        </span>
      </button>
      {open && (
        <div className="pack-meds">
          {meds.map((med) => {
            const st = stateOf(med.id);
            const t = logOf(med.id)?.takenAt;
            return (
              <div key={med.id} className={`pack-med${st === 'taken' ? ' done' : ''}`}>
                <MedVisual med={med} member={member} size={40} onZoom={() => setZoom(med)} />
                <div className="grow">
                  <div className="pm-name">
                    {med.name}
                    {med.category && <span className="tag blue">{med.category}</span>}
                  </div>
                  <div className="pm-sub">
                    {[med.dose, med.appearance].filter(Boolean).join('・')}
                    {st === 'taken' && t && times.length > 1 && <span className="done-at num">・{hhmm(t)}</span>}
                    {st === 'skipped' && <>・<span style={{ color: 'var(--amber)' }}>跳過</span></>}
                  </div>
                </div>
                <Tick
                  small
                  status={st}
                  draw={justDrew === med.id}
                  seed={med.id * 7 + SLOTS.indexOf(slot)}
                  label={`${med.name} ${info.label}${st === 'taken' ? '已吃，按一下取消' : '按一下記已吃'}`}
                  disabled={busy}
                  onClick={() => toggleOne(med.id)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PrnRow({ med, date, logs, onChanged }: { med: Medication; date: string; logs: DoseLog[]; onChanged: () => void }) {
  const { members } = useSession();
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const member = members.find((m) => m.id === med.memberId);
  const todays = logs.filter((l) => l.medicationId === med.id && l.slot === 'prn' && l.doseDate === date);
  const edit = (l: DoseLog) =>
    setSheet({
      title: '改吃藥時間',
      initial: hhmm(l.takenAt ?? l.loggedAt),
      edit: true,
      save: async (hm) => {
        await api.post(`/doses/${l.id}/time`, { takenAt: `${date} ${hm}` });
        onChanged();
        emitDataChanged();
      },
      remove: async () => {
        await api.post(`/doses/${l.id}/delete`, {});
        toast('刪掉了');
        onChanged();
        emitDataChanged();
      },
    });
  return (
    <div className="dose">
      <MedVisual med={med} member={member} onZoom={() => setZoom(true)} />
      {zoom && med.drugLicense && <DrugLightbox license={med.drugLicense} title={med.name} onClose={() => setZoom(false)} />}
      {sheet && <TimeSheet sheet={sheet} date={date} onClose={() => setSheet(null)} />}
      <div className="grow">
        <div className="med-name">
          {med.name}
          {med.category && <span className="tag blue">{med.category}</span>}
        </div>
        <div className="med-sub">
          {[member?.name, med.dose].filter(Boolean).join('・')}
          {todays.length > 0 && (
            <>
              ・<span className="done-at num">今天 {todays.length} 次：</span>
              {todays.map((t, i) => (
                <button key={t.id} type="button" className="done-at num time-edit" onClick={() => edit(t)} aria-label={`${hhmm(t.takenAt ?? t.loggedAt)} 那次，按一下改時間`}>
                  {i > 0 && '、'}
                  {hhmm(t.takenAt ?? t.loggedAt)}
                  <Icon.edit />
                </button>
              ))}
            </>
          )}
        </div>
      </div>
      <button
        className="btn secondary sm prn-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.post('/doses', { medicationId: med.id, date, slot: 'prn' });
            toast(`已記下：${member?.name ?? ''}吃了 ${med.name}（點時間可以改）`);
            onChanged();
            emitDataChanged();
          } catch (e) {
            toast(errText(e), 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon.plus />
        吃了一次
      </button>
    </div>
  );
}

/** 療程：一份一份（同一次看診的藥合起來）算第幾天、吃了幾包、還剩幾包 */
function Course({ course: p, meds, visit }: { course: PackCourse; meds: Medication[]; visit: Visit | undefined }) {
  const { members } = useSession();
  const member = members.find((x) => x.id === p.memberId);
  const takenPct = p.totalPacks ? (p.taken / p.totalPacks) * 100 : 0;
  const skippedPct = p.totalPacks ? (p.skipped / p.totalPacks) * 100 : 0;
  const fromVisit = !!meds[0]?.visitId;
  const detail = fromVisit ? [visit?.doctor, visit ? `${md(visit.visitDate)} 看診` : '', `${meds.length} 種藥`].filter(Boolean).join('・') : '';
  return (
    <div className="course">
      <div className="spread">
        <span className="row nowrap" style={{ minWidth: 0 }}>
          <Avatar member={member} size={24} />
          <strong className="ellipsis">{groupTitle(visit, meds)}</strong>
          {meds.some((m) => m.mustFinish) && <span className="tag amber">要吃完</span>}
        </span>
        <span className="tiny muted num" style={{ whiteSpace: 'nowrap' }}>
          {p.totalDays ? `第 ${Math.min(p.dayNo, p.totalDays)}/${p.totalDays} 天` : `第 ${p.dayNo} 天`}
        </span>
      </div>
      {detail && <div className="tiny muted ellipsis">{detail}</div>}
      {p.totalPacks !== null ? (
        <>
          <div className="bar" aria-hidden>
            <i className="taken" style={{ width: `${takenPct}%` }} />
            <i className="skipped" style={{ width: `${skippedPct}%` }} />
          </div>
          <div className="tiny muted num">
            吃了 {p.taken} 包・還剩 {p.remaining} 包
            {p.missedBeforeToday > 0 && <span style={{ color: 'var(--amber)' }}>・之前有 {p.missedBeforeToday} 包沒打勾</span>}
          </div>
        </>
      ) : (
        <div className="tiny muted">長期服用</div>
      )}
    </div>
  );
}
