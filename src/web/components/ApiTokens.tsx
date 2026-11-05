// 設定頁「API token」：最高管理者建給 Claude Code 等程式用的 token（auth.ts 的 TOKEN_ROUTES、routes/tokens.ts）。
import { useState, type CSSProperties } from 'react';
import { API_TOKEN_MAX_DAYS, TOKEN_SCOPE_LABEL, type ApiToken, type CreatedApiToken, type TokenScope } from '../../shared/apiTypes';
import { taipeiNow } from '../../shared/dates';
import { api } from '../api';
import { dayLabel } from '../format';
import { useAction, useApi } from '../hooks';
import { confirmDialog, Empty, ErrorBox, Icon, Panel, toast } from './ui';

const tint = (bg: string, ink: string) => ({ ['--tint' as string]: bg, ['--tint-ink' as string]: ink }) as CSSProperties;

const SCOPES: { v: TokenScope; desc: string }[] = [
  { v: 'read', desc: '只能看：查系統問題、看紀錄。' },
  { v: 'log', desc: '再加記身體狀況、量測、吃藥打勾。適合語音助理。' },
  { v: 'write', desc: '再加家人資料、看診、用藥（直接生效，標記「經 API」）。' },
];
const SCOPE_TAG: Record<TokenScope, string> = { read: 'tag', log: 'tag amber', write: 'tag red' };

const DAYS = [
  { v: 7, label: '7 天' },
  { v: 30, label: '30 天' },
  { v: 90, label: '90 天' },
  { v: API_TOKEN_MAX_DAYS, label: '一年' },
];

export function ApiTokensSection() {
  const list = useApi<ApiToken[]>('/tokens');
  const [creating, setCreating] = useState(false);
  const now = taipeiNow();
  return (
    <section className="card">
      <div className="card-head" style={{ display: 'block' }}>
        <div className="spread">
          <h2>API token</h2>
          <button type="button" className="btn sm" onClick={() => setCreating(true)}>
            <Icon.plus />
            建立
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 4 }}>
          給 Claude Code 等程式用：查系統問題、照你的指示幫忙記錄。token 只在建立時顯示一次；用 token 寫進去的紀錄會標「經 API」。
          不能管帳號、不能再建 token。
        </p>
      </div>
      <ErrorBox error={list.error} />
      {list.data && list.data.length === 0 && <Empty icon={<Icon.key />}>還沒有 token</Empty>}
      {list.data && list.data.length > 0 && (
        <div className="list" style={{ borderTop: '1px solid var(--line)', marginTop: 10 }}>
          {list.data.map((t) => {
            const dead = t.revokedAt ? '已撤銷' : t.expiresAt <= now ? '已過期' : '';
            return (
              <div key={t.id} className="set-row" style={{ opacity: dead ? 0.55 : 1 }}>
                <span className="ic" style={tint('var(--surface-3)', 'var(--text-2)')}>
                  <Icon.key />
                </span>
                <span className="grow">
                  <span className="row" style={{ gap: 6, display: 'flex' }}>
                    <strong style={{ color: 'var(--text)' }}>{t.name}</strong>
                    <span className={SCOPE_TAG[t.scope]}>{TOKEN_SCOPE_LABEL[t.scope]}</span>
                    {dead && <span className="tag">{dead}</span>}
                  </span>
                  <span className="num">
                    {t.hint}・{dead ? '' : `${dayLabel(t.expiresAt.slice(0, 10))} 到期・`}
                    {t.lastUsedAt ? `上次使用 ${dayLabel(t.lastUsedAt.slice(0, 10)).replace(/（.）$/, '')} ${t.lastUsedAt.slice(11, 16)}` : '還沒用過'}
                  </span>
                </span>
                {!dead && (
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={async () => {
                      if (!(await confirmDialog({ title: `撤銷「${t.name}」？`, message: '撤銷後用這把 token 的程式馬上就進不來，不能復原。', confirmText: '撤銷', danger: true }))) return;
                      try {
                        await api.post(`/tokens/${t.id}/revoke`, {});
                        toast(`已撤銷「${t.name}」`);
                        list.reload();
                      } catch (e) {
                        toast(e instanceof Error ? e.message : '撤銷失敗', 'error');
                      }
                    }}
                  >
                    撤銷
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {creating && (
        <CreateTokenPanel
          onClose={() => {
            setCreating(false);
            list.reload();
          }}
        />
      )}
    </section>
  );
}

function CreateTokenPanel({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('Claude Code');
  const [scope, setScope] = useState<TokenScope>('read');
  const [days, setDays] = useState(90);
  const [created, setCreated] = useState<CreatedApiToken | null>(null);
  const act = useAction();

  if (created) {
    return (
      <Panel title="token 建好了" onClose={onClose}>
        <div className="stack">
          <div className="alert warn">
            <Icon.alert />
            <div>這個視窗關掉後就看不到了。請現在複製，放到要用的地方；不要貼到聊天、也不要放進 repo。</div>
          </div>
          <div className="token-box num" aria-label="API token">
            {created.token}
          </div>
          <button
            type="button"
            className="btn secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(created.token);
                toast('已複製');
              } catch {
                toast('這台不能自動複製，請手動選取', 'error');
              }
            }}
          >
            <Icon.copy />
            複製 token
          </button>
          <div className="small soft stack xs">
            <strong style={{ color: 'var(--text)' }}>放到 Claude Code 雲端環境</strong>
            <span>對話標題列的環境選單 → Edit → 加一個環境變數 FD_API_TOKEN，值貼這把 token。新開的對話才會讀到。</span>
            <span>其他程式（Codex、自己寫的腳本）呼叫 API 時帶 Authorization: Bearer 加這把 token 就好。</span>
          </div>
          <button type="button" className="btn lg block" onClick={onClose}>
            我存好了
          </button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="建立 API token" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act.run(() => api.post<CreatedApiToken>('/tokens', { name, scope, days }));
          if (r) setCreated(r);
        }}
      >
        <label className="field">
          <span>名稱（之後紀錄上會標這個名字）</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required placeholder="例：Claude Code、Codex" />
        </label>
        <div className="field">
          <span>權限</span>
          <div className="stack xs" role="radiogroup" aria-label="權限">
            {SCOPES.map((s) => (
              <label key={s.v} className="radio-card">
                <input type="radio" name="scope" checked={scope === s.v} onChange={() => setScope(s.v)} />
                <span className="dot" aria-hidden />
                <span>
                  <strong>{TOKEN_SCOPE_LABEL[s.v]}</strong>
                  <small>{s.desc}</small>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <span>期限</span>
          <div className="choices">
            {DAYS.map((d) => (
              <label key={d.v} className="choice">
                <input type="radio" name="days" checked={days === d.v} onChange={() => setDays(d.v)} />
                {d.label}
              </label>
            ))}
          </div>
        </div>
        <ErrorBox error={act.error} />
        <button className="btn lg block" disabled={act.busy || !name.trim()}>
          建立
        </button>
      </form>
    </Panel>
  );
}
