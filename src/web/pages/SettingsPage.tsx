import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROLE_LABEL, type PushSettings, type UserRow } from '../../shared/apiTypes';
import { SLOT_INFO, SLOTS } from '../../shared/meds';
import { api, signInUrl, signOutDevice } from '../api';
import { ApiTokensSection } from '../components/ApiTokens';
import { Alert, confirmDialog, ErrorBox, Icon, Loading, PageHead, promptDialog, toast, UserAvatar } from '../components/ui';
import { useAction, useApi, useSession } from '../hooks';
import { isStandalone, platformOf } from '../installApp';
import { currentSubscription, disablePush, enablePush, pushSupport, PushPermissionError } from '../push';
import { useTheme, type ThemePref } from '../theme';
import { APP_VERSION } from '../version';

const tint = (bg: string, ink: string) => ({ ['--tint' as string]: bg, ['--tint-ink' as string]: ink }) as CSSProperties;

const THEMES: { v: ThemePref; label: string }[] = [
  { v: 'system', label: '跟系統' },
  { v: 'light', label: '亮色' },
  { v: 'dark', label: '暗色' },
];

export function SettingsPage() {
  const { me, members, reloadMe } = useSession();
  const nav = useNavigate();
  const act = useAction();
  const [theme, setTheme] = useTheme();
  return (
    <div className="page narrow">
      <button type="button" className="back-link" onClick={() => nav(-1)}>
        <Icon.chevronLeft />
        返回
      </button>
      <PageHead title="設定" />

      <div className="stack lg">
        <section className="card">
          <div className="me-card">
            <UserAvatar picture={me.picture} name={me.name || me.email} size={56} />
            <div className="grow">
              <h2 style={{ fontSize: '1.125rem' }}>{me.name || me.email}</h2>
              <div className="small muted ellipsis">
                {me.email}・{ROLE_LABEL[me.role]}
              </div>
            </div>
          </div>
          <div className="list">
            <label className="set-row">
              <span className="ic" style={tint('var(--primary-soft)', 'var(--primary-ink)')}>
                <Icon.user />
              </span>
              <span className="grow">
                我是哪位家人
                <span>Dr.水獺 預設在問誰、今天頁怎麼稱呼你</span>
              </span>
              <select
                className="input"
                style={{ width: 'auto', minHeight: 40 }}
                value={me.memberId ?? ''}
                onChange={async (e) => {
                  const ok = await act.run(() => api.patch('/users/me', { memberId: e.target.value ? Number(e.target.value) : null }));
                  if (ok) {
                    toast('已更新');
                    reloadMe();
                  }
                }}
              >
                <option value="">還沒選</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.emoji} {m.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="set-row">
              <span className="ic" style={tint('var(--surface-3)', 'var(--text-2)')}>
                <Icon.moon />
              </span>
              <span className="grow">
                外觀
                <span>這台裝置用</span>
              </span>
              <div className="seg" role="group" aria-label="外觀">
                {THEMES.map((t) => (
                  <button key={t.v} type="button" aria-pressed={theme === t.v} onClick={() => setTheme(t.v)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {act.error && (
            <div style={{ padding: '0 18px 16px' }}>
              <ErrorBox error={act.error} />
            </div>
          )}
        </section>

        <PushSection />
        <InstallSection />
        {me.superAdmin && <UsersSection />}
        {me.superAdmin && <ApiTokensSection />}

        <section className="card">
          <button
            type="button"
            className="set-row item"
            style={{ width: '100%' }}
            onClick={async () => {
              await signOutDevice();
              window.location.href = signInUrl('/');
            }}
          >
            <span className="ic" style={tint('var(--red-soft)', 'var(--red)')}>
              <Icon.logout />
            </span>
            <span className="grow" style={{ color: 'var(--red)', fontWeight: 600 }}>
              登出這台裝置
            </span>
          </button>
        </section>

        <p className="foot-note">
          家庭醫生 v{APP_VERSION}
          <br />
          Dr.水獺 不是醫師，回答僅供參考；身體有狀況請就醫，緊急時打 119。
        </p>
      </div>
    </div>
  );
}

function PushSection() {
  const s = useApi<PushSettings>('/push');
  const act = useAction();
  const [mine, setMine] = useState<string | null>(null);
  useEffect(() => {
    void currentSubscription().then((sub) => setMine(sub?.endpoint ?? null));
  }, [s.data]);
  const support = pushSupport();
  const data = s.data;
  const thisOn = !!data?.devices.some((d) => d.endpoint === mine);
  return (
    <section className="card">
      <div className="card-head">
        <h2>吃藥提醒</h2>
        {thisOn && <span className="tag green">這台已開啟</span>}
      </div>
      <div className="card-body stack sm">
        <p className="small soft">
          {SLOTS.map((sl) => `${SLOT_INFO[sl].label} ${SLOT_INFO[sl].time}`).join('、')}，還沒打勾的藥會推到手機；Dr.水獺 回覆時也會通知。
        </p>
        {!data ? (
          <Loading />
        ) : !data.publicKey ? (
          <Alert kind="warn">系統還沒設定通知金鑰（部署指南 §4）。</Alert>
        ) : support === 'needs-install' ? (
          <Alert kind="info">iPhone 要先「加入主畫面」，從主畫面打開才能收通知。</Alert>
        ) : support === 'unsupported' ? (
          <Alert kind="warn">這個瀏覽器不支援通知。</Alert>
        ) : thisOn ? (
          <button className="btn secondary sm" style={{ justifySelf: 'start' }} disabled={act.busy} onClick={() => act.run(() => api.post('/push/test', {})).then((r) => r !== undefined && toast('已送出測試通知'))}>
            <Icon.bell />
            傳一則測試通知
          </button>
        ) : (
          <button
            className="btn sm"
            style={{ justifySelf: 'start' }}
            disabled={act.busy}
            onClick={() =>
              act
                .run(async () => {
                  try {
                    await enablePush(data.publicKey);
                  } catch (e) {
                    if (e instanceof PushPermissionError) throw new Error(`${e.message}：請到手機設定把這個 App 的通知打開`);
                    throw e;
                  }
                })
                .then(s.reload)
            }
          >
            <Icon.bell />
            這台裝置開啟通知
          </button>
        )}
        <ErrorBox error={act.error} />
      </div>
      {data && data.devices.length > 0 && (
        <div className="list" style={{ borderTop: '1px solid var(--line)' }}>
          {data.devices.map((d) => (
            <div key={d.id} className="set-row">
              <span className="ic">
                <Icon.monitor />
              </span>
              <span className="grow">
                {d.device || '裝置'}
                {d.endpoint === mine && (
                  <span className="tag blue" style={{ marginLeft: 6, display: 'inline-flex' }}>
                    這台
                  </span>
                )}
                {d.lastError && <span style={{ color: 'var(--red)' }}>{d.lastError}</span>}
              </span>
              <button className="btn ghost sm" onClick={() => act.run(() => disablePush(d)).then(s.reload)}>
                關掉
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function InstallSection() {
  if (isStandalone()) return null;
  const p = platformOf();
  if (p === 'other') return null;
  return (
    <section className="card">
      <div className="set-row">
        <span className="ic" style={tint('var(--primary-soft)', 'var(--primary-ink)')}>
          <Icon.download />
        </span>
        <span className="grow">
          裝到手機主畫面
          <span>
            {p === 'ios' ? 'Safari 下方的「分享」→「加入主畫面」。裝好之後從主畫面打開，才收得到吃藥提醒。' : 'Chrome 右上角「⋮」→「加到主畫面」或「安裝應用程式」。'}
          </span>
        </span>
      </div>
    </section>
  );
}

function UsersSection() {
  const { me, members } = useSession();
  const users = useApi<UserRow[]>('/users');
  const act = useAction();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  return (
    <section className="card">
      <div className="card-head" style={{ display: 'block' }}>
        <h2>能登入的帳號</h2>
        <p className="small muted" style={{ marginTop: 2 }}>
          只有清單上的 Google 帳號進得來；小朋友不用帳號。同一個人有好幾個 Google 帳號（例：公司的）可以都加進來，登入後算同一個人。
        </p>
      </div>
      <div className="list" style={{ marginTop: 6, borderTop: '1px solid var(--line)' }}>
        {users.data?.map((u) => (
          <div key={u.email} className="set-row" style={{ opacity: u.active ? 1 : 0.5 }}>
            <UserAvatar picture={u.picture} name={u.name || u.email} size={34} />
            <span className="grow">
              {u.name || u.email}
              <span className="ellipsis">
                {u.email}・{ROLE_LABEL[u.role]}
                {u.memberId && `・${members.find((m) => m.id === u.memberId)?.name ?? ''}`}
              </span>
              {(u.emails.length > 0 || me.superAdmin) && (
                <span className="login-emails">
                  {u.emails.map((alias) => (
                    <span key={alias} className="email-chip">
                      <Icon.key />
                      {alias}
                      {me.superAdmin && (
                        <button
                          type="button"
                          aria-label={`拿掉 ${alias}`}
                          onClick={async () => {
                            const ok = await confirmDialog({
                              title: `拿掉 ${alias}？`,
                              message: '之後不能再用這個 Google 帳號登入；用它登入中的裝置會一起登出。',
                              confirmText: '拿掉',
                              danger: true,
                            });
                            if (ok && (await act.run(() => api.post(`/users/${encodeURIComponent(u.email)}/emails/remove`, { email: alias })))) {
                              toast(`已拿掉 ${alias}`);
                              users.reload();
                            }
                          }}
                        >
                          <Icon.close />
                        </button>
                      )}
                    </span>
                  ))}
                  {me.superAdmin && u.active && (
                    <button
                      type="button"
                      className="email-add"
                      onClick={async () => {
                        const alias = await promptDialog({
                          title: `${u.name || u.email} 的其他 Google 帳號`,
                          message: '例如公司的 Google 帳號。加進來後用它登入也算同一個人。Cloudflare Access 的「家人」政策也要加這個信箱才登得進來。',
                          label: 'Google 帳號',
                          placeholder: 'name@company.com',
                          required: true,
                          confirmText: '加入',
                        });
                        if (alias && (await act.run(() => api.post(`/users/${encodeURIComponent(u.email)}/emails`, { email: alias })))) {
                          toast(`已加入 ${alias.trim().toLowerCase()}`);
                          users.reload();
                        }
                      }}
                    >
                      <Icon.plus />
                      其他登入信箱
                    </button>
                  )}
                </span>
              )}
            </span>
            {!u.superAdmin && (
              <button className="btn ghost sm" onClick={() => act.run(() => api.patch(`/users/${encodeURIComponent(u.email)}`, { active: !u.active })).then(users.reload)}>
                {u.active ? '停用' : '恢復'}
              </button>
            )}
          </div>
        ))}
      </div>
      <form
        className="card-body stack sm"
        style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await act.run(() => api.post('/users', { email, name, role: 'member' }));
          if (ok) {
            toast(`已加入 ${name || email}`);
            setEmail('');
            setName('');
            users.reload();
          }
        }}
      >
        <div className="form-grid">
          <label className="field">
            <span>Google 帳號</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@gmail.com" />
          </label>
          <label className="field">
            <span>稱呼</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Candy" />
          </label>
        </div>
        <button className="btn sm" disabled={act.busy} style={{ justifySelf: 'start' }}>
          <Icon.plus />
          加入
        </button>
        <ErrorBox error={act.error} />
      </form>
    </section>
  );
}
