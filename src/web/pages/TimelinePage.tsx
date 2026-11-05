import type { CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MEASUREMENT_INFO, type Measurement, type TimelineItem } from '../../shared/apiTypes';
import { taipeiToday } from '../../shared/dates';
import { api } from '../api';
import { MEASURE_ICON } from '../components/QuickAdd';
import { Avatar, confirmDialog, Empty, ErrorBox, Icon, MemberPicker, PageHead, toast } from '../components/ui';
import { dayLabel, hhmm, weekday } from '../format';
import { emitDataChanged, useApi, useQuick, useSession } from '../hooks';

export function measurementText(m: Measurement): string {
  const info = MEASUREMENT_INFO[m.kind];
  return `${info.label} ${m.value}${m.value2 !== null ? `/${m.value2}` : ''} ${info.unit}`;
}

const SEVERITY_LABEL = ['', '輕微', '有點不舒服', '很不舒服'];
const SEVERITY_TINT = [
  ['var(--surface-3)', 'var(--text-2)'],
  ['var(--green-soft)', 'var(--green)'],
  ['var(--amber-soft)', 'var(--amber)'],
  ['var(--red-soft)', 'var(--red)'],
];
const SEVERITY_TAG = ['', 'green', 'amber', 'red'];

const tint = (bg: string, ink: string) => ({ ['--tint' as string]: bg, ['--tint-ink' as string]: ink }) as CSSProperties;

/** 「今天 11/5」→ 標題；星期放旁邊 */
function DayHead({ day, today }: { day: string; today: string }) {
  const label = dayLabel(day, today);
  const near = label.startsWith('今天') || label.startsWith('昨天') || label.startsWith('明天');
  return (
    <div className="day-head">
      <h3 className="num">{near ? label.slice(0, 2) : label.replace(/（.）$/, '')}</h3>
      <span className="num">
        {near ? `${label.slice(3)}・` : ''}星期{weekday(day)}
      </span>
    </div>
  );
}

export function Timeline({ items, showWho = true, empty }: { items: TimelineItem[]; showWho?: boolean; empty?: string }) {
  const { members } = useSession();
  const today = taipeiToday();
  if (items.length === 0)
    return (
      <div className="card">
        <Empty icon={<Icon.log />} title="還沒有紀錄">
          {empty ?? '身體不舒服、量了體溫、看了醫生，都可以記下來。回診時給醫生看最清楚。'}
        </Empty>
      </div>
    );
  const days: { day: string; items: TimelineItem[] }[] = [];
  for (const it of items) {
    const day = it.at.slice(0, 10);
    if (days.at(-1)?.day !== day) days.push({ day, items: [] });
    days.at(-1)!.items.push(it);
  }
  const voidIt = async (kind: 'notes' | 'measurements', id: number, what: string) => {
    if (!(await confirmDialog({ title: `刪除這筆${what}？`, message: '刪除後在紀錄裡就看不到了。', confirmText: '刪除', danger: true }))) return;
    try {
      await api.post(`/${kind}/${id}/void`, { reason: '刪除' });
      toast(`已刪除這筆${what}`);
      emitDataChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : '刪不掉，請再試一次', 'error');
    }
  };
  return (
    <div>
      {days.map(({ day, items: list }) => (
        <section key={day} className="day-group">
          <DayHead day={day} today={today} />
          <div className="card list">
            {list.map((it) => {
              const member = members.find((m) => m.id === it.memberId);
              const who = showWho && (
                <span className="who">
                  <Avatar member={member} size={20} />
                  {member?.name ?? '（已移除）'}
                </span>
              );
              if (it.type === 'visit') {
                const v = it.visit;
                return (
                  <Link key={`v${v.id}`} to={`/visits/${v.id}`} className="entry item">
                    <span className="entry-ic" style={tint('var(--primary-soft)', 'var(--primary-ink)')}>
                      <Icon.visit />
                    </span>
                    <span className="grow">
                      <span className="entry-top">
                        {who}
                        <span>看診</span>
                      </span>
                      <span className="entry-title">
                        {v.clinic || '看診'}
                        {v.department && <span className="muted" style={{ fontWeight: 500 }}>・{v.department}</span>}
                      </span>
                      {(v.reason || v.diagnosis) && <span className="soft small">{[v.reason, v.diagnosis].filter(Boolean).join('；')}</span>}
                      {it.medCount > 0 && (
                        <span className="entry-foot">
                          <span className="tag blue">
                            <Icon.pill />開了 {it.medCount} 種藥
                          </span>
                        </span>
                      )}
                    </span>
                    <span className="ic18 muted" style={{ alignSelf: 'center' }}>
                      <Icon.chevronRight />
                    </span>
                  </Link>
                );
              }
              if (it.type === 'note') {
                const n = it.note;
                const [bg, ink] = SEVERITY_TINT[n.severity];
                return (
                  <div key={`n${n.id}`} className="entry">
                    <span className="entry-ic" style={tint(bg, ink)}>
                      <Icon.note />
                    </span>
                    <span className="grow">
                      <span className="entry-top">
                        {who}
                        <span>身體狀況</span>
                        <time>{hhmm(n.notedAt)}</time>
                      </span>
                      <span className="entry-body">{n.body}</span>
                      {(n.severity > 0 || n.source === 'dr_claude') && (
                        <span className="entry-foot">
                          {n.severity > 0 && <span className={`tag ${SEVERITY_TAG[n.severity]}`}>{SEVERITY_LABEL[n.severity]}</span>}
                          {n.source === 'dr_claude' && <span className="tag otter">Dr.Claude 記的</span>}
                        </span>
                      )}
                    </span>
                    <button type="button" className="icon-btn sm" aria-label="刪除這筆身體狀況" onClick={() => void voidIt('notes', n.id, '身體狀況')}>
                      <Icon.trash />
                    </button>
                  </div>
                );
              }
              const m = it.measurement;
              const info = MEASUREMENT_INFO[m.kind];
              const I = MEASURE_ICON[m.kind];
              const fever = m.kind === 'temperature' && m.value >= 38;
              return (
                <div key={`m${m.id}`} className="entry">
                  <span className="entry-ic" style={m.kind === 'temperature' ? tint('var(--red-soft)', 'var(--red)') : tint('var(--green-soft)', 'var(--green)')}>
                    <I />
                  </span>
                  <span className="grow">
                    <span className="entry-top">
                      {who}
                      <span>{info.label}</span>
                      <time>{hhmm(m.measuredAt)}</time>
                    </span>
                    <span className={`measure-val${fever ? ' fever' : ''}`}>
                      {m.value}
                      {m.value2 !== null && `/${m.value2}`}
                      <small>{info.unit}</small>
                      {fever && (
                        <span className="tag red" style={{ marginLeft: 8, verticalAlign: 4 }}>
                          發燒
                        </span>
                      )}
                    </span>
                    {(m.note || m.source === 'dr_claude') && (
                      <span className="entry-foot">
                        {m.note && <span className="small muted">{m.note}</span>}
                        {m.source === 'dr_claude' && <span className="tag otter">Dr.Claude 記的</span>}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="icon-btn sm"
                    aria-label={`刪除這筆${info.label}`}
                    onClick={() => void voidIt('measurements', m.id, info.label)}
                  >
                    <Icon.trash />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

const PERIODS = [
  { v: 30, label: '30 天' },
  { v: 90, label: '3 個月' },
  { v: 365, label: '一年' },
  { v: 3650, label: '全部' },
];

export function TimelinePage() {
  const { members } = useSession();
  const quick = useQuick();
  const [params, setParams] = useSearchParams();
  const memberId = params.get('memberId') ? Number(params.get('memberId')) : null;
  const days = Number(params.get('days') ?? 90);
  const tl = useApi<TimelineItem[]>(`/timeline?days=${days}${memberId ? `&memberId=${memberId}` : ''}`);
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v === null) p.delete(k);
    else p.set(k, v);
    setParams(p, { replace: true });
  };
  const counts = tl.data && {
    visit: tl.data.filter((i) => i.type === 'visit').length,
    note: tl.data.filter((i) => i.type === 'note').length,
    measurement: tl.data.filter((i) => i.type === 'measurement').length,
  };
  return (
    <div className="page">
      <PageHead
        title="紀錄"
        sub={counts ? `看診 ${counts.visit} 次・身體狀況 ${counts.note} 筆・量測 ${counts.measurement} 筆` : '看診、身體狀況、量測'}
        actions={
          <button className="btn sm" onClick={() => quick.open('menu', { memberId })}>
            <Icon.plus />
            新增
          </button>
        }
      />
      <div className="filters">
        <MemberPicker members={members} value={memberId} onChange={(v) => set('memberId', v === null ? null : String(v))} allowAll />
        <div className="seg" role="group" aria-label="期間" style={{ justifySelf: 'start' }}>
          {PERIODS.map((p) => (
            <button key={p.v} type="button" aria-pressed={days === p.v} onClick={() => set('days', String(p.v))}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <ErrorBox error={tl.error} />
      {tl.data ? (
        <Timeline items={tl.data} showWho={memberId === null} />
      ) : (
        <div className="stack sm">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel" style={{ height: 96, borderRadius: 18 }} />
          ))}
        </div>
      )}
    </div>
  );
}
