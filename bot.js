// === بداية bot.js (استيراد Baileys بطريقة دفاعية) ===
import * as Baileys from '@whiskeysockets/baileys'
// نلتقط الدالة سواء كانت default أو مسماة
const makeWASocket = Baileys.default ?? Baileys.makeWASocket
const { useMultiFileAuthState, jidNormalizedUser, fetchLatestBaileysVersion } = Baileys

// تحقّق صريح — لو كان في مشكلة سنشوفها بوضوح في اللوج
if (typeof makeWASocket !== 'function') {
  console.error('[Baileys] makeWASocket نوعه:', typeof makeWASocket, '— محتوى Baileys.keys:', Object.keys(Baileys))
  throw new TypeError('makeWASocket not resolved to a function')
}

import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { Redis } from '@upstash/redis'
// ===== إعداد التخزين في Redis لملفات الجلسة =====
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN
    })
  : null

const NS = process.env.REDIS_NAMESPACE || 'wauth:default'
const authDir = path.join(process.cwd(), 'auth')
if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true })

// احفظ ملفات الجلسة في Redis
async function saveAuthToRedis() {
  if (!redis) return
  const files = fs.readdirSync(authDir)
  await redis.set(${NS}:files, files)
  for (const f of files) {
    const full = path.join(authDir, f)
    const buf = fs.readFileSync(full)
    await redis.set(${NS}:file:${f}, buf.toString('base64'))
  }
}

// استرجع ملفات الجلسة من Redis
async function loadAuthFromRedis() {
  if (!redis) return
  try {
    const files = await redis.get(${NS}:files)
    if (!Array.isArray(files) || !files.length) return
    for (const f of files) {
      const b64 = await redis.get(${NS}:file:${f})
      if (!b64) continue
      const full = path.join(authDir, f)
      fs.writeFileSync(full, Buffer.from(b64, 'base64'))
    }
    console.log('[Auth] Restored from Redis snapshot.')
  } catch (e) {
    console.warn('[Auth] Redis restore skipped:', e.message)
  }
}
// عند بدء التشغيل: حاول استعادة الجلسة
await loadAuthFromRedis()

// ===== مساعدات عامة =====
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const isArabic = (s) => /[\u0600-\u06FF]/.test(s || '')

// ===== إعداد السياسات (فلترة/إدارة) =====
const ALLOWED_LINKS = [
  'whatsapp.com', 'youtube.com', 'youtu.be', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com'
]
const BAD_WORDS = [
  'قذر','زباله','تفاهة','عنصري','كلب','حيوان','يا غبي','يا متخلف'
]
const SELF_PROMO_PATTERNS = [
  /تابع\s?ني/i, /ضيف\s?ني/i, /تواصل\s?خاص/i, /بيع\s?متابعين/i, /ربح\s?سريع/i
]

// روابط مريبة = أي http/https ليس ضمن القائمة البيضاء
function isSuspiciousLink(text) {
  const urls = [...(text.match(/https?:\/\/[^\s]+/gi) || [])]
  if (!urls.length) return false
  return urls.some(u => {
    try {
      const host = new URL(u).hostname.replace(/^www\./,'')
      return !ALLOWED_LINKS.some(ok => host.endsWith(ok))
    } catch { return true }
  })
}
function hasInsult(text) {
  const t = (text || '').toLowerCase()
  return BAD_WORDS.some(w => t.includes(w))
}
function hasSelfPromo(text) {
  return SELF_PROMO_PATTERNS.some(rx => rx.test(text))
}

// ===== التفاعل مع القروبات =====
async function isAdmin(sock, groupJid, participantJid) {
  const md = await sock.groupMetadata(groupJid)
  const me = md.participants.find(p => p.id === participantJid)
  return !!(me && (me.admin === 'admin' || me.admin === 'superadmin'))
}
async function isBotAdmin(sock, groupJid) {
  const md = await sock.groupMetadata(groupJid)
  const meId = sock.user?.id
  const me = md.participants.find(p => p.id?.startsWith(meId?.split(':')[0] || ''))
  return !!(me && (me.admin === 'admin' || me.admin === 'superadmin'))
}

export async function startBot({ n8nWebhookUrl, n8nSecret, botOwner }) {
  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  const { version } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    syncFullHistory: false
  })

  sock.ev.on('creds.update', async () => {
    await saveCreds()
    await saveAuthToRedis().catch(()=>{})
  })

  // دفع للأتمتة (n8n) إذا محدد
  const pushToN8n = async (kind, payload) => {
    if (!n8nWebhookUrl) return
    try { await axios.post(n8nWebhookUrl, { kind, payload, n8nSecret }) }
    catch (e) { console.error('n8n push error:', e?.response?.data || e.message) }
  }

  // ترحيب بالمنضمين الجدد
  sock.ev.on('group-participants.update', async (ev) => {
    const { id: groupJid, action, participants } = ev
    await pushToN8n('group-participants.update', ev)
    if (action === 'add') {
      const names = participants.map(jidNormalizedUser).join(', ')
      await sock.sendMessage(groupJid, { text: مرحبًا ${names} 👋 نورتوا القروب! })
    }
  })

  // حذف رسالة (إذا البوت مشرف)
  async function deleteForEveryone(m) {
    try {
      if (!(await isBotAdmin(sock, m.key.remoteJid))) return false
      await sock.sendMessage(m.key.remoteJid, { delete: m.key })
      return true
    } catch (e) {
      console.warn('Delete failed:', e.message)
      return false
    }
  }

  // تحذير المستخدم
  async function warnUser(remoteJid, targetJid, reason) {
    const user = targetJid?.split('@')[0]
    await sock.sendMessage(remoteJid, {
      text: تنبيه: @${user}، رسالتك خالفت سياسة القروب (${reason}). الرجاء الالتزام.,
      mentions: [targetJid]
    })
  }

  // طرد المستخدم (يتطلب أن يكون رقمك/البوت مشرفًا)
  async function kickUser(remoteJid, targetJid) {
    try { await sock.groupParticipantsUpdate(remoteJid, [targetJid], 'remove') }
    catch (e) { console.warn('Kick failed:', e.message) }
  }

  // سجل بسيط لتكرار المخالفات
  const infractions = new Map() // key: <groupJid>:<userJid> => count
  function addInfraction(g, u) {
    const k = ${g}:${u}
    const c = (infractions.get(k) || 0) + 1
    infractions.set(k, c)
    return c
  }

  // ردود الاستفسارات (FAQ)
  const FAQ = [
    { q: /ساعات (العمل|الدوام)/, a: 'ساعات العمل: 9ص–5م من الأحد إلى الخميس.' },
    { q: /(التواصل|الدعم)/, a: 'للتواصل الإداري: أرسل كلمة "دعم" في الخاص، أو تواصل مع المشرف.' },
    { q: /(القواعد|الضوابط)/, a: 'القواعد: ممنوع الروابط المريبة، ممنوع التسويق الذاتي، ممنوع الإساءة. المخالف يُحذَّر ثم يُطرد.' }
  ]

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages?.[0]
    if (!m || !m.message) return
    const remoteJid = m.key?.remoteJid || ''
    const isGroup = remoteJid.endsWith('@g.us')
    const fromJid = m.key?.participant || m.key?.remoteJid
    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      m.message.imageMessage?.caption ||
      m.message.videoMessage?.caption ||
      ''

    await pushToN8n('messages.upsert', {
      remoteJid, from: fromJid, text, isGroup
    })

    // ===== FAQ =====
    if (text) {
      for (const item of FAQ) {
        if (item.q.test(text)) {
          await sock.sendMessage(remoteJid, { text: item.a })
          break
        }
      }
    }

    // ===== أوامر المالك =====
    const ownerJid = ${(process.env.BOT_OWNER || '').replace(/\D/g,'')}@s.whatsapp.net
    const isOwner = fromJid === ownerJid

    if (isGroup) {
      const body = (text || '').trim()

      if (isOwner && body === '!قفل') {
        await sock.groupSettingUpdate(remoteJid, 'announcement')
        await sock.sendMessage(remoteJid, { text: 'تم قفل القروب 🔒' })
        return
      }
      if (isOwner && body === '!فتح') {
        await sock.groupSettingUpdate(remoteJid, 'not_announcement')
        await sock.sendMessage(remoteJid, { text: 'تم فتح القروب 🔓' })
        return
      }
      if (isOwner && body.startsWith('!طرد ')) {
        const num = body.split(' ')[1]?.replace(/\D/g,'')
        if (num) await kickUser(remoteJid, ${num}@s.whatsapp.net)
        return
      }

      // ===== فلترة تلقائية (استثناء المشرفين) =====
      const senderIsAdmin = await isAdmin(sock, remoteJid, fromJid).catch(()=>false)
      if (!senderIsAdmin && text) {
        let reason = ''
        if (isSuspiciousLink(text)) reason = 'روابط مريبة'
        else if (hasSelfPromo(text)) reason = 'تسويق ذاتي مخالف'
        else if (hasInsult(text)) reason = 'ألفاظ مسيئة'

        if (reason) {
          await deleteForEveryone(m) // حذف الرسالة للجميع إن أمكن
          await warnUser(remoteJid, fromJid, reason) // تحذير

          const count = addInfraction(remoteJid, fromJid)
          if (count >= 2) { // عتبة الطرد
            await kickUser(remoteJid, fromJid)
            await sock.sendMessage(remoteJid, { text: 'تم الطرد لتكرار المخالفة.' })
          }
          return
        }
      }
    } else {
      // الخاص
      if ((text || '').toLowerCase() === 'ping') {
        await sock.sendMessage(remoteJid, { text: 'pong ✅' })
      } else if (isArabic(text)) {
        await sock.sendMessage(remoteJid, { text: 'أهلاً! اكتب سؤالك وسأحاول مساعدتك.' })
      } else {
        await sock.sendMessage(remoteJid, { text: 'Hello! Send me your question.' })
      }
    }
  })

  // حفظ دوري للـauth في Redis
  ;(async function periodicSnapshot(){
    while (true) {
      await sleep(60_000)
      await saveAuthToRedis().catch(()=>{})
    }
  })()

  return sock
}
