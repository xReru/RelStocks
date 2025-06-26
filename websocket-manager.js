const WebSocket = require('ws');

class WebSocketManager {
    constructor(userId, onStockUpdate, onError, onConnect, onDisconnect) {
        this.userId = userId;
        this.onStockUpdate = onStockUpdate;
        this.onError = onError;
        this.onConnect = onConnect;
        this.onDisconnect = onDisconnect;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000; // 5 seconds
        this.isConnected = false;
        this.lastStockData = null;
    }

    connect() {
        try {
            const wsUrl = `wss://websocket.joshlei.com/growagarden?user_id=${encodeURIComponent(this.userId)}`;
            console.log(`🔌 Attempting WebSocket connection to: ${wsUrl}`);
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                console.log('🔌 WebSocket connection established.');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                if (this.onConnect) this.onConnect();
            });

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleMessage(message);
                } catch (error) {
                    console.error('❌ Error parsing WebSocket message:', error);
                }
            });

            this.ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
                this.isConnected = false;
                if (this.onError) this.onError(error);
            });

            this.ws.on('close', (code, reason) => {
                console.log(`🔌 WebSocket connection closed. Code: ${code}, Reason: ${reason}`);
                this.isConnected = false;
                if (this.onDisconnect) this.onDisconnect();
                this.attemptReconnect();
            });

        } catch (error) {
            console.error('❌ Error creating WebSocket connection:', error);
            this.attemptReconnect();
        }
    }

    handleMessage(message) {
        // Handle different types of stock updates
        if (message.seed_stock || message.gear_stock || message.egg_stock ||
            message.cosmetic_stock || message.eventshop_stock) {

            // Check if this is new data (not just a duplicate)
            if (this.hasStockChanged(message)) {
                console.log('📦 Stock update received via WebSocket');
                this.lastStockData = message;
                if (this.onStockUpdate) this.onStockUpdate(message);
            }
        }
    }

    hasStockChanged(newData) {
        if (!this.lastStockData) return true;

        // Compare relevant stock categories
        const categories = ['seed_stock', 'gear_stock', 'egg_stock', 'eventshop_stock'];

        for (const category of categories) {
            if (newData[category] && this.lastStockData[category]) {
                const newItems = newData[category].map(item => `${item.item_id}:${item.quantity}`).sort();
                const oldItems = this.lastStockData[category].map(item => `${item.item_id}:${item.quantity}`).sort();

                if (JSON.stringify(newItems) !== JSON.stringify(oldItems)) {
                    return true;
                }
            } else if (newData[category] !== this.lastStockData[category]) {
                return true;
            }
        }

        return false;
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('❌ Max reconnection attempts reached. Stopping reconnection.');
            return;
        }

        this.reconnectAttempts++;
        console.log(`🔄 Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        setTimeout(() => {
            this.connect();
        }, this.reconnectDelay * this.reconnectAttempts);
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }

    isConnectionActive() {
        return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    getDetailedStatus() {
        return {
            isConnected: this.isConnected,
            hasWebSocket: !!this.ws,
            readyState: this.ws ? this.ws.readyState : null,
            reconnectAttempts: this.reconnectAttempts,
            lastStockData: !!this.lastStockData
        };
    }

    getLastStockData() {
        return this.lastStockData;
    }
}

module.exports = WebSocketManager; 