/**
 * Lightweight deploy webhook for Krawings Portal.
 * Listens for GitHub push events on port 9000.
 * Validates webhook secret, runs deploy script.
 *
 * Setup (one-time):
 *   1. npm install (in /opt/krawings-portal/deploy)
 *   2. Set DEPLOY_SECRET env var (match GitHub webhook secret)
 *   3. systemctl enable --now krawings-deploy
 *   4. Add webhook in GitHub: https://test18ee.krawings.de:9000/deploy
 */
const http = require('http');
const crypto = require('crypto');
const { execSync } = require('child_process');

const PORT = 9000;
const SECRET = process.env.DEPLOY_SECRET || 'krawings-deploy-2026';
const PROJECT_DIR = '/opt/krawings-portal';
const SERVICE_NAME = 'krawings-portal';

function verifySignature(payload, signature) {
  if (!signature) return false;
  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(payload);
  const expected = 'sha256=' + hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function deploy() {
  const log = [];
  const run = (cmd) => {
    log.push(`$ ${cmd}`);
    try {
      const out = execSync(cmd, { cwd: PROJECT_DIR, timeout: 120000, encoding: 'utf8' });
      log.push(out.trim());
    } catch (e) {
      log.push(`ERROR: ${e.message}`);
      throw e;
    }
  };

  run('git pull origin main');
  run('npm run build');
  run(`systemctl restart ${SERVICE_NAME}`);

  return log.join('\n');
}

const server = http.createServer((req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: SERVICE_NAME }));
    return;
  }

  // Status check (no auth needed)
  if (req.method === 'GET' && req.url === '/status') {
    try {
      const status = execSync(`systemctl is-active ${SERVICE_NAME}`, { encoding: 'utf8' }).trim();
      const commit = execSync('git log -1 --format="%h %s" 2>/dev/null', { cwd: PROJECT_DIR, encoding: 'utf8' }).trim();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status, commit }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Deploy endpoint
  if (req.method === 'POST' && req.url === '/deploy') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      // Verify GitHub signature
      const sig = req.headers['x-hub-signature-256'];
      if (!verifySignature(body, sig)) {
        console.log(`[${new Date().toISOString()}] Invalid signature`);
        res.writeHead(403);
        res.end('Invalid signature');
        return;
      }

      // Only deploy on push to main
      try {
        const payload = JSON.parse(body);
        if (payload.ref && payload.ref !== 'refs/heads/main') {
          res.writeHead(200);
          res.end('Skipped (not main branch)');
          return;
        }
      } catch (e) { /* not JSON, still deploy */ }

      console.log(`[${new Date().toISOString()}] Deploy triggered`);
      try {
        const log = deploy();
        console.log(log);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Deploy successful\n' + log);
      } catch (e) {
        console.error(`Deploy failed: ${e.message}`);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Deploy failed\n' + e.message);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Deploy webhook listening on port ${PORT}`);
});
