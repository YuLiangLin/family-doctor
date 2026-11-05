// Worker 入口：/api/* 是 JSON API（經 Cloudflare Access 驗證），其餘交給靜態資源（React SPA）；
// scheduled 是吃藥提醒（wrangler.toml 的 crons，對應 shared/meds.ts 的 SLOTS）。
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Me } from '../shared/apiTypes';
import { taipeiNow, taipeiToday } from '../shared/dates';
import { slotAt } from '../shared/meds';
import { authMiddleware, identify, jsonOnlyMiddleware, safeNext } from './auth';
import type { AppEnv, Env } from './env';
import { ApiFailure } from './http';
import { runReminder } from './push';
import { agentRoutes } from './routes/agent';
import { attachmentsRoutes } from './routes/attachments';
import { chatRoutes, scanRoutes } from './routes/chat';
import { measurementsRoutes, notesRoutes, timelineRoutes, todayRoutes } from './routes/journal';
import { dosesRoutes, medicationsRoutes } from './routes/medications';
import { membersRoutes } from './routes/members';
import { pushRoutes } from './routes/push';
import { tokensRoutes } from './routes/tokens';
import { usersRoutes } from './routes/users';
import { visitsRoutes } from './routes/visits';
import { revokeCurrentSession } from './sessions';

function handleError(err: Error, c: Context<AppEnv>) {
  if (err instanceof ApiFailure) return c.json({ error: err.message, details: err.details }, err.status);
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: `系統錯誤：${err.message}` }, 500);
}

const api = new Hono<AppEnv>();
api.use('*', async (c, next) => {
  await next();
  // 健康資料：不給瀏覽器／中間層快取（附件自己設 private）
  if (!c.res.headers.get('Cache-Control')) c.header('Cache-Control', 'no-store');
});
api.use('*', jsonOnlyMiddleware);
// 登入入口：Access 在邊緣先要求 Google 登入，回到這裡時驗過是誰、發系統的登入憑證，再轉回原本那頁
api.get('/auth/login', async (c) => {
  await identify(c);
  return c.redirect(safeNext(c.req.query('next')), 302);
});
api.post('/auth/logout', async (c) => {
  await revokeCurrentSession(c);
  return c.json({ ok: true });
});
api.use('*', authMiddleware);
api.get('/me', (c) => {
  const u = c.get('user');
  const me: Me = { email: u.email, name: u.name, role: u.role, picture: u.picture, superAdmin: u.superAdmin, memberId: u.memberId };
  return c.json(me);
});
api.route('/agent', agentRoutes);
api.route('/users', usersRoutes);
api.route('/tokens', tokensRoutes);
api.route('/members', membersRoutes);
api.route('/visits', visitsRoutes);
api.route('/medications', medicationsRoutes);
api.route('/doses', dosesRoutes);
api.route('/notes', notesRoutes);
api.route('/measurements', measurementsRoutes);
api.route('/today', todayRoutes);
api.route('/timeline', timelineRoutes);
api.route('/attachments', attachmentsRoutes);
api.route('/chat', chatRoutes);
api.route('/scan', scanRoutes);
api.route('/push', pushRoutes);
api.notFound((c) => c.json({ error: '找不到這個 API' }, 404));
api.onError(handleError);

export const app = new Hono<AppEnv>();
app.route('/api', api);
app.onError(handleError);
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    const slot = slotAt(taipeiNow(new Date(controller.scheduledTime)).slice(11, 16));
    if (slot) ctx.waitUntil(runReminder(env, taipeiToday(new Date(controller.scheduledTime)), slot));
  },
} satisfies ExportedHandler<Env>;
