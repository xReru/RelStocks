const express = require('express');
const bodyParser = require('body-parser');
const { initDatabase, getSubscribers, addSubscriber, removeSubscriber, addAlert, removeAlert, getUserAlerts } = require('./db');
const WebSocketManager = require('./websocket-manager');
const APIClient = require('./api-client');
const StockManager = require('./stock-manager');
const {
    isRateLimited,
    updateRateLimits,
    trackSentMessage,
    isRecentlySentMessage,
    getNextCheckTime
} = require('./utils');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// Environment variables
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const API_ENDPOINT = process.env.API_ENDPOINT;
const PORT = process.env.PORT || 8080;
const USER_ID = process.env.USER_ID || 'xreru';

if (!PAGE_ACCESS_TOKEN || !VERIFY_TOKEN || !ADMIN_ID || !API_ENDPOINT) {
    console.error('Error: Missing required environment variables. Please check your .env file.');
    process.exit(1);
}

// Initialize managers
const apiClient = new APIClient(API_ENDPOINT);
const websocketManager = new WebSocketManager(
    USER_ID,
    null, // Will be set in initializeApp
    (error) => console.error('❌ WebSocket error:', error.message),
    () => console.log('✅ WebSocket connected - real-time stock monitoring active'),
    () => console.log('⚠️ WebSocket disconnected - falling back to API polling')
);
const stockManager = new StockManager(apiClient, websocketManager);

// Override stock manager's WebSocket handlers to use our functions
stockManager.setupWebSocketHandlers = function () {
    // Don't set up the stock manager's own handlers - we'll handle them in initializeApp
    console.log('🔧 Stock manager WebSocket handlers disabled - using main app handlers');
};

// Rate limiting configuration
const rateLimitConfig = {
    globalCommandCooldown: new Map(),
    dailyCommandLimit: 100,
    messageRateLimit: 5,
    messageRateWindow: 60 * 1000,
    lastCommandTime: new Map(),
    dailyCommandCount: new Map(),
    lastCommandReset: new Map(),
    messageCounts: new Map(),
    messageTimestamps: new Map()
};

// Cooldown tracking
const lastCheckTime = new Map();
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 minutes

// Message tracking
const recentlySentMessages = new Set();
const MESSAGE_TRACKING_DURATION = 30 * 1000; // 30 seconds

// Scheduled check tracking
let lastScheduledCheck = 0;

// Format item name for display
const formatItemName = (itemId) => {
    if (!itemId) return 'Unknown Item';

    // Convert snake_case to Title Case
    return itemId
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
};

// Friendly category labels
const categoryNames = {
    seed_stock: '🌱 Seeds',
    gear_stock: '🛠️ Gear',
    egg_stock: '🥚 Eggs',
    cosmetic_stock: '🎨 Cosmetics',
    eventshop_stock: '🎪 Event Shop'
};

// Alerts configuration
const defaultAlerts = {
    seed_stock: ['banana', 'pineapple', 'avocado', 'kiwi', 'bell_pepper', 'prickly_pear', 'loquat', 'feijoa', 'sugar_apple'],
    //removed seeds: coconut','grape', 'mango', 'pepper', 'cacao', 'mushroom', 'ember_lily',
    gear_stock: ['advanced_sprinkler', 'master_sprinkler', 'godly_sprinkler', 'tanning_mirror', 'lightning_rod', 'friendship_pot'],
    egg_stock: ['bug_egg', 'mythical_egg', 'paradise_egg']
    //eventshop_stock: ['bee_egg', 'honey_sprinkler', 'nectar_staff']
};

// Broadcast tracking to prevent spam
const recentBroadcasts = new Map();
const BROADCAST_COOLDOWN = 30 * 1000; // 30 seconds between broadcasts
const BROADCAST_MESSAGE_TRACKING_DURATION = 60 * 1000; // 1 minute

// Track last seen items for 30-min restock categories
const lastSeenStock = new Map();
// Track last check time for 30-min categories
const lastCheckTime30Min = new Map();

// Initialize application
const initializeApp = async () => {
    try {
        await initDatabase();
        const subscribers = await getSubscribers();
        stockManager.setSubscribers(subscribers);
        console.log(`📋 Loaded ${subscribers.length} subscribers from database`);

        // Set up WebSocket handlers to use our sendMessage function
        websocketManager.onStockUpdate = async (data) => {
            console.log('📦 WebSocket stock update received, checking for alerts...');
            try {
                // Check alerts for all subscribers when WebSocket receives update
                const failedSubscribers = new Set();

                // Process all subscribers in parallel for faster alert delivery
                const alertPromises = Array.from(stockManager.subscribers).map(async (userId) => {
                    try {
                        await checkStockForUser(userId, data, true);
                    } catch (err) {
                        console.error(`❌ Failed to check stock for subscriber ${userId}:`, err.message);
                        failedSubscribers.add(userId);
                    }
                });

                // Wait for all alerts to be processed
                await Promise.allSettled(alertPromises);

                // Only retry failed subscribers if there are any, but with minimal delay
                if (failedSubscribers.size > 0) {
                    console.log(`🔄 Retrying failed checks for ${failedSubscribers.size} subscribers...`);

                    const retryPromises = Array.from(failedSubscribers).map(async (userId) => {
                        try {
                            await checkStockForUser(userId, data, true);
                            console.log(`✅ Successfully checked stock for subscriber ${userId} after retry`);
                        } catch (err) {
                            console.error(`❌ Failed to check stock for subscriber ${userId} after retry:`, err.message);
                        }
                    });

                    await Promise.allSettled(retryPromises);
                }
            } catch (error) {
                console.error('❌ Error processing WebSocket stock update:', error.message);
            }
        };

        // Start WebSocket connection
        websocketManager.connect();

        // Schedule periodic checks as backup
        scheduleNextCheck();

    } catch (err) {
        console.error('Error initializing app:', err);
        process.exit(1);
    }
};

// Facebook Messenger API functions
const sendMessage = async (recipientId, message) => {
    try {
        // Track sent message to prevent loops
        trackSentMessage(message, recentlySentMessages, MESSAGE_TRACKING_DURATION);

        const response = await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: { text: message },
                messaging_type: 'MESSAGE_TAG',
                tag: 'ACCOUNT_UPDATE'
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('❌ Error sending message:', errorData);
            throw new Error(`Facebook API error: ${response.status}`);
        }

        console.log(`📤 Message sent to ${recipientId}`);
        return true; // Return true on success
    } catch (error) {
        console.error('❌ Error sending message:', error.message);
        throw error;
    }
};

// Schedule next check (backup to WebSocket)
const scheduleNextCheck = () => {
    const nextCheck = getNextCheckTime();
    const delay = nextCheck.getTime() - Date.now();

    const phNextCheck = new Date(nextCheck.getTime() + (8 * 60 * 60 * 1000));
    console.log(`⏰ Next scheduled check at: ${phNextCheck.toISOString()}`);

    setTimeout(async () => {
        const currentTime = Date.now();
        if (currentTime - lastScheduledCheck < 4 * 60 * 1000) {
            console.log('⏭️ Skipping duplicate scheduled check');
            scheduleNextCheck();
            return;
        }

        if (stockManager.subscribers.size > 0) {
            console.log('🔔 Running scheduled stock check...');
            lastScheduledCheck = currentTime;

            // Only run if WebSocket is not active
            if (!websocketManager.isConnectionActive()) {
                try {
                    await checkStock(null, true);
                } catch (error) {
                    console.error('❌ Error in scheduled check:', error.message);
                }
            }
        }

        scheduleNextCheck();
    }, delay);
};

// Stock checking function
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

        // Get stock data from API
        const response = await apiClient.get('/v2/growagarden/stock');
        const data = response.data;

        if (!data) {
            throw new Error('No data received from API');
        }

        // For manual checks, check alerts for the specific user
        if (senderId && !isScheduled) {
            await checkStockForUser(senderId, data);
            return;
        }

        // For scheduled checks, check alerts for each subscriber individually
        if (isScheduled) {
            const failedSubscribers = new Set();

            // Process all subscribers in parallel for faster alert delivery
            const alertPromises = Array.from(stockManager.subscribers).map(async (userId) => {
                try {
                    await checkStockForUser(userId, data, true);
                } catch (err) {
                    console.error(`❌ Failed to check stock for subscriber ${userId}:`, err.message);
                    failedSubscribers.add(userId);
                }
            });

            // Wait for all alerts to be processed
            await Promise.allSettled(alertPromises);

            // Only retry failed subscribers if there are any, but with minimal delay
            if (failedSubscribers.size > 0) {
                console.log(`🔄 Retrying failed checks for ${failedSubscribers.size} subscribers...`);

                const retryPromises = Array.from(failedSubscribers).map(async (userId) => {
                    try {
                        await checkStockForUser(userId, data, true);
                        console.log(`✅ Successfully checked stock for subscriber ${userId} after retry`);
                    } catch (err) {
                        console.error(`❌ Failed to check stock for subscriber ${userId} after retry:`, err.message);
                    }
                });

                await Promise.allSettled(retryPromises);
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

// Helper function to check stock for a specific user
const checkStockForUser = async (userId, data, isScheduled = false) => {
    // Get user's custom alerts or use defaults
    let alertsToCheck = defaultAlerts;
    const userAlerts = await getUserAlerts(userId);
    if (userAlerts && Object.keys(userAlerts).length > 0) {
        alertsToCheck = userAlerts;
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
            item && item.item_id && alertsToCheck[category]?.includes(item.item_id)
        );

        if (matches?.length) {
            const itemsList = matches.map(i => `• ${formatItemName(i.item_id)}`).join('\n');
            foundItems.push(`${categoryNames[category]}\n${itemsList}`);
            hasNewSeedOrGear = true;
        }
    }

    // Then check egg and eventshop stock (removed unnecessary delay)
    for (let category of ['egg_stock', 'eventshop_stock']) {
        if (!data[category]) {
            console.warn(`⚠️ Category not found in API response: ${category}`);
            continue;
        }

        const matches = data[category]?.filter(item =>
            item && item.item_id && alertsToCheck[category]?.includes(item.item_id)
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

        if (isScheduled) {
            const sent = await sendMessage(userId, `🔔 Stock Alert!\n\n${message}`);
            if (!sent) {
                throw new Error(`Failed to send alert to subscriber ${userId}`);
            }
            console.log(`✅ Stock alert sent to ${userId}`);
        } else {
            const sent = await sendMessage(userId, message);
            if (!sent) {
                console.error(`❌ Failed to send message to user ${userId}`);
            }
        }
    } else {
        if (isScheduled) {
            console.log(`✅ No new stock to alert for subscriber ${userId}`);
        } else {
            console.log('✅ No matching stock found at this time');
        }
    }
};

// Command handlers
const handleStockCommand = async (senderId) => {
    try {
        // Check rate limits
        const rateLimitCheck = isRateLimited(senderId, rateLimitConfig);
        if (rateLimitCheck.limited) {
            await sendMessage(senderId, rateLimitCheck.message);
            return;
        }

        // Check cooldown
        const lastCheck = lastCheckTime.get(senderId) || 0;
        const timeSinceLastCheck = Date.now() - lastCheck;

        if (timeSinceLastCheck < COOLDOWN_TIME) {
            const remainingTime = Math.ceil((COOLDOWN_TIME - timeSinceLastCheck) / 1000 / 60);
            await sendMessage(senderId, `⏳ Please wait ${remainingTime} minute(s) before checking again.`);
            return;
        }

        // Update tracking
        lastCheckTime.set(senderId, Date.now());
        updateRateLimits(senderId, rateLimitConfig);

        // Use the checkStock function for manual checks
        await checkStock(senderId, false);

    } catch (error) {
        console.error('❌ Error in stock command:', error.message);
        await sendMessage(senderId, '❌ Sorry, there was an error checking the stock. Please try again later.');
    }
};

const handleAllStockCommand = async (senderId) => {
    try {
        const rateLimitCheck = isRateLimited(senderId, rateLimitConfig);
        if (rateLimitCheck.limited) {
            await sendMessage(senderId, rateLimitCheck.message);
            return;
        }

        updateRateLimits(senderId, rateLimitConfig);

        const message = await stockManager.getCurrentStock(senderId);
        await sendMessage(senderId, message);

    } catch (error) {
        console.error('❌ Error in all stock command:', error.message);
        await sendMessage(senderId, '❌ Sorry, there was an error fetching the stock information.');
    }
};

const handleSubscribeCommand = async (senderId) => {
    try {
        const rateLimitCheck = isRateLimited(senderId, rateLimitConfig);
        if (rateLimitCheck.limited) {
            await sendMessage(senderId, rateLimitCheck.message);
            return;
        }

        updateRateLimits(senderId, rateLimitConfig);

        await addSubscriber(senderId);
        stockManager.addSubscriber(senderId);
        await sendMessage(senderId, '✅ You have been subscribed to stock alerts!');

    } catch (error) {
        console.error('❌ Error in subscribe command:', error.message);
        await sendMessage(senderId, '❌ Sorry, there was an error subscribing you to alerts.');
    }
};

const handleUnsubscribeCommand = async (senderId) => {
    try {
        const rateLimitCheck = isRateLimited(senderId, rateLimitConfig);
        if (rateLimitCheck.limited) {
            await sendMessage(senderId, rateLimitCheck.message);
            return;
        }

        updateRateLimits(senderId, rateLimitConfig);

        await removeSubscriber(senderId);
        stockManager.removeSubscriber(senderId);
        await sendMessage(senderId, '❌ You have been unsubscribed from stock alerts.');

    } catch (error) {
        console.error('❌ Error in unsubscribe command:', error.message);
        await sendMessage(senderId, '❌ Sorry, there was an error unsubscribing you from alerts.');
    }
};

const handleStatusCommand = async (senderId) => {
    try {
        const rateLimitCheck = isRateLimited(senderId, rateLimitConfig);
        if (rateLimitCheck.limited) {
            await sendMessage(senderId, rateLimitCheck.message);
            return;
        }

        updateRateLimits(senderId, rateLimitConfig);

        const wsStatus = websocketManager.isConnectionActive() ? '🟢 Active' : '🔴 Inactive';
        const subscriberCount = stockManager.subscribers.size;

        const message = `📊 Bot Status\n\n` +
            `WebSocket: ${wsStatus}\n` +
            `Subscribers: ${subscriberCount}\n` +
            `Last Update: ${websocketManager.getLastStockData() ? 'Available' : 'None'}`;

        await sendMessage(senderId, message);

    } catch (error) {
        console.error('❌ Error in status command:', error.message);
        await sendMessage(senderId, '❌ Sorry, there was an error getting the bot status.');
    }
};

const handleHelpCommand = async (senderId) => {
    try {
        const rateLimitCheck = isRateLimited(senderId, rateLimitConfig);
        if (rateLimitCheck.limited) {
            await sendMessage(senderId, rateLimitCheck.message);
            return;
        }

        updateRateLimits(senderId, rateLimitConfig);

        const helpMessage = `🤖 RelStocks Bot Commands

📦 Stock Commands:
• \`stock\` - Check for alert items (5 min cooldown)
• \`all\` - Show all current stock items

🔔 Subscription Commands:
• \`subscribe\` - Subscribe to stock alerts
• \`unsubscribe\` - Unsubscribe from stock alerts

🔔 Custom Alert Commands:
• \`add <category> <item>\` - Add custom alert (e.g., add seed bell_pepper)
• \`remove <category> <item>\` - Remove custom alert
• \`myalerts\` - View your custom alerts
• \`defaultalerts\` - View default alert items

📊 Status Commands:
• \`status\` - Check bot status and WebSocket connection
• \`help\` - Show this help message
• \`about\` - About the bot

💡 Tips:
• Use \`stock\` to check for your alert items
• Use \`all\` to see everything in stock
• Real-time alerts are sent automatically when items become available
• Categories: seed, gear, egg, eventshop, cosmetic

⏱️ Rate Limits:
• 2 seconds between commands
• 5 minutes between stock checks
• 100 commands per day maximum`;

        await sendMessage(senderId, helpMessage);

    } catch (error) {
        console.error('❌ Error in help command:', error.message);
        await sendMessage(senderId, '❌ Sorry, there was an error showing the help message.');
    }
};

const handleAddAlertCommand = async (senderId, text) => {
    try {
        const rateLimitCheck = isRateLimited(senderId, rateLimitConfig);
        if (rateLimitCheck.limited) {
            await sendMessage(senderId, rateLimitCheck.message);
            return;
        }

        updateRateLimits(senderId, rateLimitConfig);

        const parts = text.toLowerCase().split(' ');
        if (parts.length !== 3) {
            await sendMessage(senderId, '❌ Usage: add <category> <item_id>\nExample: add seed bell_pepper');
            return;
        }

        let [_, category, itemId] = parts;

        // Category alias mapping for better UX
        const categoryAlias = {
            egg: 'egg_stock',
            seed: 'seed_stock',
            gear: 'gear_stock',
            eventshop: 'eventshop_stock',
            eggs: 'egg_stock',
            seeds: 'seed_stock',
            gears: 'gear_stock',
            eventshops: 'eventshop_stock'
        };

        if (categoryAlias[category]) category = categoryAlias[category];

        const validCategories = ['seed_stock', 'gear_stock', 'egg_stock', 'eventshop_stock', 'cosmetic_stock'];
        if (!validCategories.includes(category)) {
            await sendMessage(senderId, `❌ Invalid category "${category}". Valid categories: ${validCategories.join(', ')}`);
            return;
        }

        const success = await addAlert(senderId, category, itemId);
        const categoryName = categoryNames[category] || category;
        await sendMessage(senderId, success
            ? `✅ Alert added for ${formatItemName(itemId)} in ${categoryName}`
            : '❌ Failed to add alert.');

    } catch (error) {
        console.error('❌ Error in add alert command:', error.message);
        await sendMessage(senderId, '❌ Sorry, there was an error adding the alert.');
    }
};

const handleRemoveAlertCommand = async (senderId, text) => {
    try {
        const rateLimitCheck = isRateLimited(senderId, rateLimitConfig);
        if (rateLimitCheck.limited) {
            await sendMessage(senderId, rateLimitCheck.message);
            return;
        }

        updateRateLimits(senderId, rateLimitConfig);

        const parts = text.toLowerCase().split(' ');
        if (parts.length !== 3) {
            await sendMessage(senderId, '❌ Usage: remove <category> <item_id>\nExample: remove seed bell_pepper');
            return;
        }

        let [_, category, itemId] = parts;

        // Category alias mapping for better UX
        const categoryAlias = {
            egg: 'egg_stock',
            seed: 'seed_stock',
            gear: 'gear_stock',
            eventshop: 'eventshop_stock',
            eggs: 'egg_stock',
            seeds: 'seed_stock',
            gears: 'gear_stock',
            eventshops: 'eventshop_stock'
        };

        if (categoryAlias[category]) category = categoryAlias[category];

        const validCategories = ['seed_stock', 'gear_stock', 'egg_stock', 'eventshop_stock', 'cosmetic_stock'];
        if (!validCategories.includes(category)) {
            await sendMessage(senderId, `❌ Invalid category "${category}". Valid categories: ${validCategories.join(', ')}`);
            return;
        }

        const success = await removeAlert(senderId, category, itemId);
        const categoryName = categoryNames[category] || category;
        await sendMessage(senderId, success
            ? `✅ Alert removed for ${formatItemName(itemId)} in ${categoryName}`
            : '❌ Failed to remove alert.');

    } catch (error) {
        console.error('❌ Error in remove alert command:', error.message);
        await sendMessage(senderId, '❌ Sorry, there was an error removing the alert.');
    }
};

const handleMyAlertsCommand = async (senderId) => {
    try {
        const rateLimitCheck = isRateLimited(senderId, rateLimitConfig);
        if (rateLimitCheck.limited) {
            await sendMessage(senderId, rateLimitCheck.message);
            return;
        }

        updateRateLimits(senderId, rateLimitConfig);

        const userAlerts = await getUserAlerts(senderId);
        if (!userAlerts || Object.keys(userAlerts).length === 0) {
            await sendMessage(senderId, '🔕 You have no active alerts. Use add <category> <item_id> to add one.');
            return;
        }

        let alertMsg = `🔔 Your Active Alerts\n\n`;
        for (const [category, items] of Object.entries(userAlerts)) {
            const categoryName = categoryNames[category] || category;
            alertMsg += `${categoryName}\n${items.map(item => `• ${formatItemName(item)}`).join('\n')}\n\n`;
        }
        await sendMessage(senderId, alertMsg);

    } catch (error) {
        console.error('❌ Error in my alerts command:', error.message);
        await sendMessage(senderId, '❌ Sorry, there was an error fetching your alerts.');
    }
};

const handleDefaultAlertsCommand = async (senderId) => {
    try {
        const rateLimitCheck = isRateLimited(senderId, rateLimitConfig);
        if (rateLimitCheck.limited) {
            await sendMessage(senderId, rateLimitCheck.message);
            return;
        }

        updateRateLimits(senderId, rateLimitConfig);

        let alertsMessage = `🔔 Default Stock Alerts\n\n`;

        for (const [category, items] of Object.entries(defaultAlerts)) {
            const categoryName = categoryNames[category] || category;
            const formattedItems = items.map(item => `• ${formatItemName(item)}`).join('\n');
            alertsMessage += `${categoryName}\n${formattedItems}\n\n`;
        }

        alertsMessage += `ℹ️ These are the items that will trigger notifications when they are in stock.`;
        await sendMessage(senderId, alertsMessage);

    } catch (error) {
        console.error('❌ Error in default alerts command:', error.message);
        await sendMessage(senderId, '❌ Sorry, there was an error fetching default alerts.');
    }
};

const handleAboutCommand = async (senderId) => {
    try {
        const rateLimitCheck = isRateLimited(senderId, rateLimitConfig);
        if (rateLimitCheck.limited) {
            await sendMessage(senderId, rateLimitCheck.message);
            return;
        }

        updateRateLimits(senderId, rateLimitConfig);

        const aboutMessage = `🤖 About the Bot\n\n` +
            `• This bot is developed by Janrell Quiaroro(Rel).\n\n` +
            `• It checks the stock of the game Grow a Garden (Roblox) every 5 minutes and sends notifications to users when new items are in stock.\n\n` +
            `• Rel created this bot for his own use, but decided to share it with the community.\n\n` +
            `• The services of this bot is free, Shout out to JoshLei for providing the API.\n\n` +
            `• Please DO NOT abuse the services of this bot, and keep the minimize sending commands.\n\n` +
            `• If you have any suggestions, please contact Rel on discord (@reruu).\n\n`;
        await sendMessage(senderId, aboutMessage);

    } catch (error) {
        console.error('❌ Error in about command:', error.message);
        await sendMessage(senderId, '❌ Sorry, there was an error showing the about information.');
    }
};

const handleBroadcastCommand = async (senderId, text) => {
    try {
        // Check if user is admin
        if (senderId !== ADMIN_ID) {
            await sendMessage(senderId, '❌ You are not authorized to use this command.');
            return;
        }

        const rateLimitCheck = isRateLimited(senderId, rateLimitConfig);
        if (rateLimitCheck.limited) {
            await sendMessage(senderId, rateLimitCheck.message);
            return;
        }

        // Check broadcast cooldown
        const lastBroadcast = recentBroadcasts.get(senderId) || 0;
        const timeSinceLastBroadcast = Date.now() - lastBroadcast;

        if (timeSinceLastBroadcast < BROADCAST_COOLDOWN) {
            const remainingTime = Math.ceil((BROADCAST_COOLDOWN - timeSinceLastBroadcast) / 1000);
            await sendMessage(senderId, `⏳ Please wait ${remainingTime} second(s) before sending another broadcast.`);
            return;
        }

        // Extract message from command
        const message = text.slice('broadcast '.length).trim();
        if (!message) {
            await sendMessage(senderId, '❌ Please provide a message to broadcast.\nUsage: broadcast <your message>');
            return;
        }

        // Check message length
        if (message.length > 1000) {
            await sendMessage(senderId, '❌ Broadcast message is too long. Please keep it under 1000 characters.');
            return;
        }

        // Check if this message was recently sent to prevent spam
        const messageHash = Buffer.from(message).toString('base64').substring(0, 20);
        if (recentBroadcasts.has(messageHash)) {
            await sendMessage(senderId, '❌ This message was recently broadcasted. Please wait before sending the same message again.');
            return;
        }

        updateRateLimits(senderId, rateLimitConfig);
        recentBroadcasts.set(senderId, Date.now());
        recentBroadcasts.set(messageHash, Date.now());

        // Clean up old broadcast tracking
        setTimeout(() => {
            recentBroadcasts.delete(messageHash);
        }, BROADCAST_MESSAGE_TRACKING_DURATION);

        // Create broadcast message with unique identifier
        const broadcastId = Date.now().toString();
        const broadcastMessage = `📢 Broadcast Message\n\n${message}\n\n-Rel`;

        let successCount = 0;
        let failCount = 0;
        const failedSubscribers = new Set();

        console.log(`📢 Starting broadcast to ${stockManager.subscribers.size} subscribers...`);
        console.log(`Broadcast ID: ${broadcastId}`);
        console.log(`Message: ${message.substring(0, 100)}...`);

        // Send initial confirmation to admin
        await sendMessage(senderId, `📢 Broadcasting message to ${stockManager.subscribers.size} subscribers...\nBroadcast ID: ${broadcastId}`);

        // First attempt to send to all subscribers
        const broadcastPromises = Array.from(stockManager.subscribers).map(async (userId) => {
            try {
                const sent = await sendMessage(userId, broadcastMessage);
                if (sent) {
                    successCount++;
                    console.log(`✅ Broadcast sent to ${userId}`);
                } else {
                    console.error(`❌ Failed to send broadcast to subscriber ${userId}`);
                    failedSubscribers.add(userId);
                    failCount++;
                }
            } catch (err) {
                console.error(`❌ Error sending broadcast to ${userId}:`, err.message);
                failedSubscribers.add(userId);
                failCount++;
            }
        });

        // Wait for all broadcasts to be sent
        await Promise.allSettled(broadcastPromises);

        // If there are failed subscribers, retry immediately without delay
        if (failedSubscribers.size > 0) {
            console.log(`🔄 Retrying failed broadcasts for ${failedSubscribers.size} subscribers...`);

            const retryPromises = Array.from(failedSubscribers).map(async (userId) => {
                try {
                    const retrySent = await sendMessage(userId, broadcastMessage);
                    if (retrySent) {
                        successCount++;
                        failCount--;
                        console.log(`✅ Successfully sent broadcast to subscriber ${userId} after retry`);
                    } else {
                        console.error(`❌ Failed to send broadcast to subscriber ${userId} after retry`);
                    }
                } catch (err) {
                    console.error(`❌ Error retrying broadcast to ${userId}:`, err.message);
                }
            });

            await Promise.allSettled(retryPromises);
        }

        // Send final confirmation message
        const confirmationMessage = `✅ Broadcast Complete!\n\n` +
            `📊 Results:\n` +
            `• Successfully sent: ${successCount}\n` +
            `• Failed to send: ${failCount}\n` +
            `• Total subscribers: ${stockManager.subscribers.size}\n` +
            `• Broadcast ID: ${broadcastId}\n\n` +
            `⏰ Sent at: ${new Date().toLocaleString()}`;

        await sendMessage(senderId, confirmationMessage);

        // Log broadcast completion
        console.log(`📢 Broadcast completed - Success: ${successCount}, Failed: ${failCount}`);

    } catch (error) {
        console.error('❌ Error in broadcast command:', error.message);
        await sendMessage(senderId, '❌ Sorry, there was an error sending the broadcast. Please try again later.');
    }
};

// Message processing
const processMessage = async (senderId, message) => {
    const text = message.toLowerCase().trim();

    // Check if message was recently sent to prevent loops
    if (isRecentlySentMessage(text, recentlySentMessages)) {
        console.log('🔄 Skipping recently sent message');
        return;
    }

    try {
        // Handle broadcast command with enhanced safety
        if (text.startsWith('broadcast ')) {
            await handleBroadcastCommand(senderId, text);
            return;
        }

        // Handle commands that start with specific prefixes
        if (text.startsWith('add ')) {
            await handleAddAlertCommand(senderId, text);
            return;
        }

        if (text.startsWith('remove ')) {
            await handleRemoveAlertCommand(senderId, text);
            return;
        }

        switch (text) {
            case 'stock':
                await handleStockCommand(senderId);
                break;
            case 'all':
                await handleAllStockCommand(senderId);
                break;
            case 'subscribe':
                await handleSubscribeCommand(senderId);
                break;
            case 'unsubscribe':
                await handleUnsubscribeCommand(senderId);
                break;
            case 'status':
                await handleStatusCommand(senderId);
                break;
            case 'help':
                await handleHelpCommand(senderId);
                break;
            case 'myalerts':
                await handleMyAlertsCommand(senderId);
                break;
            case 'defaultalerts':
                await handleDefaultAlertsCommand(senderId);
                break;
            case 'about':
                await handleAboutCommand(senderId);
                break;
            default:
                if (senderId === ADMIN_ID) {
                    await sendMessage(senderId, 'Unknown command. Type \`help\` for available commands.\n\nAdmin commands:\n• broadcast <message> - Send message to all subscribers');
                }
                break;
        }
    } catch (error) {
        console.error('❌ Error processing message:', error.message);
        if (senderId === ADMIN_ID) {
            await sendMessage(senderId, '❌ An error occurred while processing your command.');
        }
    }
};

// Webhook verification
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('✅ Webhook verified');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

// Webhook endpoint
app.post('/webhook', (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        body.entry.forEach(entry => {
            const webhookEvent = entry.messaging[0];
            const senderId = webhookEvent.sender.id;
            const message = webhookEvent.message;

            if (message && message.text) {
                processMessage(senderId, message.text);
            }
        });

        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    const status = {
        websocket: websocketManager.isConnectionActive(),
        subscribers: stockManager.subscribers.size,
        lastUpdate: websocketManager.getLastStockData() ? 'Available' : 'None',
        timestamp: new Date().toISOString()
    };

    res.json(status);
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    initializeApp();
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    websocketManager.disconnect();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down gracefully...');
    websocketManager.disconnect();
    process.exit(0);
}); 