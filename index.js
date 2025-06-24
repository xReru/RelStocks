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
    null, // Will be set by StockManager
    null, // Will be set by StockManager
    null, // Will be set by StockManager
    null  // Will be set by StockManager
);
const stockManager = new StockManager(apiClient, websocketManager);

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

// Initialize application
const initializeApp = async () => {
    try {
        await initDatabase();
        const subscribers = await getSubscribers();
        stockManager.setSubscribers(subscribers);
        console.log(`📋 Loaded ${subscribers.length} subscribers from database`);

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
            if (!stockManager.isWebSocketActive()) {
                try {
                    const data = await apiClient.getStock();
                    await stockManager.handleStockUpdate(data);
                } catch (error) {
                    console.error('❌ Error in scheduled check:', error.message);
                }
            }
        }

        scheduleNextCheck();
    }, delay);
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

        await sendMessage(senderId, "⏳ Please wait while I check the stock...");

        const message = await stockManager.manualStockCheck(senderId);
        await sendMessage(senderId, message);

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

        const wsStatus = stockManager.isWebSocketActive() ? '🟢 Active' : '🔴 Inactive';
        const subscriberCount = stockManager.subscribers.size;

        const message = `📊 Bot Status\n\n` +
            `WebSocket: ${wsStatus}\n` +
            `Subscribers: ${subscriberCount}\n` +
            `Last Update: ${stockManager.getLastStockData() ? 'Available' : 'None'}`;

        await sendMessage(senderId, message);

    } catch (error) {
        console.error('❌ Error in status command:', error.message);
        await sendMessage(senderId, '❌ Sorry, there was an error getting the bot status.');
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
            default:
                if (senderId === ADMIN_ID) {
                    await sendMessage(senderId, 'Unknown command. Available commands: stock, all, subscribe, unsubscribe, status');
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
        websocket: stockManager.isWebSocketActive(),
        subscribers: stockManager.subscribers.size,
        lastUpdate: stockManager.getLastStockData() ? 'Available' : 'None',
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