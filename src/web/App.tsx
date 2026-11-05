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
import { useInstallApp } from './installApp';
import { useMovedNotice } from './moved';
import { useNewRelease } from './version';

// 3D 醫生（three.js）比較大，進 Dr.Claude 頁才載入
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
      <div className="login">
        <div className="login-card">
          <div className="logo">
            <OtterFace size={64} />
          </div>
          <h1 style={{ fontSize: '1.375rem' }}>連不上家庭醫生</h1>
          <p className="lead">{gate.message}</p>
          <button className="btn lg block" style={{ marginTop: 22 }} onClick={() => void loadMe()}>
            再試一次
          </button>
        </div>
      </div>
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
          {!full && <MovedNotice />}
          <Suspense
            fallback={
              full ? (
                <div className="boot" role="status">
                  <div className="logo">
                    <OtterFace size={48} />
                  </div>
                  Dr.Claude 走進診間…
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
          Dr.Claude
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
          Dr.Claude
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

/** 從舊網址轉過來的：提醒重新加到主畫面（src/web/moved.ts） */
function MovedNotice() {
  const [show, dismiss] = useMovedNotice();
  const install = useInstallApp();
  if (!show) return null;
  const how = !install.offer
    ? '之後請直接開這個網址。'
    : install.platform === 'ios'
      ? '請按 Safari 下方的「分享」→「加入主畫面」，再把舊的圖示刪掉。'
      : '請按右上角「⋮」→「加到主畫面」，再把舊的圖示刪掉。';
  return (
    <div className="page wide">
      <div className="release" role="status">
        <Icon.download />
        <div className="grow">
          <strong>家庭醫生搬到新網址了</strong>
          <span>
            新網址是 doctor.nathantw.com，資料都在。{how}吃藥提醒有開的話，要在設定頁重新開一次。
          </span>
        </div>
        {install.canPrompt && (
          <button className="btn sm" onClick={() => void install.promptInstall()}>
            安裝
          </button>
        )}
        <button className="btn sm ghost" onClick={dismiss}>
          知道了
        </button>
      </div>
    </div>
  );
}

const tint = (bg: string, ink: string) => ({ ['--tint' as string]: bg, ['--tint-ink' as string]: ink }) as CSSProperties;

function SignIn({ denied }: { denied?: string }) {
  const [moved] = useMovedNotice();
  return (
    <div className="login">
      <div className="login-card">
        <div className="logo">
          <OtterFace size={68} />
        </div>
        <h1>家庭醫生</h1>
        <p className="lead">全家人的看診、用藥與身體狀況，都記在這裡。</p>
        <ul className="features">
          <li>
            <span className="ic">
              <Icon.pill />
            </span>
            拍藥袋自動排好吃藥時間，按時提醒
          </li>
          <li>
            <span className="ic" style={tint('var(--amber-soft)', 'var(--amber)')}>
              <Icon.thermometer />
            </span>
            身體狀況、體溫，回診時一目了然
          </li>
          <li>
            <span className="ic" style={tint('var(--otter-soft)', 'var(--otter)')}>
              <Icon.chat />
            </span>
            有問題就問 Dr.Claude，打字或用說的
          </li>
        </ul>
        {denied ? (
          <div className="stack sm">
            <div className="alert warn" style={{ textAlign: 'left' }}>
              <Icon.alert />
              <div>{denied}</div>
            </div>
            <button
              className="btn secondary lg block"
              onClick={async () => {
                await signOutDevice();
                window.location.href = signInUrl('/');
              }}
            >
              換一個 Google 帳號
            </button>
          </div>
        ) : (
          <div className="stack sm">
            {moved && (
              <div className="alert info" style={{ textAlign: 'left' }}>
                <Icon.info />
                <div>家庭醫生搬到新網址了，資料都在。請用 Google 帳號重新登入一次。</div>
              </div>
            )}
            <a className="btn lg block" href={signInUrl()}>
              <Icon.user />
              用 Google 帳號登入
            </a>
          </div>
        )}
        <p className="fine">只有家人的帳號進得來</p>
      </div>
    </div>
  );
}
