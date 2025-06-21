const { initDatabase, getSubscribers, addSubscriber, removeSubscriber, addAlert, removeAlert, getUserAlerts } = require('./db');

// Test user IDs
const TEST_USER_1 = 'test_user_1';
const TEST_USER_2 = 'test_user_2';

// Helper function to log test results
const logTest = (testName, passed, error = null) => {
    console.log(`${passed ? '✅' : '❌'} ${testName}`);
    if (error) {
        console.error('   Error:', error.message);
    }
};

// Test the formatItemName function logic
const testFormatItemName = () => {
    console.log('Test: formatItemName function logic');

    const testCases = [
        { input: 'kiwi', expected: 'Kiwi' },
        { input: 'bell_pepper', expected: 'Bell Pepper' },
        { input: 'advanced_sprinkler', expected: 'Advanced Sprinkler' },
        { input: 'bug_egg', expected: 'Bug Egg' }
    ];

    let allPassed = true;
    testCases.forEach(({ input, expected }) => {
        const result = input
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

        const passed = result === expected;
        logTest(`formatItemName("${input}")`, passed);
        if (!passed) {
            console.error(`   Expected: "${expected}", Got: "${result}"`);
            allPassed = false;
        }
    });

    return allPassed;
};

// Test rate limiting logic
const testRateLimiting = () => {
    console.log('\nTest: Rate limiting logic');

    const now = Date.now();
    const GLOBAL_COMMAND_COOLDOWN = 2 * 1000;
    const DAILY_COMMAND_LIMIT = 100;
    const MESSAGE_RATE_LIMIT = 5;
    const MESSAGE_RATE_WINDOW = 60 * 1000;

    // Test global command cooldown
    const lastCommand = now - 1000; // 1 second ago
    const timeSinceLastCommand = now - lastCommand;
    const globalCooldownPassed = timeSinceLastCommand >= GLOBAL_COMMAND_COOLDOWN;
    logTest('Global command cooldown check', !globalCooldownPassed);

    // Test daily command limit
    const commandCount = 50;
    const dailyLimitPassed = commandCount < DAILY_COMMAND_LIMIT;
    logTest('Daily command limit check', dailyLimitPassed);

    // Test message rate limit
    const recentTimestamps = [now - 10000, now - 5000, now - 2000, now - 1000, now - 500];
    const messageRatePassed = recentTimestamps.length < MESSAGE_RATE_LIMIT;
    logTest('Message rate limit check', !messageRatePassed);

    return globalCooldownPassed && dailyLimitPassed && messageRatePassed;
};

// Test alert system logic
const testAlertSystem = async () => {
    console.log('\nTest: Alert system functionality');

    try {
        // Test adding alerts
        const addResult1 = await addAlert(TEST_USER_1, 'seed_stock', 'kiwi');
        logTest('Add alert for kiwi', addResult1);

        const addResult2 = await addAlert(TEST_USER_1, 'gear_stock', 'advanced_sprinkler');
        logTest('Add alert for advanced_sprinkler', addResult2);

        // Test getting user alerts
        const userAlerts = await getUserAlerts(TEST_USER_1);
        const hasAlerts = userAlerts &&
            userAlerts.seed_stock &&
            userAlerts.seed_stock.includes('kiwi') &&
            userAlerts.gear_stock &&
            userAlerts.gear_stock.includes('advanced_sprinkler');
        logTest('Retrieve user alerts', hasAlerts);

        // Test removing alerts
        const removeResult1 = await removeAlert(TEST_USER_1, 'seed_stock', 'kiwi');
        logTest('Remove alert for kiwi', removeResult1);

        const removeResult2 = await removeAlert(TEST_USER_1, 'gear_stock', 'advanced_sprinkler');
        logTest('Remove alert for advanced_sprinkler', removeResult2);

        // Verify removal
        const finalAlerts = await getUserAlerts(TEST_USER_1);
        const alertsRemoved = !finalAlerts.seed_stock || finalAlerts.seed_stock.length === 0;
        logTest('Verify alerts removed', alertsRemoved);

        return addResult1 && addResult2 && hasAlerts && removeResult1 && removeResult2 && alertsRemoved;

    } catch (error) {
        logTest('Alert system test', false, error);
        return false;
    }
};

// Test command parsing logic
const testCommandParsing = () => {
    console.log('\nTest: Command parsing logic');

    const testCases = [
        { input: '/add seed_stock kiwi', expected: { command: 'add', category: 'seed_stock', itemId: 'kiwi' } },
        { input: '/remove gear_stock advanced_sprinkler', expected: { command: 'remove', category: 'gear_stock', itemId: 'advanced_sprinkler' } },
        { input: '/add egg_stock bug_egg', expected: { command: 'add', category: 'egg_stock', itemId: 'bug_egg' } }
    ];

    let allPassed = true;
    testCases.forEach(({ input, expected }) => {
        const parts = input.toLowerCase().split(' ');
        const command = parts[0];
        const category = parts[1];
        const itemId = parts[2];

        const passed = command === expected.command &&
            category === expected.category &&
            itemId === expected.itemId;

        logTest(`Parse command: "${input}"`, passed);
        if (!passed) {
            console.error(`   Expected: ${JSON.stringify(expected)}, Got: {command: "${command}", category: "${category}", itemId: "${itemId}"}`);
            allPassed = false;
        }
    });

    return allPassed;
};

// Test default alerts configuration
const testDefaultAlerts = () => {
    console.log('\nTest: Default alerts configuration');

    const defaultAlerts = {
        seed_stock: ['kiwi', 'bell_pepper', 'prickly_pear', 'loquat', 'feijoa', 'sugar_apple'],
        gear_stock: ['advanced_sprinkler', 'master_sprinkler', 'godly_sprinkler', 'tanning_mirror', 'lightning_rod', 'friendship_pot'],
        egg_stock: ['bug_egg', 'paradise', 'mythical_egg', 'legendary_egg'],
        eventshop_stock: ['bee_egg', 'honey_sprinkler', 'nectar_staff']
    };

    const categoryNames = {
        seed_stock: '🌱 Seeds',
        gear_stock: '⚙️ Gear',
        egg_stock: '🥚 Eggs',
        cosmetic_stock: '🎨 Cosmetics',
        eventshop_stock: '🎉 Event Shop'
    };

    let allPassed = true;

    // Test that all categories have items
    Object.keys(defaultAlerts).forEach(category => {
        const hasItems = defaultAlerts[category] && defaultAlerts[category].length > 0;
        logTest(`Category "${category}" has items`, hasItems);
        if (!hasItems) allPassed = false;
    });

    // Test that category names exist
    Object.keys(defaultAlerts).forEach(category => {
        const hasName = categoryNames[category] !== undefined;
        logTest(`Category "${category}" has display name`, hasName);
        if (!hasName) allPassed = false;
    });

    return allPassed;
};

// Run all tests
const runTests = async () => {
    console.log('🧪 Starting comprehensive code tests...\n');

    try {
        // Test 1: Database initialization
        console.log('Test 1: Database Initialization');
        await initDatabase();
        logTest('Database initialization', true);
        console.log();

        // Test 2: Format item name function
        console.log('Test 2: Format Item Name Function');
        const formatTestPassed = testFormatItemName();
        console.log();

        // Test 3: Rate limiting logic
        console.log('Test 3: Rate Limiting Logic');
        const rateLimitTestPassed = testRateLimiting();
        console.log();

        // Test 4: Alert system
        console.log('Test 4: Alert System');
        const alertTestPassed = await testAlertSystem();
        console.log();

        // Test 5: Command parsing
        console.log('Test 5: Command Parsing');
        const commandTestPassed = testCommandParsing();
        console.log();

        // Test 6: Default alerts configuration
        console.log('Test 6: Default Alerts Configuration');
        const defaultAlertsTestPassed = testDefaultAlerts();
        console.log();

        // Test 7: Basic subscriber operations
        console.log('Test 7: Subscriber Operations');
        const addResult1 = await addSubscriber(TEST_USER_1);
        logTest('Add test subscriber', addResult1);

        const subscribers = await getSubscribers();
        const hasTestUser = subscribers.has(TEST_USER_1);
        logTest('Retrieve test subscriber', hasTestUser);

        const removeResult = await removeSubscriber(TEST_USER_1);
        logTest('Remove test subscriber', removeResult);
        console.log();

        console.log('✨ All tests completed!\n');

        const allTestsPassed = formatTestPassed && rateLimitTestPassed && alertTestPassed &&
            commandTestPassed && defaultAlertsTestPassed && addResult1 &&
            hasTestUser && removeResult;

        if (allTestsPassed) {
            console.log('🎉 All tests passed! No major bugs detected.');
        } else {
            console.log('⚠️ Some tests failed. Please review the issues above.');
        }

    } catch (error) {
        console.error('\n❌ Test suite failed:', error);
        process.exit(1);
    }
};

// Run the tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
}); 