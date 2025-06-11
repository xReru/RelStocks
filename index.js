const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const { initDatabase, getSubscribers, addSubscriber, removeSubscriber } = require('./db');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const API_ENDPOINT = process.env.API_ENDPOINT;
const PORT = process.env.PORT || 8080;

if (!PAGE_ACCESS_TOKEN || !VERIFY_TOKEN || !ADMIN_ID || !API_ENDPOINT) {
    console.error('Error: Missing required environment variables. Please check your .env file.');
    process.exit(1);
}

// Create axios instance with default config
const apiClient = axios.create({
    baseURL: API_ENDPOINT,
    timeout: 10000,
    headers: {
        'User-Agent': 'RelStocks-Bot/1.0'
    }
});

// Initialize database and load subscribers
let subscribedUsers = new Set();
let lastScheduledCheck = 0;

const initializeApp = async () => {
    try {
        await initDatabase();
        subscribedUsers = await getSubscribers();
        console.log(`📋 Loaded ${subscribedUsers.size} subscribers from database`);
    } catch (err) {
        console.error('Error initializing app:', err);
        process.exit(1);
    }
};

// Spam prevention constants
const GLOBAL_COMMAND_COOLDOWN = 2 * 1000; // 2 seconds between any commands
const DAILY_COMMAND_LIMIT = 100; // Maximum commands per day per user
const MESSAGE_RATE_LIMIT = 5; // Maximum messages per minute
const MESSAGE_RATE_WINDOW = 60 * 1000; // 1 minute window

// Cooldown tracking
const lastCheckTime = new Map(); // Track last check time per user
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 minutes in milliseconds

// Stock command cooldown tracking
const stockCommandCooldown = new Map(); // Track last stock command time per user
const STOCK_COMMAND_COOLDOWN = 10 * 1000; // 10 seconds in milliseconds

// Global command cooldown tracking
const globalCommandCooldown = new Map(); // Track last command time per user

// Daily command limit tracking
const dailyCommandCount = new Map(); // Track commands per user per day
const lastCommandReset = new Map(); // Track when to reset daily counts

// Message rate limiting
const messageCounts = new Map(); // Track message counts per user
const messageTimestamps = new Map(); // Track message timestamps per user

// Track last seen items for 30-min restock categories
const lastSeenStock = new Map();
// Track last check time for 30-min categories
const lastCheckTime30Min = new Map();

// Function to check if user is rate limited
const isRateLimited = (senderId) => {
    const now = Date.now();

    // Check global command cooldown
    const lastCommand = globalCommandCooldown.get(senderId) || 0;
    if (now - lastCommand < GLOBAL_COMMAND_COOLDOWN) {
        return {
            limited: true,
            message: `⏳ Please wait ${Math.ceil((GLOBAL_COMMAND_COOLDOWN - (now - lastCommand)) / 1000)} second(s) before using another command.`
        };
    }

    // Check daily command limit
    const lastReset = lastCommandReset.get(senderId) || 0;
    const today = new Date().setHours(0, 0, 0, 0);

    if (lastReset < today) {
        // Reset daily count if it's a new day
        dailyCommandCount.set(senderId, 0);
        lastCommandReset.set(senderId, now);
    }

    const commandCount = dailyCommandCount.get(senderId) || 0;
    if (commandCount >= DAILY_COMMAND_LIMIT) {
        return {
            limited: true,
            message: `❌ You have reached your daily command limit of ${DAILY_COMMAND_LIMIT} commands. Please try again tomorrow.`
        };
    }

    // Check message rate limit
    const userMessages = messageCounts.get(senderId) || 0;
    const userTimestamps = messageTimestamps.get(senderId) || [];

    // Remove timestamps older than the window
    const recentTimestamps = userTimestamps.filter(timestamp => now - timestamp < MESSAGE_RATE_WINDOW);
    messageTimestamps.set(senderId, recentTimestamps);

    if (recentTimestamps.length >= MESSAGE_RATE_LIMIT) {
        return {
            limited: true,
            message: `⏳ You are sending messages too quickly. Please wait ${Math.ceil((MESSAGE_RATE_WINDOW - (now - recentTimestamps[0])) / 1000)} second(s).`
        };
    }

    return { limited: false };
};

// Function to update rate limiting counters
const updateRateLimits = (senderId) => {
    const now = Date.now();

    // Update global command cooldown
    globalCommandCooldown.set(senderId, now);

    // Update daily command count
    const commandCount = dailyCommandCount.get(senderId) || 0;
    dailyCommandCount.set(senderId, commandCount + 1);

    // Update message rate limiting
    const timestamps = messageTimestamps.get(senderId) || [];
    timestamps.push(now);
    messageTimestamps.set(senderId, timestamps);
};

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
        const { data } = await apiClient.get('/v2/growagarden/stock');
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
const defaultAlerts = {
    seed_stock: ['grape', 'mango', 'pepper', 'cacao', 'mushroom', 'ember_lily', 'coconut'],
    gear_stock: ['advanced_sprinkler', 'master_sprinkler', 'godly_sprinkler', 'lightning_rod', 'friendship_pot'],
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

        // Add initial delay before checking stock
        if (senderId) {
            await sendMessage(senderId, "⏳ Please wait while I check the stock...");
        }
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second initial delay

        // Add retry logic for API requests
        let retries = 3;
        let data;

        while (retries > 0) {
            try {
                const response = await apiClient.get('/v2/growagarden/stock');

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
        let hasNewSeedOrGear = false;

        // First check seed and gear stock
        for (let category of ['seed_stock', 'gear_stock']) {
            if (!data[category]) {
                console.warn(`⚠️ Category not found in API response: ${category}`);
                continue;
            }

            const matches = data[category]?.filter(item =>
                item && item.item_id && defaultAlerts[category].includes(item.item_id)
            );

            if (matches?.length) {
                const itemsList = matches.map(i => `• ${formatItemName(i.item_id)}`).join('\n');
                foundItems.push(`${categoryNames[category]}\n${itemsList}`);
                hasNewSeedOrGear = true;
            }
        }

        // Add delay before checking 30-min restock items
        if (isScheduled) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay for 30-min items
        }

        // Then check egg and eventshop stock
        for (let category of ['egg_stock', 'eventshop_stock']) {
            if (!data[category]) {
                console.warn(`⚠️ Category not found in API response: ${category}`);
                continue;
            }

            const matches = data[category]?.filter(item =>
                item && item.item_id && defaultAlerts[category].includes(item.item_id)
            );

            if (matches?.length) {
                const currentItems = new Set(matches.map(i => i.item_id));
                const lastSeen = lastSeenStock.get(category) || new Set();
                const lastCheck = lastCheckTime30Min.get(category) || 0;
                const now = Date.now();

                // Check if it's been 30 minutes since last check
                const is30MinInterval = (now - lastCheck) >= 30 * 60 * 1000;

                // Check if there are any new items
                const hasNewItems = [...currentItems].some(item => !lastSeen.has(item));

                // Only include if:
                // 1. There are new seed/gear items, OR
                // 2. It's a new 30-min restock (has new items and 30 mins passed)
                if (hasNewItems || hasNewSeedOrGear) {
                    const itemsList = matches.map(i => `• ${formatItemName(i.item_id)}`).join('\n');
                    foundItems.push(`${categoryNames[category]}\n${itemsList}`);

                    if (is30MinInterval) {
                        lastCheckTime30Min.set(category, now);
                    }
                }

                // Always update last seen items
                lastSeenStock.set(category, currentItems);
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
                    const sent = await sendMessage(userId, `🔔 Stock Alert!\n\n${message}`);
                    if (!sent) {
                        console.error(`❌ Failed to send alert to subscriber ${userId}`);
                    }
                }
            }
        } else {
            if (isScheduled) {
                console.log('✅ No new stock to alert at this time');
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
app.post('/webhook', async (req, res) => {
    const entries = req.body.entry;
    for (let entry of entries) {
        const messaging = entry.messaging;
        for (let event of messaging) {
            const senderId = event.sender.id;

            if (event.message && event.message.text) {
                const text = event.message.text.trim();

                // Check rate limits first
                const rateLimitCheck = isRateLimited(senderId);
                if (rateLimitCheck.limited) {
                    await sendMessage(senderId, rateLimitCheck.message);
                    continue;
                }

                // Handle broadcast command
                if (text.startsWith('/broadcast ')) {
                    if (senderId !== ADMIN_ID) {
                        await sendMessage(senderId, '❌ You are not authorized to use this command.');
                        continue;
                    }

                    const message = text.slice('/broadcast '.length);
                    if (!message) {
                        await sendMessage(senderId, '❌ Please provide a message to broadcast.');
                        continue;
                    }

                    let successCount = 0;
                    let failCount = 0;

                    for (const userId of subscribedUsers) {
                        const sent = await sendMessage(userId, `📢 Broadcast Message\n\n${message}`);
                        if (sent) {
                            successCount++;
                        } else {
                            failCount++;
                        }
                    }

                    await sendMessage(senderId, `✅ Broadcast complete!\n• Successfully sent: ${successCount}\n• Failed to send: ${failCount}`);
                    updateRateLimits(senderId);
                    continue;
                }

                // Convert to lowercase for other commands
                const textLower = text.toLowerCase();

                switch (textLower) {
                    case '/help':
                        const helpMessage = `🤖 Available Commands\n\n` +
                            `Stock Commands\n` +
                            `• /stock - View all current stock items\n` +
                            `• /checkstock - Check for stock of the default alerts\n` +
                            `• /defaultalerts - Show items that trigger stock alerts\n\n` +
                            `Notification Commands\n` +
                            `• /subscribe - Get notified when items are in stock\n` +
                            `• /unsubscribe - Stop receiving notifications\n\n` +
                            `Other Commands\n` +
                            `• /about - Little about the bot and the dev\n\n` +
                            `• /help - Show this help message\n\n` +
                            `ℹ️ Stock checks happen every 5 minutes in PH time.`;
                        await sendMessage(senderId, helpMessage);
                        updateRateLimits(senderId);
                        break;

                    case '/subscribe':
                        if (subscribedUsers.has(senderId)) {
                            await sendMessage(senderId, '✅ You are already subscribed to stock alerts.');
                        } else {
                            const success = await addSubscriber(senderId);
                            if (success) {
                                subscribedUsers.add(senderId);
                                await sendMessage(senderId, '✅ You are now subscribed to stock alerts. You will be notified every 5 minutes when items are in stock.');
                            } else {
                                await sendMessage(senderId, '❌ Failed to subscribe. Please try again later.');
                            }
                        }
                        updateRateLimits(senderId);
                        break;

                    case '/unsubscribe':
                        if (subscribedUsers.has(senderId)) {
                            const success = await removeSubscriber(senderId);
                            if (success) {
                                subscribedUsers.delete(senderId);
                                await sendMessage(senderId, '❌ You have been unsubscribed from stock alerts.');
                            } else {
                                await sendMessage(senderId, '❌ Failed to unsubscribe. Please try again later.');
                            }
                        } else {
                            await sendMessage(senderId, 'ℹ️ You are not currently subscribed to stock alerts.');
                        }
                        updateRateLimits(senderId);
                        break;

                    case '/checkstock':
                        // Check stock command cooldown
                        const lastStockCheck = stockCommandCooldown.get(senderId) || 0;
                        const timeSinceLastStockCheck = Date.now() - lastStockCheck;

                        if (timeSinceLastStockCheck < STOCK_COMMAND_COOLDOWN) {
                            const remainingTime = Math.ceil((STOCK_COMMAND_COOLDOWN - timeSinceLastStockCheck) / 1000);
                            await sendMessage(senderId, `⏳ Please wait ${remainingTime} second(s) before checking stock again.`);
                            continue;
                        }

                        // Update last stock check time
                        stockCommandCooldown.set(senderId, Date.now());
                        await sendMessage(senderId, "🔍 Checking stock, please wait...");
                        await checkStock(senderId);
                        updateRateLimits(senderId);
                        break;

                    case '/stock':
                        // Check stock command cooldown
                        const lastStockView = stockCommandCooldown.get(senderId) || 0;
                        const timeSinceLastStockView = Date.now() - lastStockView;

                        if (timeSinceLastStockView < STOCK_COMMAND_COOLDOWN) {
                            const remainingTime = Math.ceil((STOCK_COMMAND_COOLDOWN - timeSinceLastStockView) / 1000);
                            await sendMessage(senderId, `⏳ Please wait ${remainingTime} second(s) before checking stock again.`);
                            continue;
                        }

                        // Update last stock check time
                        stockCommandCooldown.set(senderId, Date.now());
                        await sendMessage(senderId, "🔍 Checking current stock status...");
                        await getAllStock(senderId);
                        updateRateLimits(senderId);
                        break;
                    case '/about':
                        const aboutMessage = `🤖 About the Bot\n\n` +
                            `• This bot is developed by Janrell Quiaroro(Rel).\n\n` +
                            `• It checks the stock of the game Grow a Garden (Roblox) every 5 minutes and sends notifications to users when new items are in stock.\n\n` +
                            `• Rel created this bot for his own use, but decided to share it with the community.\n\n` +
                            `• The services of this bot is free, Shout out to JoshLei for providing the API.\n\n` +
                            `• Please DO NOT abuse the services of this bot, and keep the minimize sending commands.\n\n` +
                            `• If you have any suggestions, please contact Rel on discord (@reruu).\n\n`;
                        await sendMessage(senderId, aboutMessage);
                        updateRateLimits(senderId);
                        break;

                    case '/defaultalerts':
                        let alertsMessage = `🔔 Default Stock Alerts\n\n`;

                        for (const [category, items] of Object.entries(defaultAlerts)) {
                            const categoryName = categoryNames[category] || category;
                            const formattedItems = items.map(item => `• ${formatItemName(item)}`).join('\n');
                            alertsMessage += `${categoryName}\n${formattedItems}\n\n`;
                        }

                        alertsMessage += `ℹ️ These are the items that will trigger notifications when they are in stock.`;
                        await sendMessage(senderId, alertsMessage);
                        updateRateLimits(senderId);
                        break;

                    default:
                        await sendMessage(senderId, "✅ Bot is live! Use /help to see all available commands.");
                        updateRateLimits(senderId);
                }
            }
        }
    }

    res.sendStatus(200);
});

// Start server
initializeApp().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
});
checkStock(null);