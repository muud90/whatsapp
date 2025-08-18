// استيراد Baileys بالطريقة الدفاعية
import * as Baileys from '@whiskeysockets/baileys'
const makeWASocket = Baileys.default ?? Baileys.makeWASocket
const { useMultiFileAuthState, jidNormalizedUser, fetchLatestBaileysVersion } = Baileys
import qrcode from 'qrcode-terminal'
import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import { Redis } from '@upstash/redis'
// … (بقية الكود كما فى النسخة المصححة التى زودتك بها سابقاً)

// إنشاء الـ socket بدون printQRInTerminal
const sock = makeWASocket({
  version,
  auth: state,
  syncFullHistory: false
})

// طباعة الـ QR عند التحديث
sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
  if (qr) qrcode.generate(qr, { small: true })
  if (connection === 'open') console.log('✅ WhatsApp connected.')
  if (connection === 'close') console.log('❌ connection closed:', lastDisconnect?.error?.message)
})

// مثال على تصحيح النص الترحيبى:
sock.ev.on('group-participants.update', async (ev) => {
  if (ev.action === 'add') {
    const names = ev.participants.map(jid => jidNormalizedUser(jid).split('@')[0]).join(', ')
    await sock.sendMessage(ev.id, { text: `مرحبًا ${names} 👋 نورتوا القروب!` })
  }
})
// بقية الدوال كما فى النسخة المصححة…
