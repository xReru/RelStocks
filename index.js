const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
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

// File path for storing subscribers
const SUBSCRIBERS_FILE = path.join(__dirname, 'subscribers.json');
const LAST_CHECK_FILE = path.join(__dirname, 'last_check.json');

// Load subscribers from file or create new Set
let subscribedUsers = new Set();
try {
    if (fs.existsSync(SUBSCRIBERS_FILE)) {
        const data = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf8'));
        subscribedUsers = new Set(data);
        console.log(`📋 Loaded ${subscribedUsers.size} subscribers from file`);
    }
} catch (err) {
    console.error('Error loading subscribers:', err);
}

// Load last check time
let lastScheduledCheck = 0;
try {
    if (fs.existsSync(LAST_CHECK_FILE)) {
        const data = JSON.parse(fs.readFileSync(LAST_CHECK_FILE, 'utf8'));
        lastScheduledCheck = data.timestamp || 0;
    }
} catch (err) {
    console.error('Error loading last check time:', err);
}

// Save subscribers to file
const saveSubscribers = () => {
    try {
        fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify([...subscribedUsers]));
        console.log(`💾 Saved ${subscribedUsers.size} subscribers to file`);
    } catch (err) {
        console.error('Error saving subscribers:', err);
    }
};

// Save last check time
const saveLastCheckTime = (timestamp) => {
    try {
        fs.writeFileSync(LAST_CHECK_FILE, JSON.stringify({ timestamp }));
        console.log(`⏰ Updated last check time: ${new Date(timestamp).toISOString()}`);
    } catch (err) {
        console.error('Error saving last check time:', err);
    }
};

// Cooldown tracking
const lastCheckTime = new Map(); // Track last check time per user
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 minutes in milliseconds

// Function to get next check time
const getNextCheckTime = () => {
    const now = new Date();
    // Convert to UTC+08:00
    const phTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const minutes = phTime.getUTCMinutes();
    const nextCheck = new Date(phTime);
    // Round up to next 5-minute interval
    nextCheck.setUTCMinutes(Math.ceil(minutes / 5) * 5);
    nextCheck.setUTCSeconds(0);
    nextCheck.setUTCMilliseconds(0);
    // Convert back to UTC for scheduling
    return new Date(nextCheck.getTime() - (8 * 60 * 60 * 1000));
};

// Function to schedule next check
const scheduleNextCheck = () => {
    const nextCheck = getNextCheckTime();
    const delay = nextCheck.getTime() - Date.now();

    // Convert to PH time for display
    const phNextCheck = new Date(nextCheck.getTime() + (8 * 60 * 60 * 1000));
    console.log(`⏰ Next scheduled check at: ${phNextCheck.toISOString()} (PH Time)`);

    setTimeout(() => {
        const currentTime = Date.now();
        // Check if this is a duplicate execution
        if (currentTime - lastScheduledCheck < 4 * 60 * 1000) { // 4 minutes threshold
            console.log('⏭️ Skipping duplicate scheduled check');
            scheduleNextCheck();
            return;
        }

        if (subscribedUsers.size > 0) {
            console.log('🔔 Running scheduled stock check...');
            lastScheduledCheck = currentTime;
            saveLastCheckTime(currentTime);
            // Run scheduled check without affecting manual check cooldown
            checkStock(null, true);
        } else {
            console.log('ℹ️ No subscribers to notify.');
        }
        // Schedule the next check
        scheduleNextCheck();
    }, delay);
};

// Start the scheduling
scheduleNextCheck();

const sendMessage = async (recipientId, message) => {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            {
                messaging_type: 'UPDATE',
                recipient: { id: recipientId },
                message: { text: message },
            }
        );

        if (response.status !== 200) {
            throw new Error(`Unexpected status code: ${response.status}`);
        }

        console.log('✅ Message sent to:', recipientId);
        return true;
    } catch (err) {
        console.error('❌ Failed to send message:', err.response?.data || err.message);

        // Handle specific Facebook API errors
        if (err.response?.data?.error) {
            const fbError = err.response.data.error;
            console.error('Facebook API Error:', {
                code: fbError.code,
                subcode: fbError.error_subcode,
                message: fbError.message
            });

            // Handle rate limiting
            if (fbError.code === 4 || fbError.code === 17) {
                console.error('Rate limit exceeded, waiting before retry...');
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
                return sendMessage(recipientId, message); // Retry once
            }
        }

        return false;
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
const checkStock = async (senderId, isScheduled = false) => {
    try {
        // Check cooldown only for manual checks
        if (senderId && !isScheduled) {
            const lastCheck = lastCheckTime.get(senderId) || 0;
            const timeSinceLastCheck = Date.now() - lastCheck;

            if (timeSinceLastCheck < COOLDOWN_TIME) {
                const remainingTime = Math.ceil((COOLDOWN_TIME - timeSinceLastCheck) / 1000 / 60);
                await sendMessage(senderId, `⏳ Please wait ${remainingTime} minute(s) before checking again.`);
                return;
            }

            // Update last check time only for manual checks
            lastCheckTime.set(senderId, Date.now());
        }

        // Add retry logic for API requests
        let retries = 3;
        let data;

        while (retries > 0) {
            try {
                const response = await axios.get('https://api.joshlei.com/v2/growagarden/stock', {
                    timeout: 10000, // 10 second timeout
                    headers: {
                        'User-Agent': 'RelStocks-Bot/1.0'
                    }
                });

                if (response.status !== 200) {
                    throw new Error(`Unexpected status code: ${response.status}`);
                }

                data = response.data;
                break; // Success, exit retry loop
            } catch (err) {
                retries--;
                if (retries === 0) throw err; // No more retries, propagate error

                console.error(`❌ API request failed, retrying... (${retries} attempts left)`);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
            }
        }

        if (!data) {
            throw new Error('No data received from API');
        }

        let foundItems = [];

        for (let category in alerts) {
            if (!data[category]) {
                console.warn(`⚠️ Category not found in API response: ${category}`);
                continue;
            }

            const matches = data[category]?.filter(item =>
                item && item.item_id && alerts[category].includes(item.item_id)
            );

            if (matches?.length) {
                const itemsList = matches.map(i => `• ${formatItemName(i.item_id)}`).join('\n');
                foundItems.push(`*${categoryNames[category]}*\n${itemsList}`);
            }
        }

        if (foundItems.length) {
            const message = `📦 Here's what's currently in stock:\n\n${foundItems.join('\n\n')}`;

            if (senderId) {
                const sent = await sendMessage(senderId, message);
                if (!sent) {
                    console.error(`❌ Failed to send message to user ${senderId}`);
                }
            } else if (isScheduled) {
                // Only notify subscribers during scheduled checks
                for (const userId of subscribedUsers) {
                    const sent = await sendMessage(userId, `🔔 *Stock Alert!*\n\n${message}`);
                    if (!sent) {
                        console.error(`❌ Failed to send alert to subscriber ${userId}`);
                    }
                }
            }
        }

        if (!foundItems.length) {
            if (isScheduled) {
                console.log('✅ No matching stock found in scheduled check');
            } else {
                console.log('✅ No matching stock found at this time');
            }
        }
    } catch (err) {
        console.error('❌ Error in checkStock:', err.message);
        if (err.response) {
            console.error('API Response:', {
                status: err.response.status,
                data: err.response.data
            });
        }

        if (senderId) {
            await sendMessage(senderId, '❌ Sorry, there was an error checking the stock. Please try again later.');
        }
    }
};

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
                    case '/help':
                        const helpMessage = `🤖 *Available Commands*\n\n` +
                            `*Stock Commands*\n` +
                            `• /stock - View all current stock items\n` +
                            `• /checkstock - Check for specific alert items\n\n` +
                            `*Notification Commands*\n` +
                            `• /subscribe - Get notified when items are in stock\n` +
                            `• /unsubscribe - Stop receiving notifications\n\n` +
                            `*Other Commands*\n` +
                            `• /help - Show this help message\n\n` +
                            `ℹ️ Stock checks happen every 5 minutes in PH time.`;
                        sendMessage(senderId, helpMessage);
                        break;

                    case '/subscribe':
                        if (subscribedUsers.has(senderId)) {
                            sendMessage(senderId, '✅ You are already subscribed to stock alerts.');
                        } else {
                            subscribedUsers.add(senderId);
                            saveSubscribers(); // Save after adding new subscriber
                            sendMessage(senderId, '✅ You are now subscribed to stock alerts. You will be notified every 5 minutes when items are in stock.');
                        }
                        break;

                    case '/unsubscribe':
                        if (subscribedUsers.has(senderId)) {
                            subscribedUsers.delete(senderId);
                            saveSubscribers(); // Save after removing subscriber
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
                        sendMessage(senderId, "✅ Bot is live! Use /help to see all available commands.");
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