# RelStocks - Stock Alert Bot

A Facebook Messenger bot that monitors and alerts users about stock availability in GrowAGarden.

## Features

- Real-time stock monitoring
- Automatic notifications for subscribed users
- Multiple category support (Seeds, Gear, Eggs, Event Shop)
- User-friendly stock display
- Subscription system for alerts

## Commands

- `/subscribe` - Subscribe to stock alerts
- `/unsubscribe` - Unsubscribe from alerts
- `/checkstock` - Check alert items
- `/stock` - Display all current stock

## Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/RelStocks.git
cd RelStocks
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file with your credentials:
```
PAGE_ACCESS_TOKEN=your_page_access_token
VERIFY_TOKEN=your_verify_token
PORT=8080
```

4. Start the server:
```bash
npm start
```

## Environment Variables

- `PAGE_ACCESS_TOKEN` - Your Facebook Page Access Token
- `VERIFY_TOKEN` - Your Webhook Verify Token
- `PORT` - Server port (default: 8080)

## Contributing

Feel free to submit issues and pull requests.

## License

MIT License 