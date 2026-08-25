require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('node:crypto');
const { spawn, exec } = require('node:child_process');

/* SECRET - секретный ключ для подписи вебхуков */
const SECRET = process.env.SECRET ?? 'yyehfu34hg67h5';
/* PORT - порт, на котором запускается deploy сервер */
const PORT = process.env.PORT ?? 3000;
const NAYTRON_ORIGIN = 'https://developer.naytron.dev';

const PM2_PUBLIC_KEY = process.env.IN_PM2_PUBLIC_KEY
const PM2_SECRET_KEY = process.env.IN_PM2_SECRET_KEY

/**
 * Формирует окружение для скрипта деплоя в зависимости от типа.
 * Базово берём окружение процесса, но вычищаем PM2/Keymetrics и PORT,
 * а затем добавляем только нужные переменные для конкретного типа деплоя.
 */
function buildEnvForDeploy({ deployType, domain, port, dbHost, dbPort, seedApiKeyPlaintext }) {
  const baseEnv = { ...process.env };

  // Не даём наследоваться служебным переменным,
  // которые должны устанавливаться только централизованно
  delete baseEnv.PORT;
  delete baseEnv.PM2_PUBLIC_KEY;
  delete baseEnv.PM2_SECRET_KEY;
  delete baseEnv.KEYMETRICS_PUBLIC;
  delete baseEnv.KEYMETRICS_SECRET;

  const gitEnv = {
    GIT_TRACE: '1',
    GIT_CURL_VERBOSE: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
  };

  // Naytron (центральный и клиентские инстансы)
  const isCentralNaytron = deployType === 'naytron';

  const naytronEnv = {
    DOMAIN: domain,
    ...(dbHost != null && { DB_HOST: dbHost }),
    ...(dbPort != null && { DB_PORT: dbPort }),
    ...(seedApiKeyPlaintext != null && { SEED_API_KEY_PLAINTEXT: seedApiKeyPlaintext }),
    DB_CONTAINER_NAME: domain ? `mongodb.${domain}` : 'mongodb',
    PORT: port,
    CONTAINER_NAME: domain ? `naytron-server-${domain}` : 'naytron-server',
    COMPOSE_PROJECT_NAME: domain ? `naytron-${domain}` : 'naytron',
    DB_VOLUME_NAME: `${domain ? `naytron-${domain}` : 'naytron'}.mongodb`,
    NEXTAUTH_URL: `https://${domain ?? 'developer'}.naytron.dev`,
  };

  // TG_BOT_TOKEN для naytron подмешивается из shared/envs/naytron/.env.central в deploy.naytron.sh
  const centralOnlyEnv = isCentralNaytron
    ? {
        IS_CENTRAL_DB: 'true',
        PM2_PUBLIC_KEY,
        PM2_SECRET_KEY,
      }
    : {};

  return {
    ...baseEnv,
    ...gitEnv,
    ...naytronEnv,
    ...centralOnlyEnv,
  };
}

const app = express();
app.use(bodyParser.raw({ type: 'application/json' }));
app.use(bodyParser.json({ verify: verifySignature }));

function verifySignature(req, res, buf) {
  const signature = req.get('X-Hub-Signature-256');
  if (!signature) throw new Error('No signature found');

  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(buf);
  const expected = `sha256=${hmac.digest('hex')}`;

  if (signature !== expected) {
    throw new Error('Invalid signature');
  }
}

app.post('/webhook', (req, res) => {
  try {
    /** Deploy type 'naytron' | 'client' */
  const delpoyType = req.query.type;
  console.log('Webhook Deployment Type:', delpoyType);

  const payload = Object.keys(req.body).length > 0 ? JSON.parse(req.body.toString()) : {};

  if (delpoyType !== 'client' && 
      payload.ref !== 'refs/heads/master' && payload.ref !== 'refs/heads/main') {
    console.log('Ignored - not master/main branch', payload.ref);
    return res.status(200).json({ ignored: true, message: 'Ignored - not master/main branch' });
  }

  if (delpoyType === 'client' &&
    payload.gitBranch !== 'master' && payload.gitBranch !== 'main') {
    console.log('Ignored - not master/main branch', payload.gitBranch);
    return res.status(200).json({ ignored: true, message: 'Ignored - not master/main branch' });
  }
  res.status(202).json({ received: true });

  const domain = payload?.env?.domain;
  const port = payload?.env?.port;
  const dbHost = payload?.env?.dbHost;
  const dbPort = payload?.env?.dbPort;
  const seedApiKeyPlaintext = payload?.env?.SEED_API_KEY_PLAINTEXT;

  const scriptName = (() => {
    switch (delpoyType) {
      case 'naytron':
        return 'deploy.naytron.sh';
      case 'client': 
        return 'deploy.client.sh'
      default:
        return '';
    }
  })();

  if (!scriptName) {
    throw new Error("Unrecognised repository webhook")
  }

  const deployStart = Date.now();
  const env = buildEnvForDeploy({
    deployType: delpoyType,
    domain,
    port,
    dbHost,
    dbPort,
    seedApiKeyPlaintext,
  });

  const deploy = spawn('bash', [`./shared/${scriptName}`], {
  stdio: 'inherit',
  env: {
    ...env,
  }});


  deploy.on('close', async code => {
    const elapsedMs = Date.now() - deployStart;
    const elapsedSec = Math.floor(elapsedMs / 1000);
    const elapsedMin = Math.floor(elapsedSec / 60);
    const elapsedStr = elapsedMin > 0
      ? `${elapsedMin}m ${elapsedSec % 60}s`
      : `${elapsedSec}s`;

    if (code === 0) {
      console.log(`Webhook Deployment complete (elapsed: ${elapsedStr})`);

      if (delpoyType === 'naytron') {
        try {
          console.log('Waiting for central naytron to become healthy...');
          const healthResponse = await fetchWithRetry(`${NAYTRON_ORIGIN}/api/health`, { method: 'GET' }, {
            maxAttempts: 30,
            initialDelayMs: 5000,
            maxDelayMs: 15000,
          });

          if (!healthResponse.ok) {
            console.error('Central naytron health check failed', healthResponse.status);
            return;
          }

          console.log('Central naytron is healthy, triggering child containers update...');

          const headers = {
            'Content-Type': 'application/json',
            'X-Hub-Signature-256': req.get('X-Hub-Signature-256'),
            'X-GitHub-Event': req.get('X-GitHub-Event'),
            'X-GitHub-Delivery': req.get('X-GitHub-Delivery'),
          };

          const rawBody = JSON.stringify(payload);

          const response = await fetchWithRetry(`${NAYTRON_ORIGIN}/api/deploy/webhook`, {
            method: 'POST',
            headers,
            body: rawBody,
          }, {
            maxAttempts: 3,
            initialDelayMs: 1000,
          });

          if (response.ok) {
            const data = await response.json();
            console.log(`Triggered child containers update successfully. Workspaces number: ${data.totalWorkspaces}`);
          } else {
            console.error('Failed to trigger child containers update', response.status);
          }
        } catch (err) {
          console.error('Error triggering child containers update', err);
        }
      }

      // res.end(JSON.stringify({ success: true, message: 'Deployment complete' }));
    } else {
      console.error(`Webhook Deployment failed with code ${code} (elapsed: ${elapsedStr})`);
      // res.end(JSON.stringify({ success: false, error: `Deployment failed with code ${code}` }));
    }
  });
  } catch (error) {
    console.error('Webhook Deployment failed', error);
    // res.end(JSON.stringify({ success: false, error: error.message }));    
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening for webhooks on port ${PORT}`);
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const RETRYABLE_HTTP_STATUSES = new Set([502, 503, 504]);

/**
 * HTTP-запрос с повторами при 502/503/504 и сетевых ошибках (пока сервис поднимается после рестарта).
 */
async function fetchWithRetry(url, options, {
  maxAttempts = 15,
  initialDelayMs = 3000,
  maxDelayMs = 30000,
  backoffFactor = 1.5,
} = {}) {
  let waitMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.ok || !RETRYABLE_HTTP_STATUSES.has(response.status) || attempt === maxAttempts) {
        return response;
      }

      console.warn(
        `Request to ${url} returned ${response.status} (attempt ${attempt}/${maxAttempts}), retrying in ${waitMs}ms...`
      );
    } catch (err) {
      if (attempt === maxAttempts) throw err;

      console.warn(
        `Request to ${url} failed (attempt ${attempt}/${maxAttempts}): ${err.message}, retrying in ${waitMs}ms...`
      );
    }

    await delay(waitMs);
    waitMs = Math.min(Math.round(waitMs * backoffFactor), maxDelayMs);
  }
}