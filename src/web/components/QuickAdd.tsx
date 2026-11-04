import { useState } from 'react';
import { MEASUREMENT_INFO, type MeasurementKind } from '../../shared/apiTypes';
import { api } from '../api';
import { fromLocalInput, nowMinute, toLocalInput } from '../format';
import { useAction, useSession } from '../hooks';
import { ErrorBox, MemberPicker, Panel } from './ui';

const SEVERITY = [
  { v: 0, label: '不填' },
  { v: 1, label: '輕微' },
  { v: 2, label: '有點不舒服' },
  { v: 3, label: '很不舒服' },
];

function useDefaultMember(initial?: number | null) {
  const { me, members } = useSession();
  return useState<number | null>(initial ?? me.memberId ?? members[0]?.id ?? null);
}

export function NotePanel({ memberId, onClose, onSaved }: { memberId?: number | null; onClose: () => void; onSaved: () => void }) {
  const { members } = useSession();
  const [who, setWho] = useDefaultMember(memberId);
  const [at, setAt] = useState(nowMinute());
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState(0);
  const act = useAction();
  return (
    <Panel title="記身體狀況" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!who) return;
          const ok = await act.run(() => api.post('/notes', { memberId: who, notedAt: at, body, severity }));
          if (ok) onSaved();
        }}
      >
        <MemberPicker members={members} value={who} onChange={(v) => setWho(v)} />
        <label className="field">
          <span>怎麼了</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="例：擤出黃灰色鼻涕，左邊有一點血；中午又昏睡" required />
        </label>
        <div className="field">
          <span>不舒服的程度</span>
          <div className="boxes">
            {SEVERITY.map((s) => (
              <label key={s.v} className="box">
                <input type="radio" name="sev" checked={severity === s.v} onChange={() => setSeverity(s.v)} />
                {s.label}
              </label>
            ))}
          </div>
        </div>
        <label className="field">
          <span>時間</span>
          <input type="datetime-local" value={toLocalInput(at)} onChange={(e) => setAt(fromLocalInput(e.target.value))} required />
        </label>
        <ErrorBox error={act.error} />
        <button className="btn block" disabled={act.busy || !who || !body.trim()}>
          記下來
        </button>
      </form>
    </Panel>
  );
}

const KIND_ORDER: MeasurementKind[] = ['temperature', 'weight', 'height', 'heart_rate', 'blood_pressure', 'spo2'];

export function MeasurePanel({
  memberId,
  kind: initialKind = 'temperature',
  onClose,
  onSaved,
}: {
  memberId?: number | null;
  kind?: MeasurementKind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { members } = useSession();
  const [who, setWho] = useDefaultMember(memberId);
  const [kind, setKind] = useState<MeasurementKind>(initialKind);
  const [value, setValue] = useState('');
  const [value2, setValue2] = useState('');
  const [at, setAt] = useState(nowMinute());
  const [note, setNote] = useState('');
  const act = useAction();
  const info = MEASUREMENT_INFO[kind];
  const bp = kind === 'blood_pressure';
  return (
    <Panel title="記量測" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!who) return;
          const ok = await act.run(() =>
            api.post('/measurements', { memberId: who, kind, value: Number(value), value2: bp ? Number(value2) : null, measuredAt: at, note }),
          );
          if (ok) onSaved();
        }}
      >
        <MemberPicker members={members} value={who} onChange={(v) => setWho(v)} />
        <div className="boxes">
          {KIND_ORDER.map((k) => (
            <label key={k} className="box">
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
              {MEASUREMENT_INFO[k].label}
            </label>
          ))}
        </div>
        <div className={bp ? 'grid2' : undefined}>
          <label className="field">
            <span>
              {bp ? '收縮壓（上）' : info.label}（{info.unit}）
            </span>
            <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === 'temperature' ? '37.5' : ''} required />
          </label>
          {bp && (
            <label className="field">
              <span>舒張壓（下）</span>
              <input inputMode="decimal" value={value2} onChange={(e) => setValue2(e.target.value)} required />
            </label>
          )}
        </div>
        <label className="field">
          <span>時間</span>
          <input type="datetime-local" value={toLocalInput(at)} onChange={(e) => setAt(fromLocalInput(e.target.value))} required />
        </label>
        <label className="field">
          <span>備註（選填）</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：耳溫、吃退燒藥後一小時" />
        </label>
        <ErrorBox error={act.error} />
        <button className="btn block" disabled={act.busy || !who || !value}>
          記下來
        </button>
      </form>
    </Panel>
  );
}
