import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { DoseLog, Medication, TodayResponse } from '../../shared/apiTypes';
import { taipeiNow } from '../../shared/dates';
import { courseProgress, dosesOn, isActive, SLOT_INFO, SLOTS, TIMING_LABEL, type Slot } from '../../shared/meds';
import { api } from '../api';
import { MeasurePanel, NotePanel } from '../components/QuickAdd';
import { ErrorBox, InkCircle, Loading, Who } from '../components/ui';
import { dayLabel, weekday } from '../format';
import { useAction, useApi, usePoll, useSession } from '../hooks';

/** 現在是哪個時段（過了上一個時段的時間就算下一個） */
function currentSlot(): Slot {
  const t = taipeiNow().slice(11, 16);
  if (t < '11:00') return 'morning';
  if (t < '16:30') return 'noon';
  if (t < '20:30') return 'evening';
  return 'bedtime';
}

export function TodayPage() {
  const { me, members } = useSession();
  const today = useApi<TodayResponse>('/today');
  const [panel, setPanel] = useState<'note' | 'temp' | null>(null);
  usePoll(today.reload, 60_000);
  const data = today.data;
  if (!data) return today.error ? <ErrorBox error={today.error} /> : <Loading />;

  const meds = data.medications;
  const scheduled = dosesOn(meds, data.doseLogs, data.date);
  const prn = meds.filter((m) => m.asNeeded && isActive(m, data.date));
  const courses = meds.filter((m) => !m.asNeeded && m.startDate <= data.date);
  const now = currentSlot();
  const name = members.find((m) => m.id === me.memberId)?.name || me.name;

  return (
    <div className="stack">
      <header className="topbar">
        <div className="title">
          <h1>{name ? `${name}，${greeting()}` : greeting()}</h1>
          <div className="date num">
            {data.date.slice(5).replace('-', '/')}（{weekday(data.date)}）
          </div>
        </div>
        <Link to="/settings" className="avatar" aria-label="設定">
          {me.picture ? <img src={me.picture} alt="" referrerPolicy="no-referrer" /> : '⚙︎'}
        </Link>
      </header>

      <div className="row">
        <button className="btn quiet small" onClick={() => setPanel('note')}>
          記身體狀況
        </button>
        <button className="btn quiet small" onClick={() => setPanel('temp')}>
          量體溫
        </button>
        <Link className="btn quiet small" to="/visits/new">
          拍藥袋
        </Link>
      </div>

      {scheduled.length === 0 && prn.length === 0 ? (
        <section className="sheet">
          <div className="sheet-head">
            <h2>今天的藥</h2>
          </div>
          <div className="empty">
            今天沒有要吃的藥。
            <br />
            看完醫生拍一下藥袋，Dr.Claude 會幫你排好時間。
          </div>
        </section>
      ) : (
        <section className="sheet" aria-label="今天的藥">
          <div className="sheet-head">
            <h2>今天的藥</h2>
            <span className="meta num">
              {scheduled.filter((d) => d.mark).length}/{scheduled.length} 包
            </span>
          </div>
          {SLOTS.map((slot) => {
            const list = scheduled.filter((d) => d.slot === slot);
            if (list.length === 0) return null;
            const info = SLOT_INFO[slot];
            return (
              <div key={slot}>
                <div className={`slot-head${slot === now ? ' now' : ''}`}>
                  <h3>
                    {info.emoji} {info.label}
                  </h3>
                  <span className="time num">{info.time}</span>
                  {slot === now && <span className="pill-tag">現在</span>}
                </div>
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
            );
          })}
          {prn.length > 0 && (
            <div>
              <div className="slot-head">
                <h3>需要時才吃</h3>
              </div>
              {prn.map((m) => (
                <PrnRow key={m.id} med={m} date={data.date} logs={data.doseLogs} onChanged={today.reload} />
              ))}
            </div>
          )}
        </section>
      )}

      {courses.length > 0 && (
        <section className="sheet">
          <div className="sheet-head">
            <h2>療程</h2>
          </div>
          <div className="ruled">
            {courses.map((m) => {
              const p = courseProgress(m, data.doseLogs, data.date);
              const pct = p.totalDoses ? Math.round(((p.taken + p.skipped) / p.totalDoses) * 100) : 0;
              return (
                <div key={m.id} className="stack" style={{ gap: 6 }}>
                  <div className="spread">
                    <Who member={members.find((x) => x.id === m.memberId)} size="sm" />
                    <span className="small muted num">
                      {p.totalDays ? `第 ${Math.min(p.dayNo, p.totalDays)}/${p.totalDays} 天` : `第 ${p.dayNo} 天`}
                    </span>
                  </div>
                  <div>
                    <strong>{m.name}</strong> {m.mustFinish && <span className="pill-tag must">要吃完</span>}
                  </div>
                  {p.totalDoses !== null && (
                    <>
                      <div className="progress" aria-hidden>
                        <i style={{ width: `${pct}%` }} />
                      </div>
                      <div className="small muted num">
                        吃了 {p.taken} 包，還剩 {p.remaining} 包
                        {p.missedBeforeToday > 0 && `，之前有 ${p.missedBeforeToday} 包沒打勾`}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {data.followUps.length > 0 && (
        <section className="sheet">
          <div className="sheet-head">
            <h2>回診</h2>
          </div>
          <div className="ruled">
            {data.followUps.map((f) => (
              <Link key={f.visitId} to={`/visits/${f.visitId}`} className="spread" style={{ color: 'inherit', textDecoration: 'none' }}>
                <Who member={members.find((x) => x.id === f.memberId)} size="sm" />
                <span>
                  {dayLabel(f.date, data.date)} {f.clinic}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {panel === 'note' && <NotePanel onClose={() => setPanel(null)} onSaved={() => setPanel(null)} />}
      {panel === 'temp' && <MeasurePanel kind="temperature" onClose={() => setPanel(null)} onSaved={() => setPanel(null)} />}
    </div>
  );
}

function greeting(): string {
  const h = Number(taipeiNow().slice(11, 13));
  if (h < 5) return '夜深了';
  if (h < 11) return '早安';
  if (h < 14) return '午安';
  if (h < 18) return '下午好';
  return '晚安';
}

function DoseRow({ med, date, slot, mark, onChanged }: { med: Medication; date: string; slot: Slot; mark: DoseLog | undefined; onChanged: () => void }) {
  const { members } = useSession();
  const act = useAction();
  const [justDrew, setJustDrew] = useState(false);
  const [optimistic, setOptimistic] = useState<'taken' | null | undefined>(undefined);
  const state = optimistic === undefined ? (mark?.status ?? null) : optimistic;
  const toggle = async () => {
    if (state === 'taken') {
      setOptimistic(null);
      await act.run(() => api.post('/doses/clear', { medicationId: med.id, date, slot }));
    } else {
      setOptimistic('taken');
      setJustDrew(true);
      await act.run(() => api.post('/doses', { medicationId: med.id, date, slot, status: 'taken' }));
    }
    onChanged();
    setOptimistic(undefined);
  };
  const timing = TIMING_LABEL[med.timing];
  return (
    <div className={`dose${state === 'taken' ? ' done' : ''}`}>
      <div>
        <div className="row" style={{ gap: 6 }}>
          <Who member={members.find((m) => m.id === med.memberId)} size="sm" />
          {med.category && <span className="pill-tag">{med.category}</span>}
        </div>
        <div className="med-name">{med.name}</div>
        <div className="med-sub">
          {med.dose}
          {slot !== 'bedtime' && timing && `・${SLOT_INFO[slot].meal}${timing}`}
          {med.appearance && `・${med.appearance}`}
        </div>
        <ErrorBox error={act.error} />
      </div>
      <button
        type="button"
        className={`tick${state === 'taken' ? ' on' : state === 'skipped' ? ' skipped' : ''}`}
        aria-pressed={state === 'taken'}
        aria-label={`${med.name} ${SLOT_INFO[slot].label}${state === 'taken' ? '已吃，按一下取消' : '按一下記已吃'}`}
        onClick={toggle}
        disabled={act.busy}
      >
        <span className="ring" />
        {state === 'taken' && <InkCircle draw={justDrew} seed={med.id * 7 + SLOTS.indexOf(slot)} />}
        <span className="label">{state === 'taken' ? '已服' : state === 'skipped' ? '跳過' : '服用'}</span>
      </button>
    </div>
  );
}

function PrnRow({ med, date, logs, onChanged }: { med: Medication; date: string; logs: DoseLog[]; onChanged: () => void }) {
  const { members } = useSession();
  const act = useAction();
  const todays = logs.filter((l) => l.medicationId === med.id && l.slot === 'prn' && l.doseDate === date);
  return (
    <div className="dose">
      <div>
        <Who member={members.find((m) => m.id === med.memberId)} size="sm" />
        <div className="med-name">{med.name}</div>
        <div className="med-sub">
          {med.dose}
          {todays.length > 0 && `・今天吃了 ${todays.length} 次（${todays.map((t) => t.loggedAt.slice(11, 16)).join('、')}）`}
        </div>
        <ErrorBox error={act.error} />
      </div>
      <button
        className="btn quiet small"
        disabled={act.busy}
        onClick={async () => {
          await act.run(() => api.post('/doses', { medicationId: med.id, date, slot: 'prn' }));
          onChanged();
        }}
      >
        吃了一次
      </button>
    </div>
  );
}
