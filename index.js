require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SECRET = process.env.SECRET ?? 'yyehfu34hg67h5';
const PORT = process.env.PORT ?? 3000;
const MAIN_CONTAINER_PORT = process.env.MAIN_CONTAINER_PORT;
const MAIN_DB_PORT = process.env.MAIN_DB_PORT;

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
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.flushHeaders();

  try {
    /** Deploy type 'main' | 'client | 'crm' */
  const delpoyType = req.query.type;

  const body = Object.keys(req.body).length > 0 ? JSON.parse(req.body.toString()) : {};
  const domain = body?.env?.domain;
  const port = body?.env?.port ?? MAIN_CONTAINER_PORT;
  const dbPort = body?.env?.dbPort ?? MAIN_DB_PORT;

  const environment = { ...process.env };

  /** Delete all custom envs of PM2 to override */
  delete environment.PORT;

  const scriptName = (() => {
    switch (delpoyType) {
      case 'king':
        return 'deploy.king.sh';
      case 'client': 
        return 'deploy.client.sh'
      case 'crm':
        return 'deploy.crm.sh'
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
    ...(scriptName !== 'deploy.crm.sh' && {
      DOMAIN: domain,
      DB_PORT: dbPort,
      DB_CONTAINER_NAME: domain ? `mongodb.${domain}` : 'mongodb',
      PORT: port,
      CONTAINER_NAME: domain ? `king-server-${domain}` : 'king-pos-server',    
      COMPOSE_PROJECT_NAME: domain ? `king-server-${domain}` : 'king-pos-server',
      NEXTAUTH_URL: `https://${domain ?? 'king-pos'}.gdmn.app`,
    })
  }});


  deploy.on('close', code => {
    if (code === 0) {
      console.log('Webhook Deployment complete');
      res.end(JSON.stringify({ success: true, message: 'Deployment complete' }));
    } else {
      console.error(`Webhook Deployment failed with code ${code}`);
      res.end(JSON.stringify({ success: false, error: `Deployment failed with code ${code}` }));
    }
  });
  } catch (error) {
    console.error('Webhook Deployment failed', error);
    res.end(JSON.stringify({ success: false, error: error.message }));    
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening for webhooks on port ${PORT}`);
});
