// Category names mapping
const categoryNames = {
    seed_stock: '🌱 Seeds',
    gear_stock: '🛠️ Gear',
    egg_stock: '🥚 Eggs',
    cosmetic_stock: '🎨 Cosmetics',
    eventshop_stock: '🎪 Event Shop'
};

// Format item names for display
const formatItemName = (itemId) => {
    if (!itemId) return 'Unknown Item';

    // Convert snake_case to Title Case
    return itemId
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
};

// Rate limiting utilities
const isRateLimited = (senderId, rateLimitConfig) => {
    const {
        globalCommandCooldown,
        dailyCommandLimit,
        messageRateLimit,
        messageRateWindow,
        lastCommandTime,
        dailyCommandCount,
        lastCommandReset,
        messageCounts,
        messageTimestamps
    } = rateLimitConfig;

    const now = Date.now();

    // Check global command cooldown
    const lastCommand = lastCommandTime.get(senderId) || 0;
    if (now - lastCommand < globalCommandCooldown) {
        return {
            limited: true,
            message: `⏳ Please wait ${Math.ceil((globalCommandCooldown - (now - lastCommand)) / 1000)} second(s) before using another command.`
        };
    }

    // Check daily command limit
    const lastReset = lastCommandReset.get(senderId) || 0;
    const today = new Date().setHours(0, 0, 0, 0);

    if (lastReset < today) {
        dailyCommandCount.set(senderId, 0);
        lastCommandReset.set(senderId, now);
    }

    const commandCount = dailyCommandCount.get(senderId) || 0;
    if (commandCount >= dailyCommandLimit) {
        return {
            limited: true,
            message: `❌ You have reached your daily command limit of ${dailyCommandLimit} commands. Please try again tomorrow.`
        };
    }

    // Check message rate limit
    const userMessages = messageCounts.get(senderId) || 0;
    const userTimestamps = messageTimestamps.get(senderId) || [];

    const recentTimestamps = userTimestamps.filter(timestamp => now - timestamp < messageRateWindow);
    messageTimestamps.set(senderId, recentTimestamps);

    if (recentTimestamps.length >= messageRateLimit) {
        return {
            limited: true,
            message: `⏳ You are sending messages too quickly. Please wait ${Math.ceil((messageRateWindow - (now - recentTimestamps[0])) / 1000)} second(s).`
        };
    }

    return { limited: false };
};

const updateRateLimits = (senderId, rateLimitConfig) => {
    const {
        globalCommandCooldown,
        dailyCommandCount,
        messageTimestamps
    } = rateLimitConfig;

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

// Message tracking utilities
const trackSentMessage = (message, recentlySentMessages, trackingDuration) => {
    const messageHash = Buffer.from(message).toString('base64').substring(0, 20);
    recentlySentMessages.add(messageHash);

    setTimeout(() => {
        recentlySentMessages.delete(messageHash);
    }, trackingDuration);
};

const isRecentlySentMessage = (message, recentlySentMessages) => {
    const messageHash = Buffer.from(message).toString('base64').substring(0, 20);
    return recentlySentMessages.has(messageHash);
};

// Time utilities
const getNextCheckTime = () => {
    const now = new Date();
    const phTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const minutes = phTime.getUTCMinutes();
    const nextCheck = new Date(phTime);
    nextCheck.setUTCMinutes(Math.ceil(minutes / 5) * 5);
    nextCheck.setUTCSeconds(0);
    nextCheck.setUTCMilliseconds(0);
    return new Date(nextCheck.getTime() - (8 * 60 * 60 * 1000));
};

module.exports = {
    categoryNames,
    formatItemName,
    isRateLimited,
    updateRateLimits,
    trackSentMessage,
    isRecentlySentMessage,
    getNextCheckTime
}; 