require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { spawn, exec } = require('child_process');

const SECRET = process.env.SECRET ?? 'yyehfu34hg67h5';
const PORT = process.env.PORT ?? 3000;
const MAIN_CONTAINER_PORT = process.env.MAIN_CONTAINER_PORT;
const MAIN_DB_HOST = "93.84.115.54";
const MAIN_DB_PORT = process.env.MAIN_DB_PORT;

const PM2_PUBLIC_KEY = process.env.IN_PM2_PUBLIC_KEY
const PM2_SECRET_KEY = process.env.IN_PM2_SECRET_KEY

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
    /** Deploy type 'main' | 'client | 'crm' */
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
  const port = payload?.env?.port ?? MAIN_CONTAINER_PORT;
  const dbHost = payload?.env?.dbHost ?? MAIN_DB_HOST;
  const dbPort = payload?.env?.dbPort ?? MAIN_DB_PORT;
  const environment = { ...process.env };

  /** Delete all custom envs of PM2 to override */
  delete environment.PORT;

  const scriptName = (() => {
    switch (delpoyType) {
      case 'king':
        return 'deploy.king.sh';
      case 'king-test':
        return 'deploy.king.test.sh';
      case 'client': 
        return 'deploy.client.sh'
      case 'crm':
        return 'deploy.crm.sh'
      case 'crm-test':
        return 'deploy.crm.test.sh'
      default:
        return '';
    }
  })();

  if (!scriptName) {
    throw new Error("Unrecognised repository webhook")
  }

  const deploy = spawn('bash', [`./shared/${scriptName}`], {
  stdio: 'inherit',
  env: {
    ...environment,
    GIT_TRACE: '1',
    GIT_CURL_VERBOSE: '1',
    GIT_TERMINAL_PROMPT: '0', 
    GIT_ASKPASS: 'echo',
    ...((scriptName !== 'deploy.crm.sh' && 
         scriptName !== 'deploy.crm.test.sh') && {
      DOMAIN: domain,
      DB_HOST: dbHost,
      DB_PORT: dbPort,
      DB_CONTAINER_NAME: domain ? `mongodb.${domain}` : 'mongodb',
      PORT: delpoyType === 'king-test' ? 61081 : port,
      CONTAINER_NAME: domain ? `king-server-${domain}` : 'king-pos-server',    
      COMPOSE_PROJECT_NAME: domain ? `king-pos-${domain}` : 'king-pos',
      DB_VOLUME_NAME: `${domain ? `king-pos-${domain}` : 'king-pos'}.mongodb`,
      NEXTAUTH_URL: `https://${domain ?? 'king-pos'}.gdmn.app`,
      ...(delpoyType === 'king'
        ? {
          IS_CENTRAL_DB: 'true',
          PM2_PUBLIC_KEY,
          PM2_SECRET_KEY
        } : {})
      // NEXT_PUBLIC_DOMAIN: `${domain ?? 'king-pos'}.gdmn.app`
    })
  }});


  deploy.on('close', async code => {
    if (code === 0) {
      console.log('Webhook Deployment complete');

      if (delpoyType === 'king') {
        await delay(5000);
        try {
          const headers = {
            'Content-Type': 'application/json',
            'X-Hub-Signature-256': req.get('X-Hub-Signature-256'),
            'X-GitHub-Event': req.get('X-GitHub-Event'),
            'X-GitHub-Delivery': req.get('X-GitHub-Delivery'),
          };

          const rawBody = JSON.stringify(payload);

          const response = await fetch('https://king-pos.gdmn.app/api/deploy/webhook', {
            method: 'POST',
            headers,
            body: rawBody
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
      console.error(`Webhook Deployment failed with code ${code}`);
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