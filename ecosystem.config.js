module.exports = {
  apps: [
    {
      name: 'webhook-listener',
      script: 'index.js',
      watch: true,
      ignore_watch: [
        'node_modules'
      ],
      env: {
        ...process.env,
      },
    }
  ]
}
