import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROLE_LABEL, type PushSettings, type UserRow } from '../../shared/apiTypes';
import { api, signInUrl, signOutDevice } from '../api';
import { ErrorBox, Loading } from '../components/ui';
import { useAction, useApi, useSession } from '../hooks';
import { isStandalone, platformOf } from '../installApp';
import { currentSubscription, disablePush, enablePush, pushSupport, PushPermissionError } from '../push';
import { APP_VERSION } from '../version';

export function SettingsPage() {
  const { me, members, reloadMe } = useSession();
  const nav = useNavigate();
  const act = useAction();
  return (
    <div className="stack">
      <header className="topbar">
        <button className="back" onClick={() => nav(-1)}>
          ‹ 返回
        </button>
        <div className="title">
          <h1>設定</h1>
        </div>
      </header>

      <section className="sheet">
        <div className="sheet-head">
          <h2>我</h2>
        </div>
        <div className="sheet-body stack" style={{ gap: 10 }}>
          <div>
            {me.name || me.email}
            <div className="small muted">
              {me.email}・{ROLE_LABEL[me.role]}
            </div>
          </div>
          <label className="field">
            <span>我是哪位家人（Dr.Claude 預設在問誰）</span>
            <select
              value={me.memberId ?? ''}
              onChange={async (e) => {
                const ok = await act.run(() => api.patch('/users/me', { memberId: e.target.value ? Number(e.target.value) : null }));
                if (ok) reloadMe();
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
          <ErrorBox error={act.error} />
        </div>
      </section>

      <PushSection />
      <InstallSection />
      {me.superAdmin && <UsersSection />}

      <button
        className="btn quiet"
        onClick={async () => {
          await signOutDevice();
          window.location.href = signInUrl('/');
        }}
      >
        登出這台裝置
      </button>
      <p className="small muted" style={{ textAlign: 'center' }}>
        家庭醫生 v{APP_VERSION}
        <br />
        Dr.Claude 不是醫師，回答僅供參考；身體有狀況請就醫，緊急時打 119。
      </p>
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
    <section className="sheet">
      <div className="sheet-head">
        <h2>吃藥提醒通知</h2>
      </div>
      <div className="sheet-body stack" style={{ gap: 10 }}>
        <p className="small">早上 8:00、中午 12:30、晚上 6:30、睡前 9:30，還沒打勾的藥會推到手機；Dr.Claude 回覆時也會通知。</p>
        {!data ? (
          <Loading />
        ) : !data.publicKey ? (
          <div className="notice">系統還沒設定通知金鑰（部署指南 §5）。</div>
        ) : support === 'needs-install' ? (
          <div className="notice">iPhone 要先「加入主畫面」，從主畫面打開才能收通知。</div>
        ) : support === 'unsupported' ? (
          <div className="notice">這個瀏覽器不支援通知。</div>
        ) : (
          <div className="row">
            {thisOn ? (
              <button className="btn quiet small" disabled={act.busy} onClick={() => act.run(() => api.post('/push/test', {})).then(s.reload)}>
                傳一則測試通知
              </button>
            ) : (
              <button
                className="btn small"
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
                這台手機開啟通知
              </button>
            )}
          </div>
        )}
        {data && data.devices.length > 0 && (
          <div className="ruled" style={{ margin: '0 -14px' }}>
            {data.devices.map((d) => (
              <div key={d.id} className="spread">
                <span>
                  {d.device || '裝置'}
                  {d.endpoint === mine && <span className="pill-tag" style={{ marginLeft: 6 }}>這台</span>}
                  {d.lastError && <div className="small" style={{ color: 'var(--alert)' }}>{d.lastError}</div>}
                </span>
                <button className="btn quiet small" onClick={() => act.run(() => disablePush(d)).then(s.reload)}>
                  關掉
                </button>
              </div>
            ))}
          </div>
        )}
        <ErrorBox error={act.error} />
      </div>
    </section>
  );
}

function InstallSection() {
  if (isStandalone()) return null;
  const p = platformOf();
  if (p === 'other') return null;
  return (
    <section className="sheet">
      <div className="sheet-head">
        <h2>裝到手機主畫面</h2>
      </div>
      <div className="sheet-body small">
        {p === 'ios' ? 'Safari 下方的「分享」→「加入主畫面」。裝好之後從主畫面打開，才收得到吃藥提醒。' : 'Chrome 右上角「⋮」→「加到主畫面」或「安裝應用程式」。'}
      </div>
    </section>
  );
}

function UsersSection() {
  const { members } = useSession();
  const users = useApi<UserRow[]>('/users');
  const act = useAction();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  return (
    <section className="sheet">
      <div className="sheet-head">
        <h2>能登入的帳號</h2>
      </div>
      <div className="sheet-body stack" style={{ gap: 10 }}>
        <p className="small muted">只有清單上的 Google 帳號進得來。小朋友不用帳號。</p>
        {users.data?.map((u) => (
          <div key={u.email} className="spread" style={{ opacity: u.active ? 1 : 0.5 }}>
            <span>
              {u.name || u.email}
              <div className="small muted">
                {u.email}・{ROLE_LABEL[u.role]}
                {u.memberId && `・${members.find((m) => m.id === u.memberId)?.name ?? ''}`}
              </div>
            </span>
            {!u.superAdmin && (
              <button
                className="btn quiet small"
                onClick={() => act.run(() => api.patch(`/users/${encodeURIComponent(u.email)}`, { active: !u.active })).then(users.reload)}
              >
                {u.active ? '停用' : '恢復'}
              </button>
            )}
          </div>
        ))}
        <form
          className="stack"
          style={{ gap: 8 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await act.run(() => api.post('/users', { email, name, role: 'member' }));
            if (ok) {
              setEmail('');
              setName('');
              users.reload();
            }
          }}
        >
          <div className="grid2">
            <label className="field">
              <span>Google 帳號</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="candy@gmail.com" />
            </label>
            <label className="field">
              <span>稱呼</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Candy" />
            </label>
          </div>
          <button className="btn small" disabled={act.busy} style={{ justifySelf: 'start' }}>
            加入
          </button>
        </form>
        <ErrorBox error={act.error} />
      </div>
    </section>
  );
}
