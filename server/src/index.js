import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import './db.js';
import api from './routes/index.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mapProvider: config.mapProvider, ai: Boolean(config.llm.apiKey) });
});

app.use('/api', api);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port} (MAP_PROVIDER=${config.mapProvider})`);
  });
}

export default app;
