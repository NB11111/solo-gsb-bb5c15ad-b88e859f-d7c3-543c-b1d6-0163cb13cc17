import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { analyze } from './balancing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const DIST_DIR = process.env.STATIC_DIR || join(__dirname, '../../web/dist');

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'centrifuge-balance' });
});

app.post('/api/balance', (req, res) => {
  try {
    res.json(analyze(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  // SPA 回退
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(join(DIST_DIR, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(503)
      .send(
        '前端尚未构建（web/dist 不存在）。请先运行 npm run build，或分别启动前后端开发服务。',
      );
  });
}

app.listen(PORT, () => {
  console.log(`centrifuge-balance server listening on :${PORT}`);
});
