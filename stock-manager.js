const { formatItemName, categoryNames } = require('./utils');

class StockManager {
    constructor(apiClient, websocketManager) {
        this.apiClient = apiClient;
        this.websocketManager = websocketManager;
        this.lastStockData = null;
        this.subscribers = new Set();
        this.defaultAlerts = {
            seed_stock: ['banana', 'pineapple', 'avocado', 'kiwi', 'bell_pepper', 'prickly_pear', 'loquat', 'feijoa', 'sugar_apple'],
            gear_stock: ['advanced_sprinkler', 'master_sprinkler', 'godly_sprinkler', 'tanning_mirror', 'lightning_rod', 'friendship_pot'],
            egg_stock: ['bug_egg', 'mythical_egg', 'paradise_egg']
        };

        // Track last seen items for 30-min restock categories
        this.lastSeenStock = new Map();
        this.lastCheckTime30Min = new Map();

        // Set up WebSocket handlers
        this.setupWebSocketHandlers();
    }

    setupWebSocketHandlers() {
        if (this.websocketManager) {
            this.websocketManager.onStockUpdate = (data) => {
                this.handleStockUpdate(data);
            };

            this.websocketManager.onError = (error) => {
                console.error('❌ WebSocket error in stock manager:', error);
            };

            this.websocketManager.onConnect = () => {
                console.log('✅ WebSocket connected - real-time stock monitoring active');
            };

            this.websocketManager.onDisconnect = () => {
                console.log('⚠️ WebSocket disconnected - falling back to API polling');
            };
        }
    }

    addSubscriber(userId) {
        this.subscribers.add(userId);
    }

    removeSubscriber(userId) {
        this.subscribers.delete(userId);
    }

    setSubscribers(subscribers) {
        this.subscribers = new Set(subscribers);
    }

    async handleStockUpdate(data) {
        console.log('📦 Processing stock update...');
        this.lastStockData = data;

        // Check alerts for all subscribers
        for (const userId of this.subscribers) {
            try {
                await this.checkStockForUser(userId, data, true);
            } catch (error) {
                console.error(`❌ Error checking stock for user ${userId}:`, error.message);
            }
        }
    }

    async checkStockForUser(userId, data, isRealtime = false) {
        // Get user's custom alerts or use defaults
        let alertsToCheck = this.defaultAlerts;
        // TODO: Get user alerts from database
        // const userAlerts = await getUserAlerts(userId);
        // if (userAlerts && Object.keys(userAlerts).length > 0) {
        //     alertsToCheck = userAlerts;
        // }

        let foundItems = [];
        let hasNewSeedOrGear = false;

        // Check seed and gear stock first
        for (let category of ['seed_stock', 'gear_stock']) {
            if (!data[category]) continue;

            const matches = data[category]?.filter(item =>
                item && item.item_id && alertsToCheck[category]?.includes(item.item_id)
            );

            if (matches?.length) {
                const itemsList = matches.map(i => `• ${formatItemName(i.item_id)}`).join('\n');
                foundItems.push(`${categoryNames[category]}\n${itemsList}`);
                hasNewSeedOrGear = true;
            }
        }

        // Check egg and eventshop stock (30-min restock items)
        for (let category of ['egg_stock', 'eventshop_stock']) {
            if (!data[category]) continue;

            const matches = data[category]?.filter(item =>
                item && item.item_id && alertsToCheck[category]?.includes(item.item_id)
            );

            if (matches?.length) {
                const currentItems = new Set(matches.map(i => i.item_id));
                const lastSeen = this.lastSeenStock.get(category) || new Set();
                const lastCheck = this.lastCheckTime30Min.get(category) || 0;
                const now = Date.now();

                // Check if these are new items or if enough time has passed
                const hasNewItems = [...currentItems].some(item => !lastSeen.has(item));
                const timeSinceLastCheck = now - lastCheck;
                const shouldNotify = hasNewItems || timeSinceLastCheck > 30 * 60 * 1000; // 30 minutes

                if (shouldNotify) {
                    const itemsList = matches.map(i => `• ${formatItemName(i.item_id)}`).join('\n');
                    foundItems.push(`${categoryNames[category]}\n${itemsList}`);

                    // Update tracking
                    this.lastSeenStock.set(category, currentItems);
                    this.lastCheckTime30Min.set(category, now);
                }
            }
        }

        // Send notification if items found
        if (foundItems.length > 0) {
            const source = isRealtime ? '🔔 Real-time' : '📦 Manual';
            const message = `${source} Stock Alert!\n\n${foundItems.join('\n\n')}`;

            // TODO: Send message to user
            // await sendMessage(userId, message);
            console.log(`📤 Sending alert to ${userId}:`, message);
        }
    }

    async getCurrentStock(senderId) {
        try {
            // Try WebSocket data first if available
            let stockData = this.websocketManager?.getLastStockData();

            if (!stockData) {
                // Fall back to API call
                stockData = await this.apiClient.getStock();
            }

            return this.formatStockMessage(stockData);
        } catch (error) {
            console.error('❌ Error getting current stock:', error.message);
            throw error;
        }
    }

    formatStockMessage(data) {
        let stockMessage = [];

        for (let category in data) {
            // Skip cosmetic_stock category
            if (category === 'cosmetic_stock') continue;

            if (data[category] && Array.isArray(data[category]) && data[category].length > 0) {
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
            return `📦 Current Stock Status\n\n${stockMessage.join('\n\n')}`;
        } else {
            return '❌ No items currently in stock.';
        }
    }

    async manualStockCheck(senderId) {
        try {
            const data = await this.apiClient.getStock();
            await this.checkStockForUser(senderId, data, false);
            return this.formatStockMessage(data);
        } catch (error) {
            console.error('❌ Error in manual stock check:', error.message);
            throw error;
        }
    }

    getLastStockData() {
        return this.lastStockData;
    }

    isWebSocketActive() {
        return this.websocketManager?.isConnectionActive() || false;
    }
}

module.exports = StockManager; 