import express from 'express'
import dotenv from 'dotenv'
import fetch from 'node-fetch'
import { startBot } from './bot.js'

dotenv.config()
const app = express()
app.use(express.json())

const PORT = process.env.PORT || 10000
const SELF_URL = process.env.SELF_URL
const KEEPALIVE_MINUTES = Number(process.env.KEEPALIVE_MINUTES || 10)
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || ''
const N8N_SECRET = process.env.N8N_SECRET || ''
const BOT_OWNER = process.env.BOT_OWNER || ''

app.get('/', (_, res) => res.status(200).send('WhatsApp bot is running ✅'))

app.post('/command', async (req, res) => {
  try {
    const { secret, remoteJid, text } = req.body || {}
    if (secret !== N8N_SECRET) return res.status(403).json({ ok: false })
    if (global.sock) await global.sock.sendMessage(remoteJid, { text: text || 'OK' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

if (SELF_URL) {
  setInterval(async () => { try { await fetch(SELF_URL) } catch {} }, KEEPALIVE_MINUTES * 60 * 1000)
}

startBot({ n8nWebhookUrl: N8N_WEBHOOK_URL, n8nSecret: N8N_SECRET, botOwner: BOT_OWNER })
  .then(sock => { global.sock = sock })
  .catch(err => console.error('Bot start error:', err))

app.listen(PORT, () => console.log(`Server up on :${PORT}`))
