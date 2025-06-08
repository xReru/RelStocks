const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PORT = process.env.PORT || 8080;
if (!PAGE_ACCESS_TOKEN || !VERIFY_TOKEN) {
    console.error('Error: Missing required environment variables. Please check your .env file.');
    process.exit(1);
}

// In-memory subscription list (use a DB in production)
const subscribedUsers = new Set();

const sendMessage = async (recipientId, message) => {
    try {
        await axios.post(
            `https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            {
                messaging_type: 'UPDATE',
                recipient: { id: recipientId },
                message: { text: message },
            }
        );
        console.log('Message sent to:', recipientId);
    } catch (err) {
        console.error('Failed to send message:', err.response?.data || err.message);
    }
};

// Format item name for display
const formatItemName = (itemId) => {
    return itemId
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
};

// Friendly category labels
const categoryNames = {
    seed_stock: '🌱 Seeds',
    gear_stock: '⚙️ Gear',
    egg_stock: '🥚 Eggs',
    eventshop_stock: '🎉 Event Shop'
};

// Alerts configuration
const alerts = {
    seed_stock: ['grape', 'mango', 'pepper', 'cacao', 'mushroom', 'bamboo'],
    gear_stock: ['advanced_sprinkler', 'master_sprinkler', 'godly_sprinkler', 'lightning_rod'],
    egg_stock: ['bug_egg', 'mythical_egg', 'legendary_egg'],
    eventshop_stock: ['bee_egg', 'honey_sprinkler', 'nectar_staff']
};

// Stock checking
const checkStock = async (senderId) => {
    try {
        const { data } = await axios.get('https://api.joshlei.com/v2/growagarden/stock');
        let foundItems = [];

        for (let category in alerts) {
            const matches = data[category]?.filter(item =>
                alerts[category].includes(item.item_id)
            );
            if (matches?.length) {
                const itemsList = matches.map(i => `• ${formatItemName(i.item_id)}`).join('\n');
                foundItems.push(`*${categoryNames[category]}*\n${itemsList}`);
            }
        }

        const message = foundItems.length
            ? `📦 Here's what's currently in stock:\n\n${foundItems.join('\n\n')}`
            : '✅ No matching stock found right now.';

        // Send to the requesting user
        await sendMessage(senderId, message);

        if (!foundItems.length) console.log('✅ No matching stock found at this time');
    } catch (err) {
        console.error('❌ Error fetching stock:', err.message);
    }
};

// Auto stock check every 5 minutes — only if there are subscribers
setInterval(() => {
    if (subscribedUsers.size > 0) {
        console.log('🔁 Running scheduled stock check...');
        checkStock(null);
    } else {
        console.log('ℹ️ No subscribers to notify.');
    }
}, 5 * 60 * 1000);

// Webhook verification
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

// Handle incoming messages
app.post('/webhook', (req, res) => {
    const entries = req.body.entry;
    for (let entry of entries) {
        const messaging = entry.messaging;
        for (let event of messaging) {
            const senderId = event.sender.id;

            if (event.message && event.message.text) {
                const text = event.message.text.trim().toLowerCase();

                switch (text) {
                    case '/start':
                    case '/subscribe':
                        subscribedUsers.add(senderId);
                        sendMessage(senderId, '✅ You are now subscribed to stock alerts.');
                        break;

                    case '/checkstock':
                        if (!subscribedUsers.has(senderId)) {
                            sendMessage(senderId, 'ℹ️ Please subscribe first using /start or /subscribe.');
                        } else {
                            sendMessage(senderId, "🔍 Checking stock, please wait...");
                            checkStock(senderId);
                        }
                        break;

                    case '/unsubscribe':
                        subscribedUsers.delete(senderId);
                        sendMessage(senderId, '❌ You have been unsubscribed from alerts.');
                        break;

                    default:
                        sendMessage(senderId, "✅ Bot is live.\nCommands:\n/start – Subscribe\n/checkstock – Check current stock\n/unsubscribe – Unsubscribe from alerts");
                }
            }
        }
    }

    res.sendStatus(200);
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
