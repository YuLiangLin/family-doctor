import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { AiJob, Attachment, MedicationDraft, RunnerState, VisitDetail, VisitDraft } from '../../shared/apiTypes';
import { taipeiToday } from '../../shared/dates';
import { scheduleLabel, SLOT_INFO, SLOTS, TIMING_LABEL, type Slot, type Timing } from '../../shared/meds';
import { api } from '../api';
import { AttachmentImage, ErrorBox, Icon, Loading, MemberPicker, OtterFace, Who } from '../components/ui';
import { dayLabel } from '../format';
import { useAction, useApi, useSession } from '../hooks';
import { uploadPhoto } from '../imageTools';

/** 從 Dr.Claude 對話帶過來的草稿 */
export interface DraftState {
  draft: VisitDraft;
  memberId: number;
  fromMessage?: { messageId: number; actionIndex: number };
  attachmentIds?: number[];
}

const blankMed = (): MedicationDraft => ({
  name: '',
  genericName: '',
  category: '',
  purpose: '',
  appearance: '',
  dose: '1 顆',
  slots: ['morning', 'noon', 'evening'],
  timing: 'after',
  asNeeded: false,
  days: 3,
  mustFinish: false,
  cautions: '',
});

const blankVisit = (): VisitDraft => ({
  visitDate: taipeiToday(),
  clinic: '',
  department: '',
  doctor: '',
  reason: '',
  diagnosis: '',
  advice: '',
  followUpDate: null,
  copay: null,
  medications: [],
  uncertain: [],
});

export function VisitPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const { members } = useSession();
  const v = useApi<VisitDetail>(`/visits/${id}`);
  const act = useAction();
  const d = v.data;
  if (!d) return v.error ? <ErrorBox error={v.error} /> : <Loading />;
  return (
    <div className="stack">
      <header className="topbar">
        <button className="back" onClick={() => nav(-1)}>
          ‹ 返回
        </button>
        <div className="title" />
        <Link className="btn quiet small" to={`/visits/${id}/edit`}>
          編輯
        </Link>
      </header>
      <section className="sheet">
        <div className="sheet-head">
          <h2>{d.clinic || '看診'}</h2>
          <span className="meta">{dayLabel(d.visitDate)}</span>
        </div>
        <div className="sheet-body stack" style={{ gap: 10 }}>
          <Who member={members.find((m) => m.id === d.memberId)} />
          <dl className="kv" style={{ margin: 0 }}>
            {d.department && (
              <>
                <dt>科別</dt>
                <dd>{d.department}</dd>
              </>
            )}
            {d.doctor && (
              <>
                <dt>醫師</dt>
                <dd>{d.doctor}</dd>
              </>
            )}
            {d.reason && (
              <>
                <dt>症狀</dt>
                <dd>{d.reason}</dd>
              </>
            )}
            {d.diagnosis && (
              <>
                <dt>醫師說</dt>
                <dd>{d.diagnosis}</dd>
              </>
            )}
            {d.advice && (
              <>
                <dt>醫囑</dt>
                <dd>{d.advice}</dd>
              </>
            )}
            {d.followUpDate && (
              <>
                <dt>回診</dt>
                <dd>{dayLabel(d.followUpDate)}</dd>
              </>
            )}
            {d.copay !== null && (
              <>
                <dt>自付</dt>
                <dd className="num">{d.copay} 元</dd>
              </>
            )}
            {d.note && (
              <>
                <dt>備註</dt>
                <dd>{d.note}</dd>
              </>
            )}
          </dl>
        </div>
      </section>
      <section className="sheet">
        <div className="sheet-head">
          <h2>開的藥</h2>
          <span className="meta">{d.medications.length} 種</span>
        </div>
        {d.medications.length === 0 ? (
          <div className="empty">沒有記藥</div>
        ) : (
          <div className="ruled">
            {d.medications.map((m) => (
              <div key={m.id}>
                <div className="spread">
                  <strong>{m.name}</strong>
                  {m.category && <span className="pill-tag">{m.category}</span>}
                </div>
                {m.genericName && <div className="small muted">{m.genericName}</div>}
                <div className="small">
                  {m.dose}・{scheduleLabel(m.slots, m.timing, m.asNeeded)}
                  {m.days ? `・${m.days} 天` : '・長期'}
                  {m.mustFinish && '・要吃完'}
                </div>
                {m.purpose && <div className="small">{m.purpose}</div>}
                {m.cautions && <div className="small" style={{ color: 'var(--warn)' }}>注意：{m.cautions}</div>}
                {m.stoppedAt && <div className="small muted">{m.stoppedAt} 停藥{m.stopReason && `（${m.stopReason}）`}</div>}
              </div>
            ))}
          </div>
        )}
      </section>
      {d.attachments.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <h2>藥袋與照片</h2>
          <div className="photo-grid">
            {d.attachments.map((a) => (
              <AttachmentImage key={a.id} id={a.id} alt={a.filename} contentType={a.contentType} />
            ))}
          </div>
        </section>
      )}
      <ErrorBox error={act.error} />
      <button
        className="btn danger small"
        style={{ justifySelf: 'start' }}
        disabled={act.busy}
        onClick={async () => {
          const reason = prompt('刪除這次看診（連開的藥一起）。原因：', '記錯了');
          if (!reason) return;
          const ok = await act.run(() => api.post(`/visits/${id}/void`, { reason }));
          if (ok) nav('/log');
        }}
      >
        刪除這次看診
      </button>
    </div>
  );
}

export function VisitEditPage() {
  const params = useParams();
  const editId = params.id ? Number(params.id) : null;
  const [search] = useSearchParams();
  const location = useLocation();
  const fromChat = (location.state as DraftState | null) ?? null;
  const nav = useNavigate();
  const { me, members } = useSession();
  const [memberId, setMemberId] = useState<number | null>(
    fromChat?.memberId ?? (search.get('memberId') ? Number(search.get('memberId')) : (me.memberId ?? members[0]?.id ?? null)),
  );
  const [v, setV] = useState<VisitDraft>(fromChat?.draft ?? blankVisit());
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [attachIds] = useState<number[]>(fromChat?.attachmentIds ?? []);
  const existing = useApi<VisitDetail>(editId ? `/visits/${editId}` : null);
  const act = useAction();

  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    setMemberId(d.memberId);
    setV({ ...d, medications: [], uncertain: [] });
  }, [existing.data]);

  if (members.length === 0) {
    return (
      <div className="stack">
        <h1>記看診</h1>
        <div className="sheet empty">
          先到「家人」頁把家人加進來，才能記看診。<br />
          <Link to="/family">去新增家人</Link>
        </div>
      </div>
    );
  }

  const set = <K extends keyof VisitDraft>(k: K, val: VisitDraft[K]) => setV((x) => ({ ...x, [k]: val }));

  const save = async () => {
    if (!memberId) return;
    const base = {
      memberId,
      visitDate: v.visitDate,
      clinic: v.clinic,
      department: v.department,
      doctor: v.doctor,
      reason: v.reason,
      diagnosis: v.diagnosis,
      advice: v.advice,
      followUpDate: v.followUpDate || null,
      copay: v.copay,
      note: (v as VisitDraft & { note?: string }).note ?? '',
    };
    if (editId) {
      const ok = await act.run(() => api.put(`/visits/${editId}`, base));
      if (ok) nav(`/visits/${editId}`, { replace: true });
      return;
    }
    const res = await act.run(() =>
      api.post<{ id: number }>('/visits', {
        ...base,
        medications: v.medications.filter((m) => m.name.trim()),
        attachmentIds: [...new Set([...attachIds, ...photos.map((p) => p.id)])],
        fromMessage: fromChat?.fromMessage,
      }),
    );
    if (res) nav(`/visits/${res.id}`, { replace: true });
  };

  return (
    <div className="stack">
      <header className="topbar">
        <button className="back" onClick={() => nav(-1)}>
          ‹ 返回
        </button>
        <div className="title">
          <h1>{editId ? '編輯看診' : '記看診'}</h1>
        </div>
      </header>

      {!editId && (
        <Scanner
          memberId={memberId}
          photos={photos}
          setPhotos={setPhotos}
          onDraft={(draft) => {
            setV((cur) => ({ ...cur, ...draft, medications: draft.medications.length ? draft.medications : cur.medications }));
          }}
        />
      )}

      {fromChat && <div className="notice">這是 Dr.Claude 整理的草稿，請核對藥名、時段和天數再儲存。</div>}
      {v.uncertain.length > 0 && (
        <div className="notice">
          Dr.Claude 不太確定的地方：
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {v.uncertain.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <MemberPicker members={members} value={memberId} onChange={(id) => setMemberId(id)} />
        <div className="grid2">
          <label className="field">
            <span>看診日</span>
            <input type="date" value={v.visitDate} onChange={(e) => set('visitDate', e.target.value)} required />
          </label>
          <label className="field">
            <span>回診日（選填）</span>
            <input type="date" value={v.followUpDate ?? ''} onChange={(e) => set('followUpDate', e.target.value || null)} />
          </label>
          <label className="field">
            <span>診所／醫院</span>
            <input value={v.clinic} onChange={(e) => set('clinic', e.target.value)} placeholder="例：聖青診所" />
          </label>
          <label className="field">
            <span>科別</span>
            <input value={v.department} onChange={(e) => set('department', e.target.value)} placeholder="家醫科、小兒科…" />
          </label>
          <label className="field">
            <span>醫師</span>
            <input value={v.doctor} onChange={(e) => set('doctor', e.target.value)} />
          </label>
          <label className="field">
            <span>自付金額（元）</span>
            <input inputMode="numeric" value={v.copay ?? ''} onChange={(e) => set('copay', e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null)} />
          </label>
        </div>
        <label className="field">
          <span>為什麼去看（症狀）</span>
          <textarea value={v.reason} onChange={(e) => set('reason', e.target.value)} placeholder="例：黃鼻涕嚴重、鼻塞" />
        </label>
        <label className="field">
          <span>醫師怎麼說</span>
          <textarea value={v.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} placeholder="例：鼻竇炎，先吃三天抗生素" />
        </label>
        <label className="field">
          <span>醫囑</span>
          <textarea value={v.advice} onChange={(e) => set('advice', e.target.value)} placeholder="例：多喝水，三天沒改善回診" />
        </label>

        {!editId && (
          <section className="stack" style={{ gap: 10 }}>
            <div className="spread">
              <h2>開的藥</h2>
              <button type="button" className="btn quiet small" onClick={() => set('medications', [...v.medications, blankMed()])}>
                加一種藥
              </button>
            </div>
            {v.medications.length === 0 && <div className="muted small">拍藥袋讓 Dr.Claude 讀，或按「加一種藥」自己填。</div>}
            {v.medications.map((m, i) => (
              <MedEditor
                key={i}
                med={m}
                onChange={(next) => set('medications', v.medications.map((x, j) => (j === i ? next : x)))}
                onRemove={() => set('medications', v.medications.filter((_, j) => j !== i))}
              />
            ))}
          </section>
        )}
        {editId && <p className="small muted">藥的內容在家人頁或看診頁個別調整（停藥）。</p>}

        <ErrorBox error={act.error} />
        <button className="btn block" disabled={act.busy || !memberId}>
          {act.busy ? '儲存中…' : '儲存看診'}
        </button>
      </form>
    </div>
  );
}

function MedEditor({ med, onChange, onRemove }: { med: MedicationDraft; onChange: (m: MedicationDraft) => void; onRemove: () => void }) {
  const [more, setMore] = useState(!!(med.purpose || med.cautions || med.genericName));
  const set = <K extends keyof MedicationDraft>(k: K, val: MedicationDraft[K]) => onChange({ ...med, [k]: val });
  const toggleSlot = (s: Slot) => set('slots', med.slots.includes(s) ? med.slots.filter((x) => x !== s) : SLOTS.filter((x) => x === s || med.slots.includes(x)));
  return (
    <div className="sheet sheet-body stack" style={{ gap: 10 }}>
      <div className="grid2">
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span>藥名（照藥袋）</span>
          <input value={med.name} onChange={(e) => set('name', e.target.value)} placeholder="例：CEPHALEXIN 500MG" required />
        </label>
        <label className="field">
          <span>分類</span>
          <input value={med.category} onChange={(e) => set('category', e.target.value)} placeholder="抗生素、鼻塞藥…" />
        </label>
        <label className="field">
          <span>每次</span>
          <input value={med.dose} onChange={(e) => set('dose', e.target.value)} />
        </label>
      </div>
      <div className="field">
        <span>什麼時候吃</span>
        <div className="boxes">
          {SLOTS.map((s) => (
            <label key={s} className="box">
              <input type="checkbox" checked={med.slots.includes(s)} disabled={med.asNeeded} onChange={() => toggleSlot(s)} />
              {SLOT_INFO[s].label}
            </label>
          ))}
          <label className="box">
            <input type="checkbox" checked={med.asNeeded} onChange={(e) => set('asNeeded', e.target.checked)} />
            需要時
          </label>
        </div>
      </div>
      <div className="boxes">
        {(['before', 'after', 'with', 'any'] as Timing[]).map((t) => (
          <label key={t} className="box">
            <input type="radio" checked={med.timing === t} onChange={() => set('timing', t)} />
            {TIMING_LABEL[t] || '不限'}
          </label>
        ))}
      </div>
      <div className="grid2">
        <label className="field">
          <span>吃幾天（空白＝長期）</span>
          <input inputMode="numeric" value={med.days ?? ''} onChange={(e) => set('days', e.target.value ? Number(e.target.value.replace(/\D/g, '')) || null : null)} />
        </label>
        <label className="box" style={{ alignSelf: 'end' }}>
          <input type="checkbox" checked={med.mustFinish} onChange={(e) => set('mustFinish', e.target.checked)} />
          要吃完（抗生素）
        </label>
      </div>
      <div className="muted small">{scheduleLabel(med.slots, med.timing, med.asNeeded)}</div>
      {more ? (
        <>
          <label className="field">
            <span>成分</span>
            <input value={med.genericName} onChange={(e) => set('genericName', e.target.value)} />
          </label>
          <label className="field">
            <span>用途（白話）</span>
            <input value={med.purpose} onChange={(e) => set('purpose', e.target.value)} />
          </label>
          <label className="field">
            <span>外觀</span>
            <input value={med.appearance} onChange={(e) => set('appearance', e.target.value)} placeholder="例：綠白膠囊" />
          </label>
          <label className="field">
            <span>注意事項</span>
            <textarea value={med.cautions} onChange={(e) => set('cautions', e.target.value)} />
          </label>
        </>
      ) : (
        <button type="button" className="btn quiet small" style={{ justifySelf: 'start' }} onClick={() => setMore(true)}>
          更多欄位
        </button>
      )}
      <button type="button" className="btn danger small" style={{ justifySelf: 'start' }} onClick={onRemove}>
        移除這種藥
      </button>
    </div>
  );
}

/** 拍藥袋：上傳 → 排一件讀藥袋給家裡的 Dr.Claude → 等草稿回來填進表單 */
function Scanner({
  memberId,
  photos,
  setPhotos,
  onDraft,
}: {
  memberId: number | null;
  photos: Attachment[];
  setPhotos: (p: Attachment[]) => void;
  onDraft: (d: VisitDraft) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [job, setJob] = useState<AiJob | null>(null);
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const act = useAction();

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return;
    const t = window.setInterval(async () => {
      try {
        const r = await api.get<{ job: AiJob; runner: RunnerState }>(`/scan/${job.id}`);
        setJob(r.job);
        setRunner(r.runner);
        if (r.job.status === 'done' && r.job.result) onDraft(r.job.result);
      } catch {
        // 下次再試
      }
    }, 2500);
    return () => window.clearInterval(t);
  }, [job, onDraft]);

  const reading = job && (job.status === 'queued' || job.status === 'running');
  return (
    <section className="sheet">
      <div className="sheet-head">
        <h2>拍藥袋</h2>
        <span className="meta">Dr.Claude 幫你填</span>
      </div>
      <div className="sheet-body stack" style={{ gap: 10 }}>
        {photos.length > 0 && (
          <div className="photo-grid">
            {photos.map((p) => (
              <AttachmentImage key={p.id} id={p.id} alt={p.filename} contentType={p.contentType} />
            ))}
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          multiple
          hidden
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            const added: Attachment[] = [];
            await act.run(async () => {
              for (const f of files) added.push(await uploadPhoto(f, 'rx', { memberId }));
            });
            setPhotos([...photos, ...added]);
          }}
        />
        <div className="row">
          <button type="button" className="btn quiet" onClick={() => input.current?.click()} disabled={act.busy}>
            <Icon.camera /> {photos.length ? '再拍一張' : '拍藥袋、收據'}
          </button>
          {photos.length > 0 && (
            <button
              type="button"
              className="btn"
              disabled={act.busy || !!reading || !memberId}
              onClick={async () => {
                const r = await act.run(() => api.post<{ job: AiJob; runner: RunnerState }>('/scan', { memberId, attachmentIds: photos.map((p) => p.id) }));
                if (r) {
                  setJob(r.job);
                  setRunner(r.runner);
                }
              }}
            >
              <OtterFace size={22} /> 請 Dr.Claude 讀
            </button>
          )}
        </div>
        {act.busy && <div className="small muted">上傳中…</div>}
        {reading && (
          <div className="small">
            <span className="typing" aria-hidden>
              <span />
              <span />
              <span />
            </span>{' '}
            {job!.status === 'queued' ? '排隊中' : '讀藥袋中，大約 20～60 秒'}
            {runner && !runner.online && '（家裡的主機好像沒開，開機後會自動處理）'}
          </div>
        )}
        {job?.status === 'done' && <div className="small" style={{ color: 'var(--green)' }}>讀好了，已經填進下面的表單。請核對後儲存。</div>}
        {job?.status === 'failed' && <div className="error">{job.error || '讀不出來'}</div>}
        <ErrorBox error={act.error} />
      </div>
    </section>
  );
}
