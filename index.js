require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SECRET = process.env.SECRET ?? 'yyehfu34hg67h5';
const PORT = process.env.PORT ?? 3000;

const app = express();
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
  console.log('Webhook received');

  const environment = { ...process.env };

  /** Delete all custom envs of PM2 to override */
  delete environment.PORT;

  const deploy = spawn('bash', ['./shared/deploy.sh'], {
  stdio: 'inherit',
  env: {
    ...environment,
    GIT_TRACE: '1',
    GIT_CURL_VERBOSE: '1',
    GIT_TERMINAL_PROMPT: '0', 
    GIT_ASKPASS: 'echo',
  }});


  deploy.on('close', code => {
    if (code === 0) {
      console.log('Deployment complete');
      res.status(200).send('Deployment complete');
    } else {
      console.error(`Deployment failed with code ${code}`);
      res.status(500).send(`Deployment failed with code ${code}`);
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening for webhooks on port ${PORT}`);
});
