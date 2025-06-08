# GrowAGarden Stock Alert Bot

A Facebook Messenger bot that monitors and alerts users about stock availability in GrowAGarden.

## Features

- Real-time stock monitoring for seeds, gear, eggs, and event shop items
- Automatic alerts when items come in stock
- Easy subscription/unsubscription via Messenger commands
- 5-minute interval stock checks

## Setup

1. Clone the repository:
```bash
git clone <your-repo-url>
cd <repo-name>
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with your credentials:
```env
PAGE_ACCESS_TOKEN=your_facebook_page_access_token_here
VERIFY_TOKEN=your_webhook_verify_token_here
```

4. Start the server:
```bash
node index.js
```

## Available Commands

- `/start` or `/subscribe` - Subscribe to stock alerts
- `/checkstock` - Check current stock manually
- `/unsubscribe` - Unsubscribe from alerts

## Environment Variables

- `PAGE_ACCESS_TOKEN` - Your Facebook Page Access Token
- `VERIFY_TOKEN` - Your Webhook Verify Token

## Security

Never commit your `.env` file or expose your credentials. The `.env` file is automatically ignored by Git.

## License

MIT 