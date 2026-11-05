import { useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { DoseLog, Medication, Member, TodayResponse } from '../../shared/apiTypes';
import { taipeiNow } from '../../shared/dates';
import { courseProgress, dosesOn, isActive, SLOT_INFO, SLOTS, TIMING_LABEL, type DueDose, type Slot } from '../../shared/meds';
import { api, ApiRequestError } from '../api';
import { DrugLightbox, DrugPhoto } from '../components/DrugPhoto';
import { MEASURE_ICON } from '../components/QuickAdd';
import { Avatar, ErrorBox, Icon, InkMark, OtterFace, PageHead, PageSkeleton, SlotIcon, toast, UserAvatar } from '../components/ui';
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
  const order = (memberId: number) => members.findIndex((m) => m.id === memberId);
  const scheduled = dosesOn(meds, data.doseLogs, data.date).sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || order(a.memberId) - order(b.memberId));
  const prn = meds.filter((m) => m.asNeeded && isActive(m, data.date));
  const courses = meds.filter((m) => !m.asNeeded && m.startDate <= data.date);
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
          {scheduled.length === 0 && prn.length === 0 ? (
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
            <Hero scheduled={scheduled} now={now} hasPrn={prn.length > 0} />
          )}

          <div className="hide-wide">{quickRow}</div>

          {SLOTS.map((slot) => {
            const list = scheduled.filter((d) => d.slot === slot);
            if (list.length === 0) return null;
            const info = SLOT_INFO[slot];
            const taken = list.filter((d) => d.mark?.status === 'taken').length;
            const allDone = list.every((d) => d.mark);
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
                    {list.map((d) => (
                      <DoseRow
                        key={`${d.medicationId}-${slot}`}
                        med={meds.find((m) => m.id === d.medicationId)!}
                        date={data.date}
                        slot={slot}
                        mark={data.doseLogs.find((l) => l.medicationId === d.medicationId && l.doseDate === data.date && l.slot === slot)}
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
                <span className="aside">{courses.length} 種藥</span>
              </div>
              <div style={{ paddingBottom: 4 }}>
                {courses.map((m) => (
                  <Course key={m.id} med={m} logs={data.doseLogs} date={data.date} />
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

/** 藥袋卡：今天的藥總覽＋四個時段格子 */
function Hero({ scheduled, now, hasPrn }: { scheduled: DueDose[]; now: Slot; hasPrn: boolean }) {
  const total = scheduled.length;
  const taken = scheduled.filter((d) => d.mark?.status === 'taken').length;
  const marked = scheduled.filter((d) => d.mark).length;
  const left = total - marked;
  const pending = (s: Slot) => scheduled.filter((d) => d.slot === s && !d.mark).length;
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
            const n = scheduled.filter((d) => d.slot === s).length;
            const t = scheduled.filter((d) => d.slot === s && d.mark?.status === 'taken').length;
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
function MedVisual({ med, member, onZoom }: { med: Medication; member: Member | undefined; onZoom: () => void }) {
  if (!med.drugLicense) return <Avatar member={member} size={38} />;
  return <DrugPhoto license={med.drugLicense} size={48} badge={<Avatar member={member} size={20} />} onClick={onZoom} label={`看 ${med.name} 的照片`} />;
}

function DoseRow({ med, date, slot, mark, onChanged }: { med: Medication; date: string; slot: Slot; mark: DoseLog | undefined; onChanged: () => void }) {
  const { members } = useSession();
  const [busy, setBusy] = useState(false);
  const [justDrew, setJustDrew] = useState(false);
  const [optimistic, setOptimistic] = useState<'taken' | null | undefined>(undefined);
  const [zoom, setZoom] = useState(false);
  const state = optimistic === undefined ? (mark?.status ?? null) : optimistic;
  const member = members.find((m) => m.id === med.memberId);
  const toggle = async () => {
    setBusy(true);
    try {
      if (state === 'taken') {
        setOptimistic(null);
        setJustDrew(false);
        await api.post('/doses/clear', { medicationId: med.id, date, slot });
      } else {
        setOptimistic('taken');
        setJustDrew(true);
        if (navigator.vibrate) navigator.vibrate(12);
        await api.post('/doses', { medicationId: med.id, date, slot, status: 'taken' });
      }
      onChanged();
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
      setOptimistic(undefined);
    }
  };
  const timing = TIMING_LABEL[med.timing];
  const sub = [member?.name, med.dose, slot !== 'bedtime' && timing ? `${SLOT_INFO[slot].meal}${timing}` : '', med.appearance].filter(Boolean).join('・');
  return (
    <div className={`dose${state === 'taken' ? ' done' : ''}`}>
      <MedVisual med={med} member={member} onZoom={() => setZoom(true)} />
      {zoom && med.drugLicense && <DrugLightbox license={med.drugLicense} title={med.name} onClose={() => setZoom(false)} />}
      <div className="grow">
        <div className="med-name">
          {med.name}
          {med.category && <span className="tag blue">{med.category}</span>}
        </div>
        <div className="med-sub">
          {sub}
          {state === 'taken' && mark && (
            <>
              ・<span className="done-at num">{hhmm(mark.loggedAt)} 吃了</span>
            </>
          )}
          {state === 'skipped' && <>・<span style={{ color: 'var(--amber)' }}>跳過</span></>}
        </div>
      </div>
      <button
        type="button"
        className={`tick${state === 'taken' ? ' on' : state === 'skipped' ? ' skipped' : ''}`}
        aria-pressed={state === 'taken'}
        aria-label={`${med.name} ${SLOT_INFO[slot].label}${state === 'taken' ? '已吃，按一下取消' : '按一下記已吃'}`}
        onClick={toggle}
        disabled={busy}
      >
        <span className="ring0" />
        {state === 'taken' && <InkMark draw={justDrew} seed={med.id * 7 + SLOTS.indexOf(slot)} />}
      </button>
    </div>
  );
}

function PrnRow({ med, date, logs, onChanged }: { med: Medication; date: string; logs: DoseLog[]; onChanged: () => void }) {
  const { members } = useSession();
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);
  const member = members.find((m) => m.id === med.memberId);
  const todays = logs.filter((l) => l.medicationId === med.id && l.slot === 'prn' && l.doseDate === date);
  return (
    <div className="dose">
      <MedVisual med={med} member={member} onZoom={() => setZoom(true)} />
      {zoom && med.drugLicense && <DrugLightbox license={med.drugLicense} title={med.name} onClose={() => setZoom(false)} />}
      <div className="grow">
        <div className="med-name">
          {med.name}
          {med.category && <span className="tag blue">{med.category}</span>}
        </div>
        <div className="med-sub">
          {[member?.name, med.dose].filter(Boolean).join('・')}
          {todays.length > 0 && (
            <>
              ・<span className="done-at num">今天 {todays.length} 次（{todays.map((t) => hhmm(t.loggedAt)).join('、')}）</span>
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
            toast(`已記下：${member?.name ?? ''}吃了 ${med.name}`);
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

function Course({ med, logs, date }: { med: Medication; logs: DoseLog[]; date: string }) {
  const { members } = useSession();
  const p = courseProgress(med, logs, date);
  const member = members.find((x) => x.id === med.memberId);
  const takenPct = p.totalDoses ? (p.taken / p.totalDoses) * 100 : 0;
  const skippedPct = p.totalDoses ? (p.skipped / p.totalDoses) * 100 : 0;
  return (
    <div className="course">
      <div className="spread">
        <span className="row nowrap" style={{ minWidth: 0 }}>
          <Avatar member={member} size={24} />
          <strong className="ellipsis">{med.name}</strong>
          {med.mustFinish && <span className="tag amber">要吃完</span>}
        </span>
        <span className="tiny muted num" style={{ whiteSpace: 'nowrap' }}>
          {p.totalDays ? `第 ${Math.min(p.dayNo, p.totalDays)}/${p.totalDays} 天` : `第 ${p.dayNo} 天`}
        </span>
      </div>
      {p.totalDoses !== null ? (
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
