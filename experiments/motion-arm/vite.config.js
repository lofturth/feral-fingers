import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

export default defineConfig(({ command }) => {
  const cert = process.env.MOTION_HTTPS_CERT
  const key = process.env.MOTION_HTTPS_KEY
  if (command === 'serve' && (!cert || !key)) throw new Error('Set MOTION_HTTPS_CERT and MOTION_HTTPS_KEY to trusted certificate files')
  return {
    server: {
      host: '0.0.0.0', port: 5186, strictPort: true,
      https: command === 'serve' ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined,
      proxy: { '/motion-relay': { target: 'ws://127.0.0.1:8784', ws: true } },
      hmr: false, allowedHosts: true,
    },
  }
})
