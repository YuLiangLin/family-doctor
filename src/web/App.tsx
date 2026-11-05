import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import type { Me, Member } from '../shared/apiTypes';
import { api, ApiRequestError, onAuthLost, signInUrl, signOutDevice } from './api';
import { AddMenu, MeasurePanel, NotePanel } from './components/QuickAdd';
import { Avatar, DialogHost, Icon, OtterFace, PageSkeleton, Toaster, UserAvatar } from './components/ui';
import { QuickContext, SessionContext, useSession, type QuickKind } from './hooks';
import { MemberPage, MembersPage } from './pages/MembersPage';
import { SettingsPage } from './pages/SettingsPage';
import { TimelinePage } from './pages/TimelinePage';
import { TodayPage } from './pages/TodayPage';
import { VisitEditPage, VisitPage } from './pages/VisitPages';
import { LoginArt } from './components/LoginArt';
import { APP_VERSION, useNewRelease } from './version';

// 3D 醫生（three.js）比較大，進 Dr.水獺 頁才載入
const DoctorPage = lazy(() => import('./pages/DoctorPage'));

type Gate = { state: 'loading' } | { state: 'signin' } | { state: 'denied'; message: string } | { state: 'error'; message: string } | { state: 'ok'; me: Me };

export function App() {
  const [gate, setGate] = useState<Gate>({ state: 'loading' });
  const [members, setMembers] = useState<Member[]>([]);

  const loadMe = useCallback(async () => {
    try {
      const me = await api.get<Me>('/me');
      setMembers(await api.get<Member[]>('/members'));
      setGate({ state: 'ok', me });
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) setGate({ state: 'signin' });
      else if (e instanceof ApiRequestError && e.status === 403) setGate({ state: 'denied', message: e.message });
      else setGate({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void loadMe();
    return onAuthLost(() => setGate({ state: 'signin' }));
  }, [loadMe]);

  const reloadMembers = useCallback(() => {
    void api.get<Member[]>('/members').then(setMembers).catch(() => undefined);
  }, []);

  let body: ReactNode;
  if (gate.state === 'loading') body = <Boot />;
  else if (gate.state === 'signin') body = <SignIn />;
  else if (gate.state === 'denied') body = <SignIn denied={gate.message} />;
  else if (gate.state === 'error')
    body = (
      <LoginLayout say="咦，好像連不上…" mood="concerned">
        <div className="login-brand">
          <h1>連不上家庭醫生</h1>
          <p className="lead">{gate.message}</p>
        </div>
        <button className="btn lg block" onClick={() => void loadMe()}>
          再試一次
        </button>
      </LoginLayout>
    );
  else
    body = (
      <SessionContext.Provider value={{ me: gate.me, members, reloadMembers, reloadMe: () => void loadMe() }}>
        <Shell />
      </SessionContext.Provider>
    );

  return (
    <>
      {body}
      <DialogHost />
    </>
  );
}

function Boot() {
  return (
    <div className="boot" role="status" aria-label="載入中">
      <div className="logo">
        <OtterFace size={48} />
      </div>
      家庭醫生
    </div>
  );
}

function Shell() {
  const release = useNewRelease();
  const { pathname } = useLocation();
  const [quick, setQuick] = useState<{ kind: QuickKind; memberId?: number | null } | null>(null);
  const quickApi = useMemo(() => ({ open: (kind: QuickKind, opts?: { memberId?: number | null }) => setQuick({ kind, memberId: opts?.memberId }) }), []);
  const close = useCallback(() => setQuick(null), []);
  const full = pathname.startsWith('/doctor');

  // 大括號不能省：新版瀏覽器的 scrollTo 回傳 Promise，直接回傳會被 React 當成 cleanup 呼叫，一換頁整個畫面就變白
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <QuickContext.Provider value={quickApi}>
      <div className="shell">
        <Sidebar onAdd={() => quickApi.open('menu')} />
        <main className={`main${full ? ' full' : ''}`}>
          {release && !full && (
            <div className="page wide">
              <div className="release" role="status">
                <Icon.sparkle />
                <div className="grow">
                  <strong>有新版本了</strong>
                  {release.notes[0] && <span>{release.notes[0]}</span>}
                </div>
                <button className="btn sm" onClick={() => window.location.reload()}>
                  更新
                </button>
              </div>
            </div>
          )}
          <Suspense
            fallback={
              full ? (
                <div className="boot" role="status">
                  <div className="logo">
                    <OtterFace size={48} />
                  </div>
                  Dr.水獺 走進診間…
                </div>
              ) : (
                <PageSkeleton />
              )
            }
          >
            <Routes>
              <Route path="/" element={<TodayPage />} />
              <Route path="/log" element={<TimelinePage />} />
              <Route path="/doctor" element={<DoctorPage />} />
              <Route path="/doctor/:id" element={<DoctorPage />} />
              <Route path="/family" element={<MembersPage />} />
              <Route path="/family/:id" element={<MemberPage />} />
              <Route path="/visits/new" element={<VisitEditPage />} />
              <Route path="/visits/:id" element={<VisitPage />} />
              <Route path="/visits/:id/edit" element={<VisitEditPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route
                path="*"
                element={
                  <div className="page">
                    <div className="empty">找不到這一頁</div>
                  </div>
                }
              />
            </Routes>
          </Suspense>
        </main>
      </div>
      <TabBar onAdd={() => quickApi.open('menu')} />
      <Toaster />
      {quick?.kind === 'menu' && <AddMenu memberId={quick.memberId} onClose={close} onPick={(kind) => setQuick({ kind, memberId: quick.memberId })} />}
      {quick?.kind === 'note' && <NotePanel memberId={quick.memberId} onClose={close} />}
      {quick?.kind === 'temperature' && <MeasurePanel memberId={quick.memberId} kind="temperature" onClose={close} />}
      {quick?.kind === 'measure' && <MeasurePanel memberId={quick.memberId} kind="weight" onClose={close} />}
    </QuickContext.Provider>
  );
}

/** 電腦：左側選單 */
function Sidebar({ onAdd }: { onAdd: () => void }) {
  const { me, members } = useSession();
  const link = (to: string, label: string, icon: ReactNode, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `side-link${isActive ? ' active' : ''}`}>
      {icon}
      {label}
    </NavLink>
  );
  return (
    <aside className="sidebar" aria-label="側邊選單">
      <div className="brand">
        <span className="logo">
          <OtterFace size={30} />
        </span>
        <span>
          <strong>家庭醫生</strong>
          <span>全家人的健康紀錄</span>
        </span>
      </div>
      <button type="button" className="btn block side-add" onClick={onAdd}>
        <Icon.plus />
        新增紀錄
      </button>
      <nav className="side-nav" aria-label="主選單">
        {link('/', '今天', <Icon.today />, true)}
        {link('/log', '紀錄', <Icon.log />)}
        <NavLink to="/doctor" className={({ isActive }) => `side-link${isActive ? ' active' : ''}`}>
          <span className="otter-mini">
            <OtterFace size={20} />
          </span>
          Dr.水獺
        </NavLink>
        {link('/visits/new', '記看診', <Icon.visit />, true)}
        {link('/family', '家人', <Icon.family />, true)}
      </nav>
      {members.length > 0 && (
        <>
          <div className="side-label">家人</div>
          <nav className="side-nav" aria-label="家人">
            {members.map((m) => (
              <NavLink key={m.id} to={`/family/${m.id}`} className={({ isActive }) => `side-member${isActive ? ' active' : ''}`}>
                <Avatar member={m} size={26} />
                {m.name}
              </NavLink>
            ))}
          </nav>
        </>
      )}
      <div className="side-foot">
        <NavLink to="/settings" className={({ isActive }) => `side-user${isActive ? ' active' : ''}`} aria-label="設定">
          <UserAvatar picture={me.picture} name={me.name || me.email} size={34} />
          <span className="meta">
            <strong className="ellipsis" style={{ display: 'block' }}>
              {me.name || me.email}
            </strong>
            <span>設定</span>
          </span>
          <span className="ic18 muted">
            <Icon.settings />
          </span>
        </NavLink>
      </div>
    </aside>
  );
}

/** 手機：底部分頁列 */
function TabBar({ onAdd }: { onAdd: () => void }) {
  const tab = (to: string, label: string, icon: ReactNode, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
      {icon}
      {label}
    </NavLink>
  );
  return (
    <div className="tabbar">
      <nav aria-label="主選單">
        {tab('/', '今天', <Icon.today />, true)}
        {tab('/log', '紀錄', <Icon.log />)}
        <NavLink to="/doctor" className={({ isActive }) => `tab tab-doctor${isActive ? ' active' : ''}`}>
          <span className="otter-btn">
            <OtterFace size={42} />
          </span>
          Dr.水獺
        </NavLink>
        <button type="button" className="tab" onClick={onAdd}>
          <Icon.plusSquare />
          新增
        </button>
        {tab('/family', '家人', <Icon.family />)}
      </nav>
    </div>
  );
}

const tint = (bg: string, ink: string) => ({ ['--tint' as string]: bg, ['--tint-ink' as string]: ink }) as CSSProperties;

/** 台北時間的招呼語 */
function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Taipei' }).format(new Date()));
  return h < 5 ? '夜深了' : h < 11 ? '早安' : h < 14 ? '午安' : h < 18 ? '午後好' : '晚安';
}

/** 登入、沒開通、連不上共用的版面：手機上下排、電腦左右排（左邊海獺、右邊卡片） */
function LoginLayout({ say, mood = 'calm', children }: { say: string; mood?: 'calm' | 'concerned'; children: ReactNode }) {
  return (
    <div className="login">
      <div className="login-hero">
        <p className="login-say" aria-hidden>
          {say}
        </p>
        <LoginArt mood={mood} />
      </div>
      <div className="login-card">{children}</div>
      <p className="login-foot">家庭醫生 v{APP_VERSION}・全家人的健康小幫手</p>
    </div>
  );
}

/** Google 的「G」 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function SignIn({ denied }: { denied?: string }) {
  return (
    <LoginLayout say={denied ? '咦，這個帳號我不認得…' : `${greeting()}！我是 Dr.水獺`} mood={denied ? 'concerned' : 'calm'}>
      <div className="login-brand">
        <h1>家庭醫生</h1>
        <p className="lead">全家人的看診、用藥與身體狀況，都記在這裡。</p>
      </div>
      {denied ? (
        <div className="stack sm">
          <div className="alert warn">
            <Icon.alert />
            <div>{denied}</div>
          </div>
          <button
            className="google-btn"
            onClick={async () => {
              await signOutDevice();
              window.location.href = signInUrl('/');
            }}
          >
            <GoogleMark />
            換一個 Google 帳號
          </button>
        </div>
      ) : (
        <a className="google-btn" href={signInUrl()}>
          <GoogleMark />
          使用 Google 帳號登入
        </a>
      )}
      <ul className="features">
        <li>
          <span className="ic">
            <Icon.pill />
          </span>
          <span>
            <strong>吃藥不漏</strong>拍藥袋排好時間，到點提醒、打勾記錄
          </span>
        </li>
        <li>
          <span className="ic" style={tint('var(--amber-soft)', 'var(--amber)')}>
            <Icon.thermometer />
          </span>
          <span>
            <strong>病況有記錄</strong>身體狀況、體溫，回診時一目了然
          </span>
        </li>
        <li>
          <span className="ic" style={tint('var(--otter-soft)', 'var(--otter)')}>
            <Icon.chat />
          </span>
          <span>
            <strong>隨時問 Dr.水獺</strong>打字或用說的，幫忙記錄、整理
          </span>
        </li>
      </ul>
      <p className="fine">
        <Icon.key />
        只有家人的 Google 帳號進得來
      </p>
    </LoginLayout>
  );
}
