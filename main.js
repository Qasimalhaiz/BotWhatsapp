const settings = require('./settings');
const { isAdmin } = require('./helpers/isAdmin');
const fs = require('fs');

// Global settings
global.packname = settings.packname;
global.author = settings.author;

// Load auto-replies
let autoReplies = {};
try {
    autoReplies = JSON.parse(fs.readFileSync('./data/autoReplies.json'));
} catch (err) {
    console.log('No auto-replies file found, starting fresh');
    fs.writeFileSync('./data/autoReplies.json', JSON.stringify({}));
}

async function handleMessages(sock, messageUpdate) {
    try {
        const { messages, type } = messageUpdate;
        if (type !== 'notify') return;

        const message = messages[0];
        if (!message?.message) return;

        const chatId = message.key.remoteJid;
        const senderId = message.key.participant || message.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');
        
        let userMessage = message.message?.conversation?.trim() ||
            message.message?.extendedTextMessage?.text?.trim() || '';

        // Check for spam messages
        if (isGroup && detectSpam(userMessage)) {
            await handleSpamMessage(sock, chatId, message, senderId);
            return;
        }

        // Handle auto-replies
        if (autoReplies[userMessage.toLowerCase()]) {
            await sock.sendMessage(chatId, { text: autoReplies[userMessage.toLowerCase()] });
            return;
        }

        // Command handlers
        const command = userMessage.split(' ')[0].toLowerCase();
        const args = userMessage.split(' ').slice(1);

        switch (command) {
            case 'أضف':
            case 'اضف':
                if (args[0] === 'رد') {
                    await handleAddReply(sock, chatId, message, senderId, args.slice(1).join(' '));
                }
                break;
                
            case 'احذف':
                if (args[0] === 'رد') {
                    await handleDeleteReply(sock, chatId, senderId, args.slice(1).join(' '));
                }
                break;
                
            case 'ردود':
            case 'الردود':
                await listReplies(sock, chatId);
                break;
                
            case '!spam':
            case '!سبام':
                await handleSpamReport(sock, chatId, message, senderId);
                break;
                
            case '@all':
                await handleTagAll(sock, chatId, senderId);
                break;
        }
    } catch (error) {
        console.error('Error in message handler:', error);
    }
}

// Helper functions
function detectSpam(message) {
    const spamPatterns = [
        /إجازة\s*مـ?ـرضـ?ـيـ?ـة/i,
        /مـعـتمـدة\s*صـ?ـحـ?تـ?ي/i,
        /تاريخ\s*قديم\s*تاريخ\s*جديد/i,
        /إعداد\s*(بحوث|تقارير|مشاريع)/i,
        /حل\s*(انشطة|واجبات)/i,
        /عمل\s*(تصاميم|عروض\s*بوربوينت)/i,
        /حل\s*اختبارات\s*(كويز|ميد|فاينال)/i,
        /عـ?ـذر\s*طـ?ـبي/i,
        /إجـ?\s*سكليف/i,
        /قطاع\s*خاص\s*حكومي/i,
        /بحوث\s*research/i,
        /الواجبات\s*homework/i,
        /الاختبارات\s*exams/i,
        /مشاريع\s*Projects/i,
        /البرمجة\s*Programming/i
    ];
    
    return spamPatterns.some(pattern => pattern.test(message));
}

async function handleSpamMessage(sock, chatId, message, senderId) {
    try {
        // Delete the spam message
        await sock.sendMessage(chatId, { delete: message.key });
        
        // Kick the sender
        await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
        
        // Notify group
        await sock.sendMessage(chatId, { 
            text: `تم اكتشاف رسالة سبام وتم طرد العضو @${senderId.split('@')[0]}`,
            mentions: [senderId]
        });
    } catch (error) {
        console.error('Error handling spam message:', error);
    }
}

async function handleAddReply(sock, chatId, message, senderId, replyText) {
    if (!isGroup) {
        await sock.sendMessage(chatId, { text: 'هذا الأمر متاح فقط في المجموعات' });
        return;
    }
    
    const adminStatus = await isAdmin(sock, chatId, senderId);
    if (!adminStatus.isSenderAdmin) {
        await sock.sendMessage(chatId, { text: 'هذا الأمر متاح فقط للأدمنز' });
        return;
    }
    
    const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMessage || !replyText) {
        await sock.sendMessage(chatId, { 
            text: 'الاستخدام: أضف رد <النص>\nمع الرد على الرسالة التي تريد حفظ رد لها'
        });
        return;
    }
    
    const triggerMessage = quotedMessage.conversation || quotedMessage.extendedTextMessage?.text;
    if (!triggerMessage) {
        await sock.sendMessage(chatId, { text: 'لم يتم العثور على نص الرسالة' });
        return;
    }
    
    autoReplies[triggerMessage.toLowerCase()] = replyText;
    fs.writeFileSync('./data/autoReplies.json', JSON.stringify(autoReplies, null, 2));
    
    await sock.sendMessage(chatId, { 
        text: `تم حفظ الرد "${replyText}" للرسالة "${triggerMessage}"`
    });
}

async function handleDeleteReply(sock, chatId, senderId, triggerText) {
    if (!isGroup) {
        await sock.sendMessage(chatId, { text: 'هذا الأمر متاح فقط في المجموعات' });
        return;
    }
    
    const adminStatus = await isAdmin(sock, chatId, senderId);
    if (!adminStatus.isSenderAdmin) {
        await sock.sendMessage(chatId, { text: 'هذا الأمر متاح فقط للأدمنز' });
        return;
    }
    
    if (!triggerText) {
        await sock.sendMessage(chatId, { 
            text: 'الاستخدام: احذف رد <النص>'
        });
        return;
    }
    
    if (!autoReplies[triggerText.toLowerCase()]) {
        await sock.sendMessage(chatId, { 
            text: `لا يوجد رد محفوظ للرسالة "${triggerText}"`
        });
        return;
    }
    
    delete autoReplies[triggerText.toLowerCase()];
    fs.writeFileSync('./data/autoReplies.json', JSON.stringify(autoReplies, null, 2));
    
    await sock.sendMessage(chatId, { 
        text: `تم حذف الرد للرسالة "${triggerText}"`
    });
}

async function listReplies(sock, chatId) {
    if (Object.keys(autoReplies).length === 0) {
        await sock.sendMessage(chatId, { text: 'لا توجد ردود محفوظة حالياً' });
        return;
    }
    
    let replyList = '📜 قائمة الردود المحفوظة:\n\n';
    for (const [trigger, reply] of Object.entries(autoReplies)) {
        replyList += `🔹 "${trigger}" → "${reply}"\n`;
    }
    
    await sock.sendMessage(chatId, { text: replyList });
}

async function handleSpamReport(sock, chatId, message, senderId) {
    if (!isGroup) {
        await sock.sendMessage(chatId, { text: 'هذا الأمر متاح فقط في المجموعات' });
        return;
    }
    
    const adminStatus = await isAdmin(sock, chatId, senderId);
    if (!adminStatus.isSenderAdmin) {
        await sock.sendMessage(chatId, { text: 'هذا الأمر متاح فقط للأدمنز' });
        return;
    }
    
    const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMessage) {
        await sock.sendMessage(chatId, { 
            text: 'يجب الرد على الرسالة المشبوهة باستخدام هذا الأمر'
        });
        return;
    }
    
    const spamSender = quotedMessage.key?.participant || quotedMessage.key?.remoteJid;
    if (!spamSender) {
        await sock.sendMessage(chatId, { text: 'تعذر تحديد مرسل الرسالة' });
        return;
    }
    
    // Delete the spam message
    await sock.sendMessage(chatId, { delete: quotedMessage.key });
    
    // Kick the spammer
    await sock.groupParticipantsUpdate(chatId, [spamSender], 'remove');
    
    // Notify group
    await sock.sendMessage(chatId, { 
        text: `تم الإبلاغ عن رسالة سبام وتم طرد العضو @${spamSender.split('@')[0]}`,
        mentions: [spamSender]
    });
}

async function handleTagAll(sock, chatId, senderId) {
    if (!isGroup) {
        await sock.sendMessage(chatId, { text: 'هذا الأمر متاح فقط في المجموعات' });
        return;
    }
    
    const adminStatus = await isAdmin(sock, chatId, senderId);
    if (!adminStatus.isSenderAdmin) {
        await sock.sendMessage(chatId, { text: 'هذا الأمر متاح فقط للأدمنز' });
        return;
    }
    
    const groupMetadata = await sock.groupMetadata(chatId);
    const participants = groupMetadata.participants.map(p => p.id);
    
    let mentionText = '';
    participants.forEach(participant => {
        mentionText += `@${participant.split('@')[0]} `;
    });
    
    await sock.sendMessage(chatId, { 
        text: mentionText,
        mentions: participants
    });
}

module.exports = { handleMessages };
