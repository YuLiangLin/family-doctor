import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MEASUREMENT_INFO, type Measurement, type TimelineItem } from '../../shared/apiTypes';
import { taipeiToday } from '../../shared/dates';
import { api } from '../api';
import { MeasurePanel, NotePanel } from '../components/QuickAdd';
import { ErrorBox, Loading, MemberPicker, Who } from '../components/ui';
import { dayLabel, hhmm } from '../format';
import { useApi, useSession } from '../hooks';

export function measurementText(m: Measurement): string {
  const info = MEASUREMENT_INFO[m.kind];
  return `${info.label} ${m.value}${m.value2 !== null ? `/${m.value2}` : ''} ${info.unit}`;
}

const SEVERITY_LABEL = ['', '輕微', '有點不舒服', '很不舒服'];

export function Timeline({ items, onChanged, showWho = true }: { items: TimelineItem[]; onChanged?: () => void; showWho?: boolean }) {
  const { members } = useSession();
  const today = taipeiToday();
  if (items.length === 0) return <div className="empty">這段時間還沒有紀錄。</div>;
  let lastDay = '';
  return (
    <div className="timeline">
      {items.map((it) => {
        const day = it.at.slice(0, 10);
        const head = day !== lastDay ? <div className="tl-day">{dayLabel(day, today)}</div> : null;
        lastDay = day;
        const member = members.find((m) => m.id === it.memberId);
        const key = `${it.type}-${it.type === 'visit' ? it.visit.id : it.type === 'note' ? it.note.id : it.measurement.id}`;
        return (
          <div key={key}>
            {head}
            <div className="tl-item" style={{ ['--c' as string]: member?.color }}>
              {it.type === 'visit' ? (
                <Link to={`/visits/${it.visit.id}`} className="tl-card">
                  <div className="spread">
                    {showWho ? <Who member={member} size="sm" /> : <span />}
                    <span className="pill-tag">看診</span>
                  </div>
                  <div>
                    <strong>{it.visit.clinic || '看診'}</strong> {it.visit.department}
                  </div>
                  {it.visit.reason && <div className="small">{it.visit.reason}</div>}
                  {it.medCount > 0 && <div className="small muted">開了 {it.medCount} 種藥</div>}
                </Link>
              ) : it.type === 'note' ? (
                <div className="tl-card">
                  <div className="spread">
                    {showWho ? <Who member={member} size="sm" /> : <span />}
                    <span className="when num">{hhmm(it.note.notedAt)}</span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{it.note.body}</div>
                  <div className="row" style={{ marginTop: 4 }}>
                    {it.note.severity > 0 && <span className={`sev sev-${it.note.severity}`}>{SEVERITY_LABEL[it.note.severity]}</span>}
                    {it.note.source === 'dr_claude' && <span className="by-ai">🦦 Dr.Claude 記的</span>}
                    {onChanged && (
                      <button
                        className="btn quiet small"
                        style={{ marginLeft: 'auto', minHeight: 28 }}
                        onClick={async () => {
                          if (!confirm('刪除這筆身體狀況？')) return;
                          await api.post(`/notes/${it.note.id}/void`, { reason: '刪除' });
                          onChanged();
                        }}
                      >
                        刪除
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="tl-card">
                  <div className="spread">
                    {showWho ? <Who member={member} size="sm" /> : <span />}
                    <span className="when num">{hhmm(it.measurement.measuredAt)}</span>
                  </div>
                  <div className="num">
                    <strong style={it.measurement.kind === 'temperature' && it.measurement.value >= 38 ? { color: 'var(--alert)' } : undefined}>
                      {measurementText(it.measurement)}
                    </strong>
                    {it.measurement.note && <span className="muted small">（{it.measurement.note}）</span>}
                  </div>
                  {it.measurement.source === 'dr_claude' && <span className="by-ai">🦦 Dr.Claude 記的</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TimelinePage() {
  const { members } = useSession();
  const [params, setParams] = useSearchParams();
  const memberId = params.get('memberId') ? Number(params.get('memberId')) : null;
  const days = Number(params.get('days') ?? 90);
  const tl = useApi<TimelineItem[]>(`/timeline?days=${days}${memberId ? `&memberId=${memberId}` : ''}`);
  const [panel, setPanel] = useState<'note' | 'measure' | null>(null);
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v === null) p.delete(k);
    else p.set(k, v);
    setParams(p, { replace: true });
  };
  return (
    <div className="stack">
      <header className="topbar">
        <div className="title">
          <h1>紀錄</h1>
        </div>
      </header>
      <MemberPicker members={members} value={memberId} onChange={(v) => set('memberId', v === null ? null : String(v))} allowAll />
      <div className="row">
        <button className="btn quiet small" onClick={() => setPanel('note')}>
          記身體狀況
        </button>
        <button className="btn quiet small" onClick={() => setPanel('measure')}>
          記量測
        </button>
        <select className="input" style={{ width: 'auto', minHeight: 34, marginLeft: 'auto' }} value={days} onChange={(e) => set('days', e.target.value)} aria-label="期間">
          <option value={30}>近 30 天</option>
          <option value={90}>近 3 個月</option>
          <option value={365}>近一年</option>
          <option value={3650}>全部</option>
        </select>
      </div>
      <ErrorBox error={tl.error} />
      {tl.data ? <Timeline items={tl.data} onChanged={tl.reload} showWho={memberId === null} /> : <Loading />}
      {panel === 'note' && <NotePanel memberId={memberId} onClose={() => setPanel(null)} onSaved={() => (setPanel(null), tl.reload())} />}
      {panel === 'measure' && <MeasurePanel memberId={memberId} onClose={() => setPanel(null)} onSaved={() => (setPanel(null), tl.reload())} />}
    </div>
  );
}
