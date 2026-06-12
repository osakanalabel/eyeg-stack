import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { authRouter, requireAuth } from './auth/router.js';
import { memosRouter } from './memos/router.js';
import { labelsRouter } from './labels/router.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // nginx の背後で req.ip / req.secure を正しく扱う

// 写真 base64（最大4枚 × 〜2MB）を見込んだ上限
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/memos', requireAuth, memosRouter);
app.use('/api/labels', requireAuth, labelsRouter);

// ローカル開発用: nginx なしで web/ を直接配信（SERVE_STATIC=1）
if (config.serveStatic) {
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web');
  app.use(express.static(webDir));
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Not Found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'サーバエラーが発生しました' });
});

app.listen(config.port, () => {
  console.log(`EyeG-Stack API listening on :${config.port}`);
});
