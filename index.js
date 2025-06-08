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
    cosmetic_stock: '🎨 Cosmetics',
    eventshop_stock: '🎉 Event Shop'
};

// Get all available stock
const getAllStock = async (senderId) => {
    try {
        const { data } = await axios.get('https://api.joshlei.com/v2/growagarden/stock');
        let stockMessage = [];

        for (let category in data) {
            // Skip cosmetic_stock category
            if (category === 'cosmetic_stock') continue;

            // Check if data[category] exists and is an array
            if (data[category] && Array.isArray(data[category]) && data[category].length > 0) {
                // Get unique items and sort them
                const uniqueItems = [...new Set(data[category]
                    .filter(item => item && item.item_id)
                    .map(item => item.item_id))].sort();

                if (uniqueItems.length > 0) {
                    const itemsList = uniqueItems
                        .map(itemId => `• ${formatItemName(itemId)}`)
                        .join('\n');

                    const categoryName = categoryNames[category] || category;
                    stockMessage.push(`${categoryName} (${uniqueItems.length} items)\n${itemsList}`);
                }
            }
        }

        if (stockMessage.length) {
            const message = `📦 Current Stock Status\n\n${stockMessage.join('\n\n')}`;
            await sendMessage(senderId, message);
        } else {
            await sendMessage(senderId, '❌ No items currently in stock.');
        }
    } catch (err) {
        console.error('❌ Error fetching stock:', err.message);
        await sendMessage(senderId, '❌ Sorry, there was an error fetching the stock information.');
    }
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

        if (foundItems.length) {
            const message = `📦 Here's what's currently in stock:\n\n${foundItems.join('\n\n')}`;

            // If senderId is provided, send to that specific user
            if (senderId) {
                await sendMessage(senderId, message);
            } else {
                // If no senderId, this is a scheduled check - notify all subscribers
                for (const userId of subscribedUsers) {
                    await sendMessage(userId, `🔔 *Stock Alert!*\n\n${message}`);
                }
            }
        }

        if (!foundItems.length) console.log('✅ No matching stock found at this time');
    } catch (err) {
        console.error('❌ Error fetching stock:', err.message);
    }
};

// Auto stock check every 5 minutes
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
                    case '/subscribe':
                        if (subscribedUsers.has(senderId)) {
                            sendMessage(senderId, '✅ You are already subscribed to stock alerts.');
                        } else {
                            subscribedUsers.add(senderId);
                            sendMessage(senderId, '✅ You are now subscribed to stock alerts. You will be notified every 5 minutes when items are in stock.');
                        }
                        break;

                    case '/unsubscribe':
                        if (subscribedUsers.has(senderId)) {
                            subscribedUsers.delete(senderId);
                            sendMessage(senderId, '❌ You have been unsubscribed from stock alerts.');
                        } else {
                            sendMessage(senderId, 'ℹ️ You are not currently subscribed to stock alerts.');
                        }
                        break;

                    case '/checkstock':
                        sendMessage(senderId, "🔍 Checking stock, please wait...");
                        checkStock(senderId);
                        break;

                    case '/stock':
                        sendMessage(senderId, "🔍 Checking current stock status...");
                        getAllStock(senderId);
                        break;

                    default:
                        sendMessage(senderId, "✅ Bot is live.\nCommands:\n/subscribe – Subscribe to stock alerts\n/unsubscribe – Unsubscribe from alerts\n/checkstock – Check alert items\n/stock – Display all current stock");
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
checkStock(null);