import {
    default as makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';

// الدالة الرئيسية لتشغيل البوت
export const startBot = async () => {
    // 'auth_info' هو المجلد الذي سيتم حفظ بيانات الجلسة فيه
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        version: (await fetchLatestBaileysVersion()).version,
        auth: state,
        printQRInTerminal: false, // مهم: تعطيل طباعة الـ QR Code
        browser: Browsers.macOS('Desktop'),
        logger: pino({ level: 'silent' }),
    });

    // --- الجزء الأهم: التعامل مع رمز الاقتران ---
    // إذا لم تكن هناك جلسة مسجلة، سنطلب رمز اقتران
    if (!sock.authState.creds.registered) {
        // احصل على رقم الهاتف من متغيرات البيئة
        const phoneNumber = process.env.BOT_NUMBER;
        
        // التأكد من وجود الرقم
        if (!phoneNumber) {
            console.error('خطأ: لم يتم العثور على رقم الهاتف. الرجاء تعيين متغير البيئة BOT_NUMBER على Render.');
            return;
        }

        console.log(`⏳ جاري طلب رمز الاقتران للرقم: ${phoneNumber}`);
        
        // اطلب رمز الاقتران من واتساب
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n✅ رمز الاقتران الخاص بك هو: ${code}\n`);
                console.log("افتح واتساب على هاتفك > الأجهزة المرتبطة > ربط جهاز > الربط برقم الهاتف بدلاً من ذلك، وأدخل الرمز.");
            } catch (error) {
                console.error('فشل طلب رمز الاقتران:', error);
            }
        }, 3000); // تأخير بسيط لضمان استقرار الاتصال
    }
    // -----------------------------------------

    // حدث تحديث الاتصال
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('✅ WhatsApp connected!');
        }
        if (connection === 'close') {
            console.log('❌ Connection closed:', lastDisconnect?.error?.message);
            // يمكنك إضافة منطق إعادة الاتصال هنا إذا أردت
        }
    });
    
    // حدث حفظ بيانات الجلسة
    sock.ev.on('creds.update', saveCreds);

    // حدث وصول رسالة جديدة
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const sender = msg.key.remoteJid;
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text;

        console.log(`💬 رسالة جديدة من ${sender}: ${messageText}`);

        // مثال بسيط للرد
        if (messageText === '!ping') {
            await sock.sendMessage(sender, { text: 'pong' });
        }
    });

    // إرجاع sock للسماح لـ server.js باستخدامه إذا لزم الأمر
    return sock;
};
