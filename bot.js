import baileys, {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';

// The main function to start the bot
export const startBot = async () => {
    // 'auth_info' is the folder where session data will be saved
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    // Use baileys.default to access makeWASocket
    const sock = baileys.default({
        version: (await fetchLatestBaileysVersion()).version,
        auth: state,
        printQRInTerminal: false, // Important: Disable QR code printing
        browser: ['My-WhatsApp-Bot', 'Chrome', '110.0.0'],
        logger: pino({ level: 'silent' }),
    });

    // --- Pairing Code Logic (No changes here) ---
    // If there is no registered session, we will request a pairing code
    if (!sock.authState.creds.registered) {
        // Get the phone number from environment variables
        const phoneNumber = process.env.BOT_NUMBER;
        
        // Ensure the number is set
        if (!phoneNumber) {
            console.error('Error: Phone number not found. Please set the BOT_NUMBER environment variable on Render.');
            return;
        }

        console.log(`⏳ Requesting pairing code for number: ${phoneNumber}`);
        
        // Request the pairing code from WhatsApp
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n✅ Your pairing code is: ${code}\n`);
                console.log("Open WhatsApp on your phone > Linked Devices > Link a device > Link with phone number instead, and enter the code.");
            } catch (error) {
                console.error('Failed to request pairing code:', error);
            }
        }, 3000); // A small delay to ensure a stable connection
    }
    // -----------------------------------------

    // Connection update event
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('✅ WhatsApp connected!');
        }
        if (connection === 'close') {
            console.log('❌ Connection closed:', lastDisconnect?.error?.message);
        }
    });
    
    // Save session data event
    sock.ev.on('creds.update', saveCreds);

    // New message event
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const sender = msg.key.remoteJid;
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text;

        console.log(`💬 New message from ${sender}: ${messageText}`);

        // Simple example for auto-reply
        if (messageText === '!ping') {
            await sock.sendMessage(sender, { text: 'pong' });
        }
    });

    // Return sock to allow server.js to use it if needed
    return sock;
};
