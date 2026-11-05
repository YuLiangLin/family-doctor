import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Measurement, MeasurementKind, Member, MemberDetail, TimelineItem, TodayResponse } from '../../shared/apiTypes';
import { MEASUREMENT_INFO } from '../../shared/apiTypes';
import { addDays, taipeiToday } from '../../shared/dates';
import { courseProgress, isActive, scheduleLabel } from '../../shared/meds';
import { api } from '../api';
import { MedPhotoSlot } from '../components/DrugPhoto';
import { MEASURE_ICON, MeasurePanel } from '../components/QuickAdd';
import { Avatar, confirmDialog, Empty, ErrorBox, Icon, OtterFace, PageHead, PageSkeleton, Panel, promptDialog, toast, ViaTag } from '../components/ui';
import { dayLabel } from '../format';
import { emitDataChanged, useAction, useApi, useQuick, useSession } from '../hooks';
import { Timeline } from './TimelinePage';

const COLORS = ['#1f5fbf', '#c0507a', '#2f8a63', '#b97d0c', '#7a4fc2', '#cc3f25', '#0f8a9a', '#8a5a3b'];
const EMOJIS = ['🙂', '👨', '👩', '👧', '👦', '👶', '👵', '👴', '🐣', '🌷', '⭐', '🐻', '🐰', '🦊', '🐼', '🌸'];

export function ageOf(birth: string | null): string {
  if (!birth) return '';
  const today = taipeiToday();
  let months = (Number(today.slice(0, 4)) - Number(birth.slice(0, 4))) * 12 + (Number(today.slice(5, 7)) - Number(birth.slice(5, 7)));
  if (Number(today.slice(8, 10)) < Number(birth.slice(8, 10))) months -= 1;
  if (months < 0) return '';
  const y = Math.floor(months / 12);
  if (y >= 18) return `${y} 歲`;
  return y === 0 ? `${months} 個月` : `${y} 歲 ${months % 12} 個月`;
}

const hasAllergy = (m: Member) => !!m.allergies.trim() && !/^(無|沒有|none)$/i.test(m.allergies.trim());
const tint = (bg: string, ink: string) => ({ ['--tint' as string]: bg, ['--tint-ink' as string]: ink }) as CSSProperties;

export function MembersPage() {
  const { members, reloadMembers } = useSession();
  const today = useApi<TodayResponse>('/today');
  const [adding, setAdding] = useState(false);
  const activeCount = (id: number) => today.data?.medications.filter((m) => m.memberId === id && isActive(m, today.data!.date)).length ?? 0;
  return (
    <div className="page wide">
      <PageHead
        title="家人"
        sub={members.length ? `${members.length} 位家人` : undefined}
        actions={
          <button className="btn sm" onClick={() => setAdding(true)}>
            <Icon.plus />
            新增家人
          </button>
        }
      />
      {members.length === 0 ? (
        <div className="card">
          <Empty
            icon={<Icon.family />}
            title="先把家人加進來"
            action={
              <button className="btn" onClick={() => setAdding(true)}>
                <Icon.plus />
                新增家人
              </button>
            }
          >
            你、太太、兩個小朋友。小朋友不用帳號，爸媽幫忙記。
          </Empty>
        </div>
      ) : (
        <div className="member-grid">
          {members.map((m) => {
            const n = activeCount(m.id);
            return (
              <Link key={m.id} to={`/family/${m.id}`} className="member-tile" style={{ ['--c' as string]: m.color } as CSSProperties}>
                <div className="top">
                  <Avatar member={m} size={56} />
                  <div className="grow">
                    <h3>{m.name}</h3>
                    <div className="meta">{[m.relation, ageOf(m.birthDate)].filter(Boolean).join('・') || '　'}</div>
                  </div>
                  <span className="chev">
                    <Icon.chevronRight />
                  </span>
                </div>
                <div className="tags">
                  {n > 0 ? (
                    <span className="tag blue">
                      <Icon.pill />
                      正在吃 {n} 種藥
                    </span>
                  ) : (
                    <span className="tag">目前沒有吃藥</span>
                  )}
                  {hasAllergy(m) && (
                    <span className="tag red">
                      <Icon.alert />
                      過敏：{m.allergies}
                    </span>
                  )}
                  {m.bloodType && <span className="tag">{m.bloodType} 型</span>}
                </div>
              </Link>
            );
          })}
          <button type="button" className="member-tile add" onClick={() => setAdding(true)}>
            <span>
              <span className="ic">
                <Icon.plus />
              </span>
              新增家人
            </span>
          </button>
        </div>
      )}
      {adding && (
        <MemberForm
          onClose={() => setAdding(false)}
          onSaved={(name) => {
            setAdding(false);
            toast(`已新增 ${name}`);
            reloadMembers();
          }}
        />
      )}
    </div>
  );
}

function MemberForm({ member, onClose, onSaved }: { member?: Member; onClose: () => void; onSaved: (name: string) => void }) {
  const [f, setF] = useState({
    name: member?.name ?? '',
    relation: member?.relation ?? '',
    birthDate: member?.birthDate ?? '',
    sex: member?.sex ?? '',
    bloodType: member?.bloodType ?? '',
    allergies: member?.allergies ?? '',
    conditions: member?.conditions ?? '',
    note: member?.note ?? '',
    color: member?.color ?? COLORS[0],
    emoji: member?.emoji ?? '🙂',
    sortOrder: member?.sortOrder ?? 0,
  });
  const act = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Panel title={member ? `編輯 ${member.name}` : '新增家人'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const body = { ...f, birthDate: f.birthDate || null };
          const ok = await act.run(() => (member ? api.put(`/members/${member.id}`, body) : api.post('/members', body)));
          if (ok) onSaved(f.name);
        }}
      >
        <div className="row nowrap" style={{ gap: 14 }}>
          <Avatar member={{ emoji: f.emoji, color: f.color }} size={60} />
          <label className="field grow">
            <span>稱呼</span>
            <input value={f.name} onChange={set('name')} required placeholder="例：蓉蓉" />
          </label>
        </div>
        <div className="field">
          <span>圖示</span>
          <div className="choices" style={{ gap: 6 }}>
            {EMOJIS.map((e) => (
              <label key={e} className="choice" style={{ padding: 0, width: 42, justifyContent: 'center', fontSize: '1.25rem' }} aria-label={e}>
                <input type="radio" name="emoji" checked={f.emoji === e} onChange={() => setF({ ...f, emoji: e })} />
                {e}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <span>代表色</span>
          <div className="choices" style={{ gap: 6 }}>
            {COLORS.map((c) => (
              <label key={c} className="choice" style={{ padding: 0, width: 42, justifyContent: 'center' }} aria-label={`顏色 ${c}`}>
                <input type="radio" name="color" checked={f.color === c} onChange={() => setF({ ...f, color: c })} />
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: c, display: 'block' }} />
              </label>
            ))}
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>關係</span>
            <input value={f.relation} onChange={set('relation')} placeholder="本人、太太、女兒" />
          </label>
          <label className="field">
            <span>生日</span>
            <input type="date" value={f.birthDate} onChange={set('birthDate')} />
          </label>
          <label className="field">
            <span>性別</span>
            <select value={f.sex} onChange={set('sex')}>
              <option value="">不填</option>
              <option value="M">男</option>
              <option value="F">女</option>
            </select>
          </label>
          <label className="field">
            <span>血型</span>
            <input value={f.bloodType} onChange={set('bloodType')} placeholder="A、B、O、AB" />
          </label>
        </div>
        <label className="field">
          <span>過敏（藥物、食物）</span>
          <input value={f.allergies} onChange={set('allergies')} placeholder="沒有就寫「無」" />
          <span className="hint">Dr.水獺 每次回答都會先看這一欄。</span>
        </label>
        <label className="field">
          <span>重要病史、慢性病</span>
          <textarea value={f.conditions} onChange={set('conditions')} placeholder="例：約三年前肺炎鏈球菌感染住院" />
        </label>
        <label className="field">
          <span>備註</span>
          <textarea value={f.note} onChange={set('note')} style={{ minHeight: 72 }} />
        </label>
        <label className="field" style={{ maxWidth: 160 }}>
          <span>排序（小的在前）</span>
          <input type="number" min={0} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} />
        </label>
        <ErrorBox error={act.error} />
        <button className="btn lg block" disabled={act.busy}>
          {member ? '儲存' : '新增'}
        </button>
      </form>
    </Panel>
  );
}

/** 量容器寬度（圖表用實際像素畫，字不會跟著縮放） */
function useWidth<T extends HTMLElement>(fallback: number) {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w] as const;
}

/** 體溫曲線（最近 7 天） */
function TempChart({ points }: { points: Measurement[] }) {
  const [box, W] = useWidth<HTMLDivElement>(320);
  const pts = points
    .filter((p) => p.kind === 'temperature' && p.measuredAt >= addDays(taipeiToday(), -7))
    .sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : 1));
  if (pts.length < 2) return null;
  const H = 170;
  const L = 30;
  const R = 10;
  const T = 12;
  const B = 24;
  const min = Math.min(36, Math.floor(Math.min(...pts.map((p) => p.value)) * 2) / 2);
  const max = Math.max(39, Math.ceil(Math.max(...pts.map((p) => p.value)) * 2) / 2);
  const x = (i: number) => L + (i / (pts.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const ticks: number[] = [];
  for (let v = Math.ceil(min); v <= max; v += 1) ticks.push(v);
  const line = pts.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
  const area = `M ${x(0)},${H - B} L ${line.replace(/ /g, ' L ')} L ${x(pts.length - 1)},${H - B} Z`;
  const first = pts[0].measuredAt.slice(5, 10).replace('-', '/');
  const last = pts.at(-1)!.measuredAt.slice(5, 10).replace('-', '/');
  return (
    <section className="card">
      <div className="card-head">
        <h2>最近 7 天體溫</h2>
        <span className="aside num">最高 {Math.max(...pts.map((p) => p.value))}°C</span>
      </div>
      <div className="card-body" style={{ paddingTop: 4 }} ref={box}>
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`最近體溫：${pts.map((p) => p.value).join('、')}`}>
          <defs>
            <linearGradient id="temp-grad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--primary)" stopOpacity="0.22" />
              <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="grid">
            {ticks.map((t) => (
              <line key={t} x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            ))}
          </g>
          <g className="axis">
            {ticks.map((t) => (
              <text key={t} x={L - 6} y={y(t) + 3.5} textAnchor="end">
                {t}°
              </text>
            ))}
            <text x={L} y={H - 6}>
              {first}
            </text>
            <text x={W - R} y={H - 6} textAnchor="end">
              {last}
            </text>
          </g>
          <line className="fever-line" x1={L} x2={W - R} y1={y(38)} y2={y(38)} />
          <text className="fever-label" x={W - R} y={y(38) - 5} textAnchor="end">
            發燒 38°
          </text>
          <path className="area" d={area} />
          <polyline className="line" points={line} />
          {pts.map((p, i) => (
            <circle key={p.id} className={p.value >= 38 ? 'hot' : undefined} cx={x(i)} cy={y(p.value)} r={3.5} />
          ))}
        </svg>
      </div>
    </section>
  );
}

const STAT_KINDS: MeasurementKind[] = ['temperature', 'weight', 'height'];

function Stats({ measurements }: { measurements: Measurement[] }) {
  const latest = (k: MeasurementKind) => measurements.filter((m) => m.kind === k).sort((a, b) => (a.measuredAt < b.measuredAt ? 1 : -1))[0];
  return (
    <div className="stats">
      {STAT_KINDS.map((k) => {
        const m = latest(k);
        const I = MEASURE_ICON[k];
        const info = MEASUREMENT_INFO[k];
        return (
          <div key={k} className={`stat${k === 'temperature' && m && m.value >= 38 ? ' fever' : ''}`}>
            <div className="k">
              <I />
              {info.label}
            </div>
            <div className="v">
              {m ? m.value : '—'}
              {m && <small>{info.unit}</small>}
            </div>
            <div className="when">{m ? dayLabel(m.measuredAt.slice(0, 10)) : '還沒量過'}</div>
          </div>
        );
      })}
    </div>
  );
}

export function MemberPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const quick = useQuick();
  const { me, reloadMembers } = useSession();
  const detail = useApi<MemberDetail>(`/members/${id}`);
  const tl = useApi<TimelineItem[]>(`/timeline?memberId=${id}&days=365`);
  const [panel, setPanel] = useState<'edit' | 'measure' | null>(null);
  const d = detail.data;
  if (!d) return detail.error ? <div className="page"><ErrorBox error={detail.error} /></div> : <PageSkeleton wide />;
  const m = d.member;
  const today = taipeiToday();
  const current = d.medications.filter((x) => isActive(x, today));
  const facts = [
    { k: '過敏', v: m.allergies, icon: <Icon.alert />, alert: hasAllergy(m) },
    { k: '病史', v: m.conditions, icon: <Icon.heartPulse /> },
    ...(m.note ? [{ k: '備註', v: m.note, icon: <Icon.note /> }] : []),
  ];

  const stopMed = async (medId: number, name: string, mustFinish: boolean) => {
    const reason = await promptDialog({
      title: `停掉 ${name}？`,
      message: mustFinish ? '醫生交代這個藥要吃完。確定要停的話，寫一下原因（例：醫生說可以停）。' : '停了之後就不會再提醒。',
      label: '停藥原因',
      placeholder: mustFinish ? '例：醫生說可以停' : '選填',
      required: mustFinish,
      confirmText: '停藥',
      danger: true,
    });
    if (reason === null) return;
    try {
      await api.post(`/medications/${medId}/stop`, { reason });
      toast(`已停掉 ${name}`);
      emitDataChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : '停藥失敗', 'error');
    }
  };

  return (
    <div className="page wide">
      <button type="button" className="back-link" onClick={() => nav('/family')}>
        <Icon.chevronLeft />
        家人
      </button>
      <div className="cols left">
        <div className="stack sticky">
          <section className="card profile" style={{ ['--c' as string]: m.color } as CSSProperties}>
            <div className="top">
              <Avatar member={m} size={72} />
              <div className="grow">
                <h1>{m.name}</h1>
                <div className="meta">{[m.relation, ageOf(m.birthDate), m.bloodType && `${m.bloodType} 型`].filter(Boolean).join('・')}</div>
              </div>
              <button className="icon-btn" aria-label={`編輯 ${m.name}`} onClick={() => setPanel('edit')} style={{ alignSelf: 'flex-start' }}>
                <Icon.edit />
              </button>
            </div>
            <dl className="health-facts">
              {facts.map((f) => (
                <div key={f.k} className={`fact${f.alert ? ' alert-fact' : ''}`}>
                  {f.icon}
                  <dt>{f.k}</dt>
                  <dd>{f.v || <span className="muted" style={{ fontWeight: 400 }}>沒填</span>}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="quick">
            <button type="button" className="quick-btn" style={tint('var(--amber-soft)', 'var(--amber)')} onClick={() => quick.open('note', { memberId: m.id })}>
              <span className="ic">
                <Icon.note />
              </span>
              身體狀況
            </button>
            <button type="button" className="quick-btn" style={tint('var(--red-soft)', 'var(--red)')} onClick={() => setPanel('measure')}>
              <span className="ic">
                <Icon.thermometer />
              </span>
              量測
            </button>
            <Link className="quick-btn" to={`/visits/new?memberId=${m.id}`}>
              <span className="ic">
                <Icon.visit />
              </span>
              記看診
            </Link>
            <Link className="quick-btn" style={tint('var(--otter-soft)', 'var(--otter)')} to={`/doctor?memberId=${m.id}`}>
              <span className="ic" style={{ background: 'var(--otter)' }}>
                <OtterFace size={28} />
              </span>
              問醫生
            </Link>
          </div>

          <Stats measurements={d.measurements} />
        </div>

        <div className="stack">
          <TempChart points={d.measurements} />

          <section className="card">
            <div className="card-head">
              <h2>正在吃的藥</h2>
              <span className="aside">{current.length ? `${current.length} 種` : ''}</span>
            </div>
            {current.length === 0 ? (
              <Empty icon={<Icon.pill />}>目前沒有在吃的藥</Empty>
            ) : (
              <div style={{ paddingBottom: 4 }}>
                {current.map((x) => {
                  const p = courseProgress(x, d.doseLogs, today);
                  return (
                    <div key={x.id} className="med med-with-photo">
                      <MedPhotoSlot med={x} />
                      <div className="grow">
                        <div className="name">
                          {x.name}
                          {x.category && <span className="tag blue">{x.category}</span>}
                          {x.mustFinish && <span className="tag amber">要吃完</span>}
                          <ViaTag by={x.createdBy} />
                        </div>
                        <div className="line num">
                          {[x.dose, scheduleLabel(x.slots, x.timing, x.asNeeded), p.totalDays ? `第 ${Math.min(p.dayNo, p.totalDays)}/${p.totalDays} 天` : x.asNeeded ? '' : '長期'].filter(Boolean).join('・')}
                        </div>
                        {x.purpose && <div className="small soft">{x.purpose}</div>}
                        {x.cautions && (
                          <div className="caution">
                            <Icon.alert />
                            {x.cautions}
                          </div>
                        )}
                        <div className="actions">
                          <button className="btn secondary sm" onClick={() => void stopMed(x.id, x.name, x.mustFinish)}>
                            停藥
                          </button>
                          {x.visitId && (
                            <Link className="btn ghost sm" to={`/visits/${x.visitId}`}>
                              看診紀錄
                              <Icon.chevronRight />
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div>
            <div className="section-title">
              <h2>病歷時間軸</h2>
              {d.visits.length > 0 && <span className="aside">最近看診：{dayLabel(d.visits[0].visitDate)}</span>}
            </div>
            {tl.data ? (
              <Timeline items={tl.data} showWho={false} empty={`${m.name}這一年還沒有紀錄。`} />
            ) : (
              <div className="skel" style={{ height: 160, borderRadius: 18 }} />
            )}
          </div>

          {me.role === 'admin' && (
            <button
              className="btn danger sm"
              style={{ justifySelf: 'start' }}
              onClick={async () => {
                if (!(await confirmDialog({ title: `把 ${m.name} 從家人清單移除？`, message: '紀錄會保留，之後可以請管理者恢復。', confirmText: '移除', danger: true }))) return;
                await api.post(`/members/${m.id}/active`, { active: false });
                reloadMembers();
                nav('/family');
              }}
            >
              <Icon.trash />
              移除這位家人
            </button>
          )}
        </div>
      </div>

      {panel === 'edit' && (
        <MemberForm
          member={m}
          onClose={() => setPanel(null)}
          onSaved={() => {
            setPanel(null);
            toast('已儲存');
            reloadMembers();
            detail.reload();
          }}
        />
      )}
      {panel === 'measure' && <MeasurePanel memberId={m.id} onClose={() => setPanel(null)} />}
    </div>
  );
}
