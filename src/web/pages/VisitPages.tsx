import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { AiJob, Attachment, MedicationDraft, RunnerState, VisitDetail, VisitDraft } from '../../shared/apiTypes';
import { taipeiToday } from '../../shared/dates';
import { scheduleLabel, SLOT_INFO, SLOTS, TIMING_LABEL, type Slot, type Timing } from '../../shared/meds';
import { api } from '../api';
import { Alert, AttachmentImage, Empty, ErrorBox, Icon, MemberPicker, OtterFace, PageHead, PageSkeleton, promptDialog, toast, Who } from '../components/ui';
import { dayLabel } from '../format';
import { emitDataChanged, useAction, useApi, useSession } from '../hooks';
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

const SHORT: Record<Slot, string> = { morning: '早', noon: '午', evening: '晚', bedtime: '睡前' };

/** 藥袋上的「□早 ■午 □晚 □睡前」 */
function BagRead({ slots, asNeeded }: { slots: Slot[]; asNeeded: boolean }) {
  if (asNeeded) return <span className="tag">需要時</span>;
  return (
    <span className="bag-read" aria-label={slots.map((s) => SLOT_INFO[s].label).join('、')}>
      {SLOTS.map((s) => (
        <span key={s} className={slots.includes(s) ? 'on' : undefined}>
          {SHORT[s]}
        </span>
      ))}
    </span>
  );
}

function Kv({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!shown.length) return null;
  return (
    <dl className="kv-rows">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function VisitPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const { members } = useSession();
  const v = useApi<VisitDetail>(`/visits/${id}`);
  const act = useAction();
  const d = v.data;
  if (!d) return v.error ? <div className="page"><ErrorBox error={v.error} /></div> : <PageSkeleton wide />;
  const member = members.find((m) => m.id === d.memberId);
  return (
    <div className="page wide">
      <button type="button" className="back-link" onClick={() => nav(-1)}>
        <Icon.chevronLeft />
        返回
      </button>
      <div className="cols">
        <div className="stack">
          <section className="card visit-hero">
            <div className="spread" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <span className="date num">
                  <Icon.calendar />
                  {dayLabel(d.visitDate)}
                </span>
                <h1>{d.clinic || '看診'}</h1>
                <div className="meta">{[d.department, d.doctor && `${d.doctor} 醫師`].filter(Boolean).join('・')}</div>
              </div>
              <Link className="btn secondary sm" to={`/visits/${id}/edit`}>
                <Icon.edit />
                編輯
              </Link>
            </div>
            <div className="row">
              <Who member={member} size={26} />
              {d.followUpDate && (
                <span className="tag red num">
                  <Icon.calendar />
                  回診 {dayLabel(d.followUpDate)}
                </span>
              )}
              {d.copay !== null && <span className="tag num">自付 {d.copay} 元</span>}
            </div>
          </section>

          {(d.reason || d.diagnosis || d.advice || d.note) && (
            <section className="card">
              <Kv
                rows={[
                  ['症狀', d.reason],
                  ['醫師說', d.diagnosis],
                  ['醫囑', d.advice],
                  ['備註', d.note],
                ]}
              />
            </section>
          )}

          <section className="card">
            <div className="card-head">
              <h2>開的藥</h2>
              <span className="aside">{d.medications.length} 種</span>
            </div>
            {d.medications.length === 0 ? (
              <Empty icon={<Icon.pill />}>這次沒有記藥</Empty>
            ) : (
              <div style={{ paddingBottom: 4 }}>
                {d.medications.map((m) => (
                  <div key={m.id} className={`med${m.stoppedAt ? ' stopped' : ''}`}>
                    <div className="name">
                      {m.name}
                      {m.category && <span className="tag blue">{m.category}</span>}
                      {m.mustFinish && <span className="tag amber">要吃完</span>}
                    </div>
                    {m.genericName && <div className="tiny muted">{m.genericName}</div>}
                    <div className="line num">
                      <BagRead slots={m.slots} asNeeded={m.asNeeded} />
                      {[TIMING_LABEL[m.timing], m.dose, m.days ? `${m.days} 天` : '長期'].filter(Boolean).join('・')}
                    </div>
                    {m.purpose && <div className="small soft">{m.purpose}</div>}
                    {m.appearance && <div className="tiny muted">外觀：{m.appearance}</div>}
                    {m.cautions && (
                      <div className="caution">
                        <Icon.alert />
                        {m.cautions}
                      </div>
                    )}
                    {m.stoppedAt && (
                      <div className="tiny muted">
                        {m.stoppedAt} 停藥{m.stopReason && `（${m.stopReason}）`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="stack sticky">
          <section className="card">
            <div className="card-head">
              <h2>藥袋與照片</h2>
              <span className="aside">{d.attachments.length || ''}</span>
            </div>
            <div className="card-body">
              {d.attachments.length ? (
                <div className="photo-grid">
                  {d.attachments.map((a) => (
                    <AttachmentImage key={a.id} id={a.id} alt={a.filename} contentType={a.contentType} />
                  ))}
                </div>
              ) : (
                <p className="small muted">這次沒有拍照。</p>
              )}
            </div>
          </section>
          <ErrorBox error={act.error} />
          <button
            className="btn danger sm"
            style={{ justifySelf: 'start' }}
            disabled={act.busy}
            onClick={async () => {
              const reason = await promptDialog({
                title: '刪除這次看診？',
                message: '連這次開的藥一起刪除，吃藥提醒也會停掉。',
                label: '原因',
                defaultValue: '記錯了',
                required: true,
                confirmText: '刪除',
                danger: true,
              });
              if (!reason) return;
              const ok = await act.run(() => api.post(`/visits/${id}/void`, { reason }));
              if (ok) {
                toast('已刪除這次看診');
                emitDataChanged();
                nav('/log');
              }
            }}
          >
            <Icon.trash />
            刪除這次看診
          </button>
        </aside>
      </div>
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
      <div className="page">
        <PageHead title="記看診" />
        <div className="card">
          <Empty
            icon={<Icon.family />}
            title="先把家人加進來"
            action={
              <Link className="btn" to="/family">
                去新增家人
              </Link>
            }
          >
            記看診要先選是誰去看的。
          </Empty>
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
      if (ok) {
        toast('已儲存');
        emitDataChanged();
        nav(`/visits/${editId}`, { replace: true });
      }
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
    if (res) {
      const n = v.medications.filter((m) => m.name.trim()).length;
      toast(n ? `已存好，${n} 種藥排進今天的吃藥時間` : '已存好看診紀錄');
      emitDataChanged();
      nav(`/visits/${res.id}`, { replace: true });
    }
  };

  const form = (
    <form
      id="visit-form"
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {fromChat && (
        <Alert kind="info" icon={<Icon.sparkle />}>
          這是 Dr.Claude 整理的草稿，請核對藥名、時段和天數再儲存。
        </Alert>
      )}
      {v.uncertain.length > 0 && (
        <Alert kind="warn">
          <strong>Dr.Claude 不太確定的地方</strong>
          <ul>
            {v.uncertain.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </Alert>
      )}

      <section className="card pad stack">
        <h2>誰去看醫生</h2>
        <MemberPicker members={members} value={memberId} onChange={(id) => setMemberId(id)} />
        <div className="form-grid">
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
      </section>

      <section className="card pad stack">
        <h2>看診內容</h2>
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
      </section>

      {!editId && (
        <section className="stack sm">
          <div className="section-title" style={{ marginBottom: 0 }}>
            <h2>開的藥</h2>
            <span className="aside">{v.medications.length ? `${v.medications.length} 種` : '拍藥袋讓 Dr.Claude 讀，或自己加'}</span>
          </div>
          {v.medications.map((m, i) => (
            <MedEditor
              key={i}
              index={i}
              med={m}
              onChange={(next) => set('medications', v.medications.map((x, j) => (j === i ? next : x)))}
              onRemove={() => set('medications', v.medications.filter((_, j) => j !== i))}
            />
          ))}
          <button type="button" className="add-med" onClick={() => set('medications', [...v.medications, blankMed()])}>
            <Icon.plus />
            加一種藥
          </button>
        </section>
      )}
      {editId && <p className="small muted">藥的內容在家人頁個別調整（停藥）。</p>}

      <ErrorBox error={act.error} />
      <div className="save-bar">
        <button className="btn lg" disabled={act.busy || !memberId}>
          {act.busy ? '儲存中…' : editId ? '儲存' : '儲存看診'}
        </button>
      </div>
    </form>
  );

  return (
    <div className="page wide">
      <button type="button" className="back-link" onClick={() => nav(-1)}>
        <Icon.chevronLeft />
        返回
      </button>
      <PageHead title={editId ? '編輯看診' : '記看診'} sub={editId ? undefined : '拍藥袋讓 Dr.Claude 幫你填，再核對一次就好'} />
      {editId ? (
        <div style={{ maxWidth: 760 }}>{existing.data ? form : <PageSkeleton />}</div>
      ) : (
        <div className="cols left">
          <div className="sticky">
            <Scanner
              memberId={memberId}
              photos={photos}
              setPhotos={setPhotos}
              onDraft={(draft) => {
                setV((cur) => ({ ...cur, ...draft, medications: draft.medications.length ? draft.medications : cur.medications }));
              }}
            />
          </div>
          {form}
        </div>
      )}
    </div>
  );
}

function MedEditor({ index, med, onChange, onRemove }: { index: number; med: MedicationDraft; onChange: (m: MedicationDraft) => void; onRemove: () => void }) {
  const [more, setMore] = useState(!!(med.purpose || med.cautions || med.genericName || med.appearance));
  const set = <K extends keyof MedicationDraft>(k: K, val: MedicationDraft[K]) => onChange({ ...med, [k]: val });
  const toggleSlot = (s: Slot) => set('slots', med.slots.includes(s) ? med.slots.filter((x) => x !== s) : SLOTS.filter((x) => x === s || med.slots.includes(x)));
  return (
    <section className="card med-editor">
      <div className="head">
        <span className="n num">{index + 1}</span>
        <strong className="ellipsis">{med.name || '新的藥'}</strong>
        <button type="button" className="icon-btn sm" onClick={onRemove} aria-label="移除這種藥">
          <Icon.trash />
        </button>
      </div>
      <div className="form-grid">
        <label className="field span">
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
        <div className="bag-boxes">
          {SLOTS.map((s) => (
            <label key={s} className="bag-box">
              <input type="checkbox" checked={med.slots.includes(s)} disabled={med.asNeeded} onChange={() => toggleSlot(s)} />
              <span className="sq">
                <Icon.check />
              </span>
              {SLOT_INFO[s].label}
            </label>
          ))}
          <label className="bag-box">
            <input type="checkbox" checked={med.asNeeded} onChange={(e) => set('asNeeded', e.target.checked)} />
            <span className="sq">
              <Icon.check />
            </span>
            需要時
          </label>
        </div>
      </div>
      <div className="field">
        <span>飯前飯後</span>
        <div className="choices">
          {(['before', 'after', 'with', 'any'] as Timing[]).map((t) => (
            <label key={t} className="choice">
              <input type="radio" checked={med.timing === t} onChange={() => set('timing', t)} />
              {TIMING_LABEL[t] || '不限'}
            </label>
          ))}
        </div>
      </div>
      <div className="form-grid" style={{ alignItems: 'end' }}>
        <label className="field">
          <span>吃幾天（空白＝長期）</span>
          <input inputMode="numeric" value={med.days ?? ''} onChange={(e) => set('days', e.target.value ? Number(e.target.value.replace(/\D/g, '')) || null : null)} />
        </label>
        <label className="bag-box" style={{ minHeight: 46 }}>
          <input type="checkbox" checked={med.mustFinish} onChange={(e) => set('mustFinish', e.target.checked)} />
          <span className="sq">
            <Icon.check />
          </span>
          要吃完（抗生素）
        </label>
      </div>
      <div className="schedule-preview">
        <Icon.clock />
        {scheduleLabel(med.slots, med.timing, med.asNeeded) || '還沒選時間'}
        {!med.asNeeded && (med.days ? `・${med.days} 天` : '・長期')}
      </div>
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
            <textarea value={med.cautions} onChange={(e) => set('cautions', e.target.value)} style={{ minHeight: 72 }} />
          </label>
        </>
      ) : (
        <button type="button" className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setMore(true)}>
          <Icon.plus />
          成分、用途、外觀、注意事項
        </button>
      )}
    </section>
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
        if (r.job.status === 'done' && r.job.result) {
          onDraft(r.job.result);
          toast('Dr.Claude 讀好了，請核對');
        }
      } catch {
        // 下次再試
      }
    }, 2500);
    return () => window.clearInterval(t);
  }, [job, onDraft]);

  const reading = job && (job.status === 'queued' || job.status === 'running');
  const pick = () => input.current?.click();
  return (
    <section className="card pad scanner stack">
      <div className="spread">
        <h2>拍藥袋</h2>
        <span className="tag otter">Dr.Claude 幫你填</span>
      </div>
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
      {photos.length === 0 ? (
        <button type="button" className="drop" onClick={pick} disabled={act.busy}>
          <span className="ic">
            <Icon.camera />
          </span>
          <strong>{act.busy ? '上傳中…' : '拍藥袋、收據'}</strong>
          <span>可以拍好幾張。Dr.Claude 會讀出藥名、吃法、天數和回診日。</span>
        </button>
      ) : (
        <>
          <div className="photo-grid">
            {photos.map((p) => (
              <AttachmentImage key={p.id} id={p.id} alt={p.filename} contentType={p.contentType} />
            ))}
          </div>
          <div className="row nowrap">
            <button type="button" className="btn secondary" onClick={pick} disabled={act.busy}>
              <Icon.camera />
              {act.busy ? '上傳中…' : '再拍一張'}
            </button>
            <button
              type="button"
              className="btn grow"
              disabled={act.busy || !!reading || !memberId}
              onClick={async () => {
                const r = await act.run(() => api.post<{ job: AiJob; runner: RunnerState }>('/scan', { memberId, attachmentIds: photos.map((p) => p.id) }));
                if (r) {
                  setJob(r.job);
                  setRunner(r.runner);
                }
              }}
            >
              <Icon.sparkle />
              {job?.status === 'done' ? '再讀一次' : '請 Dr.Claude 讀'}
            </button>
          </div>
        </>
      )}
      {reading && (
        <div className="scan-progress" role="status">
          <span className="otter">
            <OtterFace size={38} />
          </span>
          <div className="grow">
            <strong className="hand" style={{ fontSize: '1.0625rem' }}>
              {job!.status === 'queued' ? 'Dr.Claude 走過來了…' : '讀藥袋中，大約 20～60 秒'}
            </strong>
            <div className="indeterminate" />
          </div>
        </div>
      )}
      {reading && runner && !runner.online && <Alert kind="warn">家裡的主機好像沒開，開機後會自動處理。可以先自己填，晚點再看。</Alert>}
      {job?.status === 'done' && <Alert kind="ok">讀好了，已經填進表單。請核對藥名、時段和天數再儲存。</Alert>}
      {job?.status === 'failed' && <Alert kind="error">{job.error || '讀不出來，可以換個角度再拍一張'}</Alert>}
      <ErrorBox error={act.error} />
    </section>
  );
}
