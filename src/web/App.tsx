import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import type { Me, Member } from '../shared/apiTypes';
import { api, ApiRequestError, onAuthLost, signInUrl, signOutDevice } from './api';
import { Icon, Loading, OtterFace } from './components/ui';
import { SessionContext } from './hooks';
import { MemberPage, MembersPage } from './pages/MembersPage';
import { SettingsPage } from './pages/SettingsPage';
import { TimelinePage } from './pages/TimelinePage';
import { TodayPage } from './pages/TodayPage';
import { VisitEditPage, VisitPage } from './pages/VisitPages';
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

  if (gate.state === 'loading') return <Loading />;
  if (gate.state === 'signin') return <SignIn />;
  if (gate.state === 'denied') return <SignIn denied={gate.message} />;
  if (gate.state === 'error')
    return (
      <div className="login">
        <div className="stack" style={{ maxWidth: 380 }}>
          <div className="error">{gate.message}</div>
          <button className="btn" onClick={() => void loadMe()}>
            再試一次
          </button>
        </div>
      </div>
    );

  return (
    <SessionContext.Provider value={{ me: gate.me, members, reloadMembers, reloadMe: () => void loadMe() }}>
      <Shell />
    </SessionContext.Provider>
  );
}

function Shell() {
  const release = useNewRelease();
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return (
    <>
      <div className="app">
        {release && (
          <div className="notice" style={{ marginBottom: 12 }}>
            有新版本了。{' '}
            <button className="btn small ghost" onClick={() => window.location.reload()}>
              重新整理
            </button>
          </div>
        )}
        <Suspense fallback={<Loading text="Dr.Claude 走進診間…" />}>
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
            <Route path="*" element={<div className="empty">找不到這一頁</div>} />
          </Routes>
        </Suspense>
      </div>
      <TabBar />
    </>
  );
}

function TabBar() {
  const tab = (to: string, label: string, icon: React.ReactNode, end = false) => (
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
          <span className="badge-otter">
            <OtterFace size={40} />
          </span>
          Dr.Claude
        </NavLink>
        {tab('/visits/new', '看診', <Icon.visit />)}
        {tab('/family', '家人', <Icon.family />)}
      </nav>
    </div>
  );
}

function SignIn({ denied }: { denied?: string }) {
  return (
    <div className="login">
      <div className="sheet">
        <div className="sheet-head">
          <h1 style={{ fontSize: '1.3rem' }}>家庭醫生</h1>
          <span className="meta">家人專用</span>
        </div>
        <div className="sheet-body">
          <div className="row" style={{ justifyContent: 'center', margin: '8px 0 4px' }}>
            <OtterFace size={88} />
          </div>
          <div className="form-lines">
            <div>□ 看診、藥袋、吃藥打勾</div>
            <div>□ 身體狀況、體溫</div>
            <div>□ 問 Dr.Claude</div>
          </div>
          {denied ? (
            <div className="stack">
              <div className="notice">{denied}</div>
              <button
                className="btn quiet block"
                onClick={async () => {
                  await signOutDevice();
                  window.location.href = signInUrl('/');
                }}
              >
                換一個 Google 帳號
              </button>
            </div>
          ) : (
            <a className="btn block" href={signInUrl()}>
              用 Google 帳號登入
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
