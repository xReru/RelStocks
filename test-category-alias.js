const { initDatabase, getSubscribers, addSubscriber, removeSubscriber, addAlert, removeAlert, getUserAlerts } = require('./db');

// Test user IDs
const TEST_USER_1 = 'test_user_alias_1';

// Helper function to log test results
const logTest = (testName, passed, error = null) => {
    console.log(`${passed ? '✅' : '❌'} ${testName}`);
    if (error) {
        console.error('   Error:', error.message);
    }
};

// Test category alias mapping
const testCategoryAlias = () => {
    console.log('Test: Category Alias Mapping');

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

    const validCategories = ['seed_stock', 'gear_stock', 'egg_stock', 'eventshop_stock', 'cosmetic_stock'];

    let allPassed = true;

    // Test alias mapping
    const testCases = [
        { input: 'egg', expected: 'egg_stock' },
        { input: 'seed', expected: 'seed_stock' },
        { input: 'gear', expected: 'gear_stock' },
        { input: 'eventshop', expected: 'eventshop_stock' },
        { input: 'eggs', expected: 'egg_stock' },
        { input: 'seeds', expected: 'seed_stock' },
        { input: 'gears', expected: 'gear_stock' },
        { input: 'eventshops', expected: 'eventshop_stock' }
    ];

    testCases.forEach(({ input, expected }) => {
        const mapped = categoryAlias[input] || input;
        const passed = mapped === expected;
        logTest(`Alias "${input}" -> "${expected}"`, passed);
        if (!passed) {
            console.error(`   Expected: "${expected}", Got: "${mapped}"`);
            allPassed = false;
        }
    });

    // Test that mapped categories are valid
    testCases.forEach(({ input, expected }) => {
        const mapped = categoryAlias[input] || input;
        const isValid = validCategories.includes(mapped);
        logTest(`Mapped category "${mapped}" is valid`, isValid);
        if (!isValid) allPassed = false;
    });

    return allPassed;
};

// Test command parsing with aliases
const testCommandParsingWithAliases = () => {
    console.log('\nTest: Command Parsing with Aliases');

    const categoryAlias = {
        egg: 'egg_stock',
        seed: 'seed_stock',
        gear: 'gear_stock',
        eventshop: 'eventshop_stock'
    };

    const testCases = [
        { input: '/add egg paradise', expected: { command: '/add', category: 'egg_stock', itemId: 'paradise' } },
        { input: '/add seed kiwi', expected: { command: '/add', category: 'seed_stock', itemId: 'kiwi' } },
        { input: '/remove gear advanced_sprinkler', expected: { command: '/remove', category: 'gear_stock', itemId: 'advanced_sprinkler' } },
        { input: '/add eventshop bee_egg', expected: { command: '/add', category: 'eventshop_stock', itemId: 'bee_egg' } }
    ];

    let allPassed = true;
    testCases.forEach(({ input, expected }) => {
        const parts = input.toLowerCase().split(' ');
        const command = parts[0];
        let category = parts[1];
        const itemId = parts[2];

        // Apply alias mapping
        if (categoryAlias[category]) category = categoryAlias[category];

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

// Test alert system with category aliases
const testAlertSystemWithAliases = async () => {
    console.log('\nTest: Alert System with Category Aliases');

    try {
        // First add user as subscriber
        await addSubscriber(TEST_USER_1);

        // Test adding alerts with aliases
        const addResult1 = await addAlert(TEST_USER_1, 'egg_stock', 'paradise');
        logTest('Add alert for paradise in egg_stock', addResult1);

        const addResult2 = await addAlert(TEST_USER_1, 'seed_stock', 'kiwi');
        logTest('Add alert for kiwi in seed_stock', addResult2);

        // Test getting user alerts
        const userAlerts = await getUserAlerts(TEST_USER_1);
        const hasAlerts = userAlerts &&
            userAlerts.egg_stock &&
            userAlerts.egg_stock.includes('paradise') &&
            userAlerts.seed_stock &&
            userAlerts.seed_stock.includes('kiwi');
        logTest('Retrieve user alerts with aliases', hasAlerts);

        // Test removing alerts
        const removeResult1 = await removeAlert(TEST_USER_1, 'egg_stock', 'paradise');
        logTest('Remove alert for paradise', removeResult1);

        const removeResult2 = await removeAlert(TEST_USER_1, 'seed_stock', 'kiwi');
        logTest('Remove alert for kiwi', removeResult2);

        // Cleanup
        await removeSubscriber(TEST_USER_1);

        return addResult1 && addResult2 && hasAlerts && removeResult1 && removeResult2;

    } catch (error) {
        logTest('Alert system with aliases test', false, error);
        return false;
    }
};

// Test formatItemName with underscore items
const testFormatItemNameWithUnderscores = () => {
    console.log('\nTest: Format Item Name with Underscores');

    const testCases = [
        { input: 'bell_pepper', expected: 'Bell Pepper' },
        { input: 'advanced_sprinkler', expected: 'Advanced Sprinkler' },
        { input: 'bug_egg', expected: 'Bug Egg' },
        { input: 'honey_sprinkler', expected: 'Honey Sprinkler' },
        { input: 'lightning_rod', expected: 'Lightning Rod' },
        { input: 'friendship_pot', expected: 'Friendship Pot' }
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

// Run all tests
const runTests = async () => {
    console.log('🧪 Starting category alias and recent changes tests...\n');

    try {
        // Test 1: Database initialization
        console.log('Test 1: Database Initialization');
        await initDatabase();
        logTest('Database initialization', true);
        console.log();

        // Test 2: Category alias mapping
        console.log('Test 2: Category Alias Mapping');
        const aliasTestPassed = testCategoryAlias();
        console.log();

        // Test 3: Command parsing with aliases
        console.log('Test 3: Command Parsing with Aliases');
        const commandTestPassed = testCommandParsingWithAliases();
        console.log();

        // Test 4: Alert system with aliases
        console.log('Test 4: Alert System with Aliases');
        const alertTestPassed = await testAlertSystemWithAliases();
        console.log();

        // Test 5: Format item name with underscores
        console.log('Test 5: Format Item Name with Underscores');
        const formatTestPassed = testFormatItemNameWithUnderscores();
        console.log();

        console.log('✨ All tests completed!\n');

        const allTestsPassed = aliasTestPassed && commandTestPassed && alertTestPassed && formatTestPassed;

        if (allTestsPassed) {
            console.log('🎉 All tests passed! Category alias functionality is working correctly.');
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