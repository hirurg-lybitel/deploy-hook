# deploy-hook

A simple Node.js server for automating deployments via webhooks (e.g., from GitHub or GitLab).

## Purpose
- Accepts POST requests at the `/webhook` endpoint.
- Verifies the request signature (HMAC SHA256).
- On successful verification, runs a shell script (for deployment or updating containers).

## Quick Start
1. Install dependencies:
   ```sh
   npm install
   ```
2. Create a `.env` file with variables:
   ```env
   SECRET=your_webhook_secret
   PORT=60112
   ```
3. Start the server:
   ```sh
   node index.js
   ```
4. Configure your service (e.g., GitHub) to send webhooks to:
   ```
   http://<your_server>:<PORT>/webhook
   ```
