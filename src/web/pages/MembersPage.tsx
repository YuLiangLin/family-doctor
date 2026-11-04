import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Measurement, Member, MemberDetail, TimelineItem } from '../../shared/apiTypes';
import { addDays, taipeiToday } from '../../shared/dates';
import { courseProgress, isActive, scheduleLabel } from '../../shared/meds';
import { api } from '../api';
import { MeasurePanel, NotePanel } from '../components/QuickAdd';
import { ErrorBox, Loading, Panel } from '../components/ui';
import { dayLabel } from '../format';
import { useAction, useApi, useSession } from '../hooks';
import { Timeline } from './TimelinePage';

const COLORS = ['#1f5fbf', '#c0507a', '#2f8a63', '#b97d0c', '#7a4fc2', '#cc3f25'];
const EMOJIS = ['🙂', '👨', '👩', '👧', '👦', '👶', '👵', '👴', '🐣', '🌷', '⭐', '🐻'];

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

export function MembersPage() {
  const { members, reloadMembers } = useSession();
  const [adding, setAdding] = useState(false);
  return (
    <div className="stack">
      <header className="topbar">
        <div className="title">
          <h1>家人</h1>
        </div>
        <button className="btn small" onClick={() => setAdding(true)}>
          新增家人
        </button>
      </header>
      {members.length === 0 ? (
        <div className="sheet">
          <div className="empty">先把家人加進來：你、太太、兩個小朋友。小朋友不用帳號，爸媽幫忙記。</div>
        </div>
      ) : (
        <div className="sheet ruled">
          {members.map((m) => (
            <Link key={m.id} to={`/family/${m.id}`} className="member-card" style={{ ['--c' as string]: m.color }}>
              <span className="face" aria-hidden>
                {m.emoji}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <h3>{m.name}</h3>
                <span className="small muted">
                  {[m.relation, ageOf(m.birthDate)].filter(Boolean).join('，')}
                  {m.allergies && m.allergies !== '無' && `・過敏：${m.allergies}`}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
      {adding && (
        <MemberForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reloadMembers();
          }}
        />
      )}
    </div>
  );
}

function MemberForm({ member, onClose, onSaved }: { member?: Member; onClose: () => void; onSaved: () => void }) {
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
          if (ok) onSaved();
        }}
      >
        <div className="grid2">
          <label className="field">
            <span>稱呼</span>
            <input value={f.name} onChange={set('name')} required placeholder="例：蓉蓉" />
          </label>
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
        </div>
        <label className="field">
          <span>過敏（藥物、食物）</span>
          <input value={f.allergies} onChange={set('allergies')} placeholder="沒有就寫「無」，Dr.Claude 每次都會看" />
        </label>
        <label className="field">
          <span>重要病史、慢性病</span>
          <textarea value={f.conditions} onChange={set('conditions')} placeholder="例：約三年前肺炎鏈球菌感染住院" />
        </label>
        <div className="grid2">
          <label className="field">
            <span>血型</span>
            <input value={f.bloodType} onChange={set('bloodType')} />
          </label>
          <label className="field">
            <span>排序</span>
            <input type="number" min={0} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} />
          </label>
        </div>
        <div className="field">
          <span>代表色</span>
          <div className="boxes">
            {COLORS.map((c) => (
              <label key={c} className="box" style={{ padding: 0, width: 40, justifyContent: 'center' }} aria-label={c}>
                <input type="radio" name="color" checked={f.color === c} onChange={() => setF({ ...f, color: c })} />
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: c, display: 'block' }} />
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <span>圖示</span>
          <div className="boxes">
            {EMOJIS.map((e) => (
              <label key={e} className="box" style={{ padding: 0, width: 40, justifyContent: 'center' }}>
                <input type="radio" name="emoji" checked={f.emoji === e} onChange={() => setF({ ...f, emoji: e })} />
                {e}
              </label>
            ))}
          </div>
        </div>
        <label className="field">
          <span>備註</span>
          <textarea value={f.note} onChange={set('note')} />
        </label>
        <ErrorBox error={act.error} />
        <button className="btn block" disabled={act.busy}>
          儲存
        </button>
      </form>
    </Panel>
  );
}

/** 體溫小圖（最近 7 天） */
function TempChart({ points }: { points: Measurement[] }) {
  const pts = points.filter((p) => p.kind === 'temperature' && p.measuredAt >= addDays(taipeiToday(), -7)).reverse();
  if (pts.length < 2) return null;
  const W = 320;
  const H = 120;
  const min = Math.min(36, ...pts.map((p) => p.value));
  const max = Math.max(39, ...pts.map((p) => p.value));
  const x = (i: number) => 16 + (i / (pts.length - 1)) * (W - 32);
  const y = (v: number) => H - 16 - ((v - min) / (max - min)) * (H - 32);
  return (
    <svg className="mini-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`最近體溫：${pts.map((p) => p.value).join('、')}`}>
      <line className="fever" x1={0} x2={W} y1={y(38)} y2={y(38)} />
      <text x={W - 4} y={y(38) - 4} textAnchor="end">
        38°C
      </text>
      <polyline className="line" points={pts.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
      {pts.map((p, i) => (
        <circle key={p.id} cx={x(i)} cy={y(p.value)} r={3.5} />
      ))}
    </svg>
  );
}

export function MemberPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const { me, reloadMembers } = useSession();
  const detail = useApi<MemberDetail>(`/members/${id}`);
  const tl = useApi<TimelineItem[]>(`/timeline?memberId=${id}&days=365`);
  const [panel, setPanel] = useState<'edit' | 'note' | 'measure' | null>(null);
  const d = detail.data;
  if (!d) return detail.error ? <ErrorBox error={detail.error} /> : <Loading />;
  const m = d.member;
  const today = taipeiToday();
  const current = d.medications.filter((x) => isActive(x, today));
  const reload = () => {
    detail.reload();
    tl.reload();
  };
  return (
    <div className="stack">
      <header className="topbar">
        <button className="back" onClick={() => nav('/family')}>
          ‹ 家人
        </button>
        <div className="title" />
        <button className="btn quiet small" onClick={() => setPanel('edit')}>
          編輯
        </button>
      </header>
      <div className="member-card" style={{ ['--c' as string]: m.color }}>
        <span className="face" aria-hidden>
          {m.emoji}
        </span>
        <div>
          <h1>{m.name}</h1>
          <div className="muted small">{[m.relation, ageOf(m.birthDate), m.bloodType && `${m.bloodType} 型`].filter(Boolean).join('，')}</div>
        </div>
      </div>
      <dl className="kv sheet sheet-body" style={{ margin: 0 }}>
        <dt>過敏</dt>
        <dd>{m.allergies || <span className="muted">沒填</span>}</dd>
        <dt>病史</dt>
        <dd>{m.conditions || <span className="muted">沒填</span>}</dd>
        {m.note && (
          <>
            <dt>備註</dt>
            <dd>{m.note}</dd>
          </>
        )}
      </dl>
      <div className="row">
        <button className="btn quiet small" onClick={() => setPanel('note')}>
          記身體狀況
        </button>
        <button className="btn quiet small" onClick={() => setPanel('measure')}>
          記量測
        </button>
        <Link className="btn quiet small" to={`/visits/new?memberId=${m.id}`}>
          記看診
        </Link>
        <Link className="btn quiet small" to={`/doctor?memberId=${m.id}`}>
          問 Dr.Claude
        </Link>
      </div>

      <TempChart points={d.measurements} />

      <section className="sheet">
        <div className="sheet-head">
          <h2>正在吃的藥</h2>
        </div>
        {current.length === 0 ? (
          <div className="empty">目前沒有</div>
        ) : (
          <div className="ruled">
            {current.map((x) => {
              const p = courseProgress(x, d.doseLogs, today);
              return (
                <div key={x.id}>
                  <div className="spread">
                    <strong>{x.name}</strong>
                    {x.category && <span className="pill-tag">{x.category}</span>}
                  </div>
                  <div className="small muted">
                    {x.dose}・{scheduleLabel(x.slots, x.timing, x.asNeeded)}
                    {p.totalDays && `・第 ${Math.min(p.dayNo, p.totalDays)}/${p.totalDays} 天`}
                  </div>
                  {x.purpose && <div className="small">{x.purpose}</div>}
                  {x.cautions && <div className="small" style={{ color: 'var(--warn)' }}>注意：{x.cautions}</div>}
                  <div className="row" style={{ marginTop: 6 }}>
                    <button
                      className="btn quiet small"
                      onClick={async () => {
                        const reason = prompt(x.mustFinish ? '這個藥醫生交代要吃完。停藥原因（例：醫生說可以停）' : '停藥原因（選填）', '');
                        if (reason === null) return;
                        try {
                          await api.post(`/medications/${x.id}/stop`, { reason });
                          reload();
                        } catch (e) {
                          alert(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      停藥
                    </button>
                    {x.visitId && (
                      <Link className="btn quiet small" to={`/visits/${x.visitId}`}>
                        看診紀錄
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ margin: '8px 0' }}>病歷時間軸</h2>
        {tl.data ? <Timeline items={tl.data} onChanged={reload} showWho={false} /> : <Loading />}
      </section>
      {d.visits.length > 0 && (
        <p className="small muted">
          最近一次看診：{dayLabel(d.visits[0].visitDate)} {d.visits[0].clinic}
        </p>
      )}
      {me.role === 'admin' && (
        <button
          className="btn danger small"
          style={{ justifySelf: 'start' }}
          onClick={async () => {
            if (!confirm(`把 ${m.name} 從家人清單移除？紀錄會保留。`)) return;
            await api.post(`/members/${m.id}/active`, { active: false });
            reloadMembers();
            nav('/family');
          }}
        >
          移除這位家人
        </button>
      )}

      {panel === 'edit' && (
        <MemberForm
          member={m}
          onClose={() => setPanel(null)}
          onSaved={() => {
            setPanel(null);
            reloadMembers();
            detail.reload();
          }}
        />
      )}
      {panel === 'note' && <NotePanel memberId={m.id} onClose={() => setPanel(null)} onSaved={() => (setPanel(null), reload())} />}
      {panel === 'measure' && <MeasurePanel memberId={m.id} onClose={() => setPanel(null)} onSaved={() => (setPanel(null), reload())} />}
    </div>
  );
}
