require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { exec } = require('child_process');

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

  exec('bash ./shared/script.sh', (err, stdout, stderr) => {
    if (err) {
      console.error(stderr);
      return res.status(500).send('Deployment failed');
    }

    console.log(stdout);
    res.status(200).send('Deployment complete');
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening for webhooks on port ${PORT}`);
});
