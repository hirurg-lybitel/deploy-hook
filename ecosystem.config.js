module.exports = {
  apps: [
    {
      name: 'webhook-listener',
      script: 'index.js',
      watch: true,
      ignore_watch: [
        'repos',
        'node_modules',
      ],
      env: {
        ...process.env,
      },
    }
  ]
}
