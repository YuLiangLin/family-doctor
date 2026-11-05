import { useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { MEASUREMENT_INFO, type MeasurementKind } from '../../shared/apiTypes';
import { api } from '../api';
import { fromLocalInput, nowMinute, toLocalInput } from '../format';
import { emitDataChanged, useAction, useSession, type QuickKind } from '../hooks';
import { ErrorBox, Icon, MemberPicker, OtterFace, Panel, toast } from './ui';

const SEVERITY = [
  { v: 0, label: '不填', c: 'var(--text-3)' },
  { v: 1, label: '輕微', c: 'var(--green)' },
  { v: 2, label: '有點不舒服', c: 'var(--amber)' },
  { v: 3, label: '很不舒服', c: 'var(--red)' },
];

export const MEASURE_ICON: Record<MeasurementKind, () => ReactNode> = {
  temperature: Icon.thermometer,
  weight: Icon.scale,
  height: Icon.ruler,
  heart_rate: Icon.heartPulse,
  blood_pressure: Icon.gauge,
  spo2: Icon.droplet,
};

const tint = (bg: string, ink: string) => ({ ['--tint' as string]: bg, ['--tint-ink' as string]: ink }) as CSSProperties;

function useDefaultMember(initial?: number | null) {
  const { me, members } = useSession();
  return useState<number | null>(initial ?? me.memberId ?? members[0]?.id ?? null);
}

/** 「新增」：拍藥袋、記身體狀況、量體溫、其他量測、問 Dr.Claude */
export function AddMenu({ onClose, onPick, memberId }: { onClose: () => void; onPick: (k: QuickKind) => void; memberId?: number | null }) {
  const nav = useNavigate();
  const go = (to: string) => {
    onClose();
    nav(to);
  };
  return (
    <Panel title="新增紀錄" onClose={onClose}>
      <div className="add-grid">
        <button type="button" className="add-tile feature" onClick={() => go(memberId ? `/visits/new?memberId=${memberId}` : '/visits/new')}>
          <span className="ic">
            <Icon.camera />
          </span>
          <span className="txt">
            <strong>看完醫生：拍藥袋</strong>
            <small>Dr.Claude 讀藥袋，幫你排好吃藥時間</small>
          </span>
        </button>
        <button type="button" className="add-tile" style={tint('var(--amber-soft)', 'var(--amber)')} onClick={() => onPick('note')}>
          <span className="ic">
            <Icon.note />
          </span>
          <span className="txt">
            <strong>身體狀況</strong>
            <small>咳嗽、流鼻水、睡不好…</small>
          </span>
        </button>
        <button type="button" className="add-tile" style={tint('var(--red-soft)', 'var(--red)')} onClick={() => onPick('temperature')}>
          <span className="ic">
            <Icon.thermometer />
          </span>
          <span className="txt">
            <strong>量體溫</strong>
            <small>發燒時每次量都記一下</small>
          </span>
        </button>
        <button type="button" className="add-tile" style={tint('var(--green-soft)', 'var(--green)')} onClick={() => onPick('measure')}>
          <span className="ic">
            <Icon.scale />
          </span>
          <span className="txt">
            <strong>其他量測</strong>
            <small>體重、身高、血壓、血氧</small>
          </span>
        </button>
        <button type="button" className="add-tile" style={tint('var(--otter-soft)', 'var(--otter)')} onClick={() => go(memberId ? `/doctor?memberId=${memberId}` : '/doctor')}>
          <span className="ic" style={{ background: 'var(--otter)' }}>
            <OtterFace size={30} />
          </span>
          <span className="txt">
            <strong>用說的</strong>
            <small>跟 Dr.Claude 說，他幫你記</small>
          </span>
        </button>
      </div>
    </Panel>
  );
}

function WhenField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>時間</span>
      <input type="datetime-local" value={toLocalInput(value)} onChange={(e) => onChange(fromLocalInput(e.target.value))} required />
    </label>
  );
}

export function NotePanel({ memberId, onClose, onSaved }: { memberId?: number | null; onClose: () => void; onSaved?: () => void }) {
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
          if (!ok) return;
          toast(`已記下${members.find((m) => m.id === who)?.name ?? ''}的身體狀況`);
          emitDataChanged();
          onSaved?.();
          onClose();
        }}
      >
        <MemberPicker members={members} value={who} onChange={(v) => setWho(v)} />
        <label className="field">
          <span>怎麼了</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="例：擤出黃灰色鼻涕，左邊有一點血；中午又昏睡" required />
        </label>
        <div className="field">
          <span>不舒服的程度</span>
          <div className="choices">
            {SEVERITY.map((s) => (
              <label key={s.v} className="choice">
                <input type="radio" name="sev" checked={severity === s.v} onChange={() => setSeverity(s.v)} />
                {s.v > 0 && <span className="dot" style={{ ['--c' as string]: s.c } as CSSProperties} />}
                {s.label}
              </label>
            ))}
          </div>
        </div>
        <WhenField value={at} onChange={setAt} />
        <ErrorBox error={act.error} />
        <button className="btn lg block" disabled={act.busy || !who || !body.trim()}>
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
  onSaved?: () => void;
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
  const fever = kind === 'temperature' && Number(value) >= 38;
  return (
    <Panel title={initialKind === 'temperature' && kind === 'temperature' ? '量體溫' : '記量測'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!who) return;
          const ok = await act.run(() =>
            api.post('/measurements', { memberId: who, kind, value: Number(value), value2: bp ? Number(value2) : null, measuredAt: at, note }),
          );
          if (!ok) return;
          const name = members.find((m) => m.id === who)?.name ?? '';
          toast(`已記下${name} ${info.label} ${value}${bp ? `/${value2}` : ''} ${info.unit}`);
          emitDataChanged();
          onSaved?.();
          onClose();
        }}
      >
        <MemberPicker members={members} value={who} onChange={(v) => setWho(v)} />
        <div className="choices" role="radiogroup" aria-label="量什麼">
          {KIND_ORDER.map((k) => {
            const I = MEASURE_ICON[k];
            return (
              <label key={k} className="choice">
                <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
                <span className="ic18">
                  <I />
                </span>
                {MEASUREMENT_INFO[k].label}
              </label>
            );
          })}
        </div>
        <div className={bp ? 'form-grid' : undefined}>
          <label className="field">
            <span>
              {bp ? '收縮壓（上）' : info.label}（{info.unit}）
            </span>
            <input
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === 'temperature' ? '37.5' : ''}
              required
              style={{ fontSize: '1.375rem', fontWeight: 700, minHeight: 56, color: fever ? 'var(--red)' : undefined }}
            />
          </label>
          {bp && (
            <label className="field">
              <span>舒張壓（下）</span>
              <input inputMode="decimal" value={value2} onChange={(e) => setValue2(e.target.value)} required style={{ fontSize: '1.375rem', fontWeight: 700, minHeight: 56 }} />
            </label>
          )}
        </div>
        {fever && (
          <div className="alert error" style={{ marginTop: -4 }}>
            <Icon.thermometer />
            <div>38 度以上算發燒。精神很差、呼吸喘、抽搐，或三個月以下的寶寶發燒，請直接就醫。</div>
          </div>
        )}
        <WhenField value={at} onChange={setAt} />
        <label className="field">
          <span>備註（選填）</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：耳溫、吃退燒藥後一小時" />
        </label>
        <ErrorBox error={act.error} />
        <button className="btn lg block" disabled={act.busy || !who || !value}>
          記下來
        </button>
      </form>
    </Panel>
  );
}
