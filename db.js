const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: Missing Supabase credentials. Please check your .env file.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize subscribers table if it doesn't exist
const initDatabase = async () => {
    try {
        const { error } = await supabase
            .from('subscribers')
            .select('*')
            .limit(1);

        if (error && error.code === '42P01') { // Table doesn't exist
            const { error: createError } = await supabase.rpc('create_subscribers_table');
            if (createError) {
                console.error('Error creating subscribers table:', createError);
                process.exit(1);
            }
            console.log('✅ Subscribers table created successfully');
        }
    } catch (err) {
        console.error('Error initializing database:', err);
        process.exit(1);
    }
};

// Get all subscribers
const getSubscribers = async () => {
    try {
        const { data, error } = await supabase
            .from('subscribers')
            .select('user_id');

        if (error) throw error;
        return new Set(data.map(row => row.user_id));
    } catch (err) {
        console.error('Error getting subscribers:', err);
        return new Set();
    }
};

const addAlert = async (userId, category, itemId) => {
    try {
        const { error } = await supabase
            .from('subscriber_alerts')
            .insert([{ user_id: userId, category, item_id: itemId }]);

        if (error) throw error;
        return true;
    } catch (err) {
        console.error('Error adding alert:', err);
        return false;
    }
};

const removeAlert = async (userId, category, itemId) => {
    try {
        const { error } = await supabase
            .from('subscriber_alerts')
            .delete()
            .eq('user_id', userId)
            .eq('category', category)
            .eq('item_id', itemId);

        if (error) throw error;
        return true;
    } catch (err) {
        console.error('Error removing alert:', err);
        return false;
    }
};

const getUserAlerts = async (userId) => {
    try {
        const { data, error } = await supabase
            .from('subscriber_alerts')
            .select('category, item_id')
            .eq('user_id', userId);

        if (error) throw error;

        const alerts = {};
        for (const row of data) {
            if (!alerts[row.category]) alerts[row.category] = [];
            alerts[row.category].push(row.item_id);
        }

        return alerts;
    } catch (err) {
        console.error('Error getting user alerts:', err);
        return {};
    }
};

// Add a subscriber
const addSubscriber = async (userId) => {
    try {
        const { error } = await supabase
            .from('subscribers')
            .insert([{ user_id: userId }]);

        if (error) throw error;
        return true;
    } catch (err) {
        console.error('Error adding subscriber:', err);
        return false;
    }
};

// Remove a subscriber
const removeSubscriber = async (userId) => {
    try {
        const { error } = await supabase
            .from('subscribers')
            .delete()
            .eq('user_id', userId);

        if (error) throw error;
        return true;
    } catch (err) {
        console.error('Error removing subscriber:', err);
        return false;
    }
};

module.exports = {
    initDatabase,
    addAlert,
    removeAlert,
    getUserAlerts,
    getSubscribers,
    addSubscriber,
    removeSubscriber
}; 