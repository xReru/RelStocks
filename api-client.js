const axios = require('axios');

class APIClient {
    constructor(baseURL, timeout = 10000) {
        this.client = axios.create({
            baseURL,
            timeout,
            headers: {
                'User-Agent': 'RelStocks-Bot/1.1'
            }
        });
    }

    async getStock(retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await this.client.get('/v2/growagarden/stock');

                if (response.status !== 200) {
                    throw new Error(`Unexpected status code: ${response.status}`);
                }

                return response.data;
            } catch (error) {
                console.error(`❌ API request failed (attempt ${attempt}/${retries}):`, error.message);

                if (attempt === retries) {
                    throw error;
                }

                // Wait before retry with exponential backoff
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    async getWeather() {
        try {
            const response = await this.client.get('/v2/growagarden/weather');
            return response.data;
        } catch (error) {
            console.error('❌ Error fetching weather:', error.message);
            throw error;
        }
    }

    async getNotifications() {
        try {
            const response = await this.client.get('/v2/growagarden/notifications');
            return response.data;
        } catch (error) {
            console.error('❌ Error fetching notifications:', error.message);
            throw error;
        }
    }

    // Add more API methods as needed for other manual commands
    async getGardenStatus() {
        try {
            const response = await this.client.get('/v2/growagarden/status');
            return response.data;
        } catch (error) {
            console.error('❌ Error fetching garden status:', error.message);
            throw error;
        }
    }
}

module.exports = APIClient; 