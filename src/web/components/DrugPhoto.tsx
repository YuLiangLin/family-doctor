// 藥品照片：食藥署「藥品外觀」的真實照片（經我們的系統，家裡的 runner 裁好縮小；routes/drugs.ts）。
// 還沒做好、或食藥署沒照片時，用資料裡的顏色、形狀畫一顆藥（PillGlyph）。
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { DrugCandidate, DrugInfo, Medication } from '../../shared/apiTypes';
import { PILL_COLOR } from '../../shared/drugs';
import { api } from '../api';
import { emitDataChanged } from '../hooks';
import { Icon, Panel, toast } from './ui';

const photoUrl = (license: string, full = false) => `/api/drugs/${encodeURIComponent(license)}/photo${full ? '?v=full' : ''}`;

// 同一顆藥的資料只抓一次
const infoCache = new Map<string, Promise<DrugInfo | null>>();
export function loadDrugInfo(license: string): Promise<DrugInfo | null> {
  let p = infoCache.get(license);
  if (!p) {
    p = api.get<DrugInfo>(`/drugs/${encodeURIComponent(license)}`).catch(() => null);
    infoCache.set(license, p);
  }
  return p;
}

function useDrugInfo(license: string | null, given?: DrugInfo | null): DrugInfo | null {
  const [info, setInfo] = useState<DrugInfo | null>(given ?? null);
  useEffect(() => {
    if (given || !license) return;
    let alive = true;
    void loadDrugInfo(license).then((d) => alive && setInfo(d));
    return () => {
      alive = false;
    };
  }, [license, given]);
  return given ?? info;
}

/** 照著食藥署寫的顏色、形狀畫一顆藥 */
export function PillGlyph({ color, shape, size = 48 }: { color?: string; shape?: string; size?: number }) {
  const colors = (color ?? '')
    .split('、')
    .map((c) => PILL_COLOR[c.trim()])
    .filter(Boolean);
  const c1 = colors[0] ?? '#ece8df';
  const c2 = colors[1] ?? c1;
  const s = shape ?? '';
  const stroke = 'rgba(30, 30, 40, 0.18)';
  let body: ReactNode;
  if (/膠囊/.test(s)) {
    body = (
      <g transform="rotate(-32 24 24)">
        <path d="M24 14 H33 a10 10 0 0 1 0 20 H24 Z" fill={c2} stroke={stroke} />
        <path d="M24 14 H15 a10 10 0 0 0 0 20 H24 Z" fill={c1} stroke={stroke} />
        <path d="M13 19 q3 -3 9 -3" stroke="#fff" strokeOpacity="0.6" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      </g>
    );
  } else if (/液|糖漿/.test(s)) {
    body = (
      <g>
        <rect x="18" y="6" width="12" height="6" rx="2" fill="#9aa3ae" />
        <path d="M16 13 h16 v4 l3 4 v19 a3 3 0 0 1 -3 3 H16 a3 3 0 0 1 -3 -3 V21 l3 -4 Z" fill="#fff" stroke={stroke} />
        <path d="M14 27 h20 v13 a3 3 0 0 1 -3 3 H17 a3 3 0 0 1 -3 -3 Z" fill={c1} opacity="0.85" />
      </g>
    );
  } else if (/粉|顆粒|散/.test(s)) {
    body = (
      <g>
        <rect x="10" y="12" width="28" height="26" rx="3" fill="#fff" stroke={stroke} />
        <path d="M10 18 h28" stroke={stroke} strokeDasharray="2 2" />
        <circle cx="20" cy="28" r="2" fill={c1} />
        <circle cx="27" cy="31" r="2" fill={c1} />
        <circle cx="25" cy="24" r="1.6" fill={c1} />
      </g>
    );
  } else if (/橢圓|水滴|四邊|長/.test(s)) {
    body = (
      <g transform="rotate(-20 24 24)">
        <ellipse cx="24" cy="24" rx="16" ry="9.5" fill={c1} stroke={stroke} />
        <path d="M13 21 q5 -5 13 -5" stroke="#fff" strokeOpacity="0.6" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      </g>
    );
  } else {
    body = (
      <g>
        <circle cx="24" cy="24" r="13" fill={c1} stroke={stroke} />
        <path d="M15 20 q3 -6 10 -7" stroke="#fff" strokeOpacity="0.6" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      </g>
    );
  }
  return (
    <svg className="pill-glyph" width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      {body}
    </svg>
  );
}

type PhotoStatus = 'done' | 'queued' | 'failed' | 'none';

// 已經知道做好的照片，不用每次再問
const photoDone = new Set<string>();

/** 照片好了沒：還在做就每 6 秒再問一次，最多一分半（runner 在家裡的主機上做） */
function usePhotoStatus(license: string | null): PhotoStatus | 'loading' {
  const [status, setStatus] = useState<PhotoStatus | 'loading'>(license && photoDone.has(license) ? 'done' : 'loading');
  useEffect(() => {
    if (!license) return;
    if (photoDone.has(license)) {
      setStatus('done');
      return;
    }
    let alive = true;
    let tries = 0;
    let timer = 0;
    setStatus('loading');
    const check = async () => {
      let s: PhotoStatus = 'queued';
      try {
        s = (await api.get<{ status: PhotoStatus }>(`/drugs/${encodeURIComponent(license)}/photo/status`)).status;
      } catch {
        s = 'none';
      }
      if (!alive) return;
      if (s === 'done') photoDone.add(license);
      setStatus(s);
      if (s === 'queued' && ++tries < 15) timer = window.setTimeout(() => void check(), 6000);
    };
    void check();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [license]);
  return status;
}

/** 藥品照片小圖（裁到藥丸）；還沒做好先畫一顆藥 */
export function DrugPhoto({
  license,
  size = 48,
  info,
  badge,
  onClick,
  label,
}: {
  license: string;
  size?: number;
  info?: DrugInfo | null;
  badge?: ReactNode;
  onClick?: () => void;
  label?: string;
}) {
  const status = usePhotoStatus(license);
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const d = useDrugInfo(license, info);
  useEffect(() => {
    setLoaded(false);
    setBroken(false);
  }, [license]);
  const showImg = status === 'done' && !broken;
  const style = { ['--s' as string]: `${size}px` } as CSSProperties;
  const inner = (
    <>
      {showImg && <img src={photoUrl(license)} alt="" loading="lazy" onLoad={() => setLoaded(true)} onError={() => setBroken(true)} style={{ opacity: loaded ? 1 : 0 }} />}
      {!(showImg && loaded) && (
        <span className={`drug-photo-fallback${status === 'queued' || status === 'loading' || (showImg && !loaded) ? ' pending' : ''}`}>
          <PillGlyph color={d?.color} shape={d?.shape} size={Math.round(size * 0.8)} />
        </span>
      )}
      {badge && <span className="drug-photo-badge">{badge}</span>}
    </>
  );
  if (onClick)
    return (
      <button type="button" className="drug-photo" style={style} onClick={onClick} aria-label={label ?? '看藥品照片'}>
        {inner}
      </button>
    );
  return (
    <span className="drug-photo" style={style} aria-hidden>
      {inner}
    </span>
  );
}

const SOURCE = '照片與外觀：衛生福利部食品藥物管理署「藥品外觀」開放資料';

function describe(d: DrugInfo): string {
  return [d.color, d.shape, d.sizeMm && `${d.sizeMm} mm`, d.scoreLine && d.scoreLine !== '無' && `刻痕：${d.scoreLine}`].filter(Boolean).join('・');
}

/** 看大圖：整張照片（有尺規看得出大小）＋外觀資料 */
export function DrugLightbox({ license, title, onClose, onChange }: { license: string; title?: string; onClose: () => void; onChange?: () => void }) {
  const d = useDrugInfo(license);
  const status = usePhotoStatus(license);
  const [failed, setFailed] = useState(false);
  return (
    <Panel title={title || d?.nameZh || '藥品照片'} onClose={onClose}>
      <div className="stack">
        <div className="drug-big">
          {status === 'loading' ? (
            <div className="skel" style={{ height: 260, borderRadius: 0 }} />
          ) : failed || status !== 'done' ? (
            <div className="drug-big-fallback">
              <PillGlyph color={d?.color} shape={d?.shape} size={120} />
              <span className="small muted">{status === 'queued' ? '照片準備中（家裡的主機在處理），等一下再看' : '食藥署沒有這個藥的照片'}</span>
            </div>
          ) : (
            <img src={photoUrl(license, true)} alt={d?.nameZh ?? '藥品照片'} onError={() => setFailed(true)} />
          )}
        </div>
        {d && (
          <dl className="kv-rows card">
            <div>
              <dt>品名</dt>
              <dd>
                {d.nameZh}
                <span className="tiny muted" style={{ display: 'block' }}>
                  {d.nameEn}
                </span>
              </dd>
            </div>
            <div>
              <dt>外觀</dt>
              <dd>{describe(d) || '—'}</dd>
            </div>
            {d.marking && (
              <div>
                <dt>印字</dt>
                <dd>{d.marking}</dd>
              </div>
            )}
            <div>
              <dt>字號</dt>
              <dd className="num">{d.licenseNo}</dd>
            </div>
          </dl>
        )}
        {onChange && (
          <button type="button" className="btn secondary" onClick={onChange}>
            不是這款？換一款
          </button>
        )}
        <p className="tiny muted">{SOURCE}。照片是這個許可證的樣品，實際拿到的藥請以藥袋為準。</p>
      </div>
    </Panel>
  );
}

/** 挑是哪一款：先列從藥袋找到的候選，也可以自己打字找 */
export function DrugPicker({
  query,
  current,
  onPick,
  onClose,
}: {
  query: { name: string; genericName?: string; appearance?: string };
  current: string | null;
  onPick: (license: string | null) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(query.name);
  const [list, setList] = useState<DrugCandidate[] | null>(null);
  const [searched, setSearched] = useState(false);
  const load = async (path: string) => {
    setList(null);
    try {
      setList(await api.get<DrugCandidate[]>(path));
    } catch {
      setList([]);
    }
  };
  useEffect(() => {
    const p = new URLSearchParams({ name: query.name, generic: query.genericName ?? '', appearance: query.appearance ?? '' });
    void load(`/drugs/match?${p}`);
  }, [query.name, query.genericName, query.appearance]);
  return (
    <Panel title="這個藥是哪一款？" onClose={onClose}>
      <div className="stack">
        <p className="small soft">
          同一種成分常有好幾家藥廠，長得不一樣。對照藥袋上的外觀（顏色、形狀、印字）挑一款；
          {query.appearance ? `藥袋寫的是「${query.appearance}」。` : '藥袋沒寫外觀的話，對照手上的藥。'}
        </p>
        <form
          className="row nowrap"
          onSubmit={(e) => {
            e.preventDefault();
            setSearched(true);
            void load(`/drugs?q=${encodeURIComponent(q)}`);
          }}
        >
          <label className="field grow">
            <span className="sr-only">藥名</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="藥名、成分、中文品名" />
          </label>
          <button className="btn secondary" disabled={!q.trim()}>
            找
          </button>
        </form>
        {!list ? (
          <div className="stack xs">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skel" style={{ height: 76, borderRadius: 14 }} />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="empty small">{searched ? '找不到，換個寫法試試（英文藥名、成分或中文品名）' : '找不到候選，可以自己打字找'}</div>
        ) : (
          <div className="drug-list" role="listbox" aria-label="候選">
            {list.map((d) => (
              <button
                key={d.licenseNo}
                type="button"
                role="option"
                aria-selected={current === d.licenseNo}
                className={`drug-option${current === d.licenseNo ? ' on' : ''}`}
                onClick={() => onPick(d.licenseNo)}
              >
                <DrugPhoto license={d.licenseNo} info={d} size={64} />
                <span className="grow">
                  <strong>{d.nameZh}</strong>
                  <span className="en">{d.nameEn}</span>
                  <span className="meta">
                    {describe(d)}
                    {d.marking && `・印字 ${d.marking}`}
                  </span>
                  {d.colorAgreement === 'match' && (
                    <span className="tag green">
                      <Icon.check />
                      顏色對得上
                    </span>
                  )}
                  {d.colorAgreement === 'mismatch' && (
                    <span className="tag amber">
                      <Icon.alert />
                      顏色跟藥袋寫的不一樣
                    </span>
                  )}
                </span>
                {current === d.licenseNo && (
                  <span className="ic18" style={{ color: 'var(--primary)' }}>
                    <Icon.checkCircle />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="btn ghost" onClick={() => onPick(null)}>
          {current ? '拿掉照片' : '都不是，先不要照片'}
        </button>
        <p className="tiny muted">{SOURCE}</p>
      </div>
    </Panel>
  );
}

/** 記看診時：從藥名自動找最像的幾款，點一下就選 */
export function DrugSuggest({
  query,
  value,
  onChange,
}: {
  query: { name: string; genericName?: string; appearance?: string };
  value: string | null;
  onChange: (license: string | null) => void;
}) {
  const [list, setList] = useState<DrugCandidate[] | null>(null);
  const [picker, setPicker] = useState(false);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    if (query.name.trim().length < 2) {
      setList([]);
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      const p = new URLSearchParams({ name: query.name, generic: query.genericName ?? '', appearance: query.appearance ?? '' });
      api
        .get<DrugCandidate[]>(`/drugs/match?${p}`)
        .then((r) => alive && setList(r.slice(0, 4)))
        .catch(() => alive && setList([]));
    }, 500);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [query.name, query.genericName, query.appearance]);
  const chosen = value ? list?.find((d) => d.licenseNo === value) : undefined;
  return (
    <div className="field">
      <span>藥品照片</span>
      {value ? (
        <div className="drug-chosen">
          <DrugPhoto license={value} info={chosen} size={56} onClick={() => setZoom(true)} />
          <span className="grow">
            <ChosenName license={value} />
          </span>
          <button type="button" className="btn ghost sm" onClick={() => setPicker(true)}>
            換一款
          </button>
        </div>
      ) : list === null ? (
        <div className="skel" style={{ height: 64, borderRadius: 14 }} />
      ) : list.length === 0 ? (
        <button type="button" className="btn secondary sm" style={{ justifySelf: 'start' }} onClick={() => setPicker(true)} disabled={query.name.trim().length < 2}>
          <Icon.image />
          找藥品照片
        </button>
      ) : (
        <div className="stack xs">
          <span className="hint">是哪一款？對照藥袋點一下（不確定可以先跳過）</span>
          <div className="drug-tiles">
            {list.map((d) => (
              <button key={d.licenseNo} type="button" className="drug-tile" onClick={() => onChange(d.licenseNo)} title={`${d.nameZh}（${describe(d)}）`}>
                <DrugPhoto license={d.licenseNo} info={d} size={64} />
                <span className="ellipsis">{d.nameZh.replace(/^["“〝'']+[^"”〞'']*["”〞'']+\s*/, '')}</span>
                <span className="tiny muted ellipsis">{[d.color, d.shape].filter(Boolean).join('・')}</span>
                {d.colorAgreement === 'mismatch' && <span className="tag amber">顏色不同</span>}
              </button>
            ))}
            <button type="button" className="drug-tile more" onClick={() => setPicker(true)}>
              <span className="ic">
                <Icon.plus />
              </span>
              <span>更多</span>
            </button>
          </div>
        </div>
      )}
      {picker && (
        <DrugPicker
          query={query}
          current={value}
          onClose={() => setPicker(false)}
          onPick={(l) => {
            onChange(l);
            setPicker(false);
          }}
        />
      )}
      {zoom && value && <DrugLightbox license={value} onClose={() => setZoom(false)} />}
    </div>
  );
}

function ChosenName({ license }: { license: string }) {
  const d = useDrugInfo(license);
  if (!d) return <span className="muted small">{license}</span>;
  return (
    <>
      <strong style={{ display: 'block' }}>{d.nameZh}</strong>
      <span className="tiny muted">{[d.color, d.shape, d.marking && `印字 ${d.marking}`].filter(Boolean).join('・')}</span>
    </>
  );
}

/** 已經存好的用藥：有照片就顯示（點開看大圖、可以換），沒有就給「加照片」 */
export function MedPhotoSlot({ med, size = 56 }: { med: Medication; size?: number }) {
  const [mode, setMode] = useState<'pick' | 'zoom' | null>(null);
  const save = async (license: string | null) => {
    setMode(null);
    if (license === med.drugLicense) return;
    try {
      await api.post(`/medications/${med.id}/drug`, { license });
      toast(license ? '已加上藥品照片' : '已拿掉照片');
      emitDataChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : '沒有存到', 'error');
    }
  };
  return (
    <>
      {med.drugLicense ? (
        <DrugPhoto license={med.drugLicense} size={size} onClick={() => setMode('zoom')} label={`${med.name} 的照片`} />
      ) : (
        <button type="button" className="photo-add" style={{ width: size, height: size }} onClick={() => setMode('pick')} aria-label={`幫 ${med.name} 找藥品照片`} title="找藥品照片">
          <Icon.image />
        </button>
      )}
      {mode === 'zoom' && med.drugLicense && <DrugLightbox license={med.drugLicense} title={med.name} onClose={() => setMode(null)} onChange={() => setMode('pick')} />}
      {mode === 'pick' && (
        <DrugPicker
          query={{ name: med.name, genericName: med.genericName, appearance: med.appearance }}
          current={med.drugLicense}
          onClose={() => setMode(null)}
          onPick={(l) => void save(l)}
        />
      )}
    </>
  );
}
