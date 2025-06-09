# RelStocks - Stock Alert Bot

A Facebook Messenger bot that monitors and alerts users about stock availability.

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with the following variables:
   ```env
   # Facebook Messenger Configuration
   PAGE_ACCESS_TOKEN=your_page_access_token
   VERIFY_TOKEN=your_verify_token

   # Server Configuration
   PORT=8080

   # Supabase Configuration
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_KEY=your_supabase_anon_key
   ```

## Development

1. Run tests:
   ```bash
   npm test
   ```

2. Start the server:
   ```bash
   npm start
   ```

## Railway Deployment

1. Create a Railway account at https://railway.app
2. Install Railway CLI:
   ```bash
   npm i -g @railway/cli
   ```

3. Login to Railway:
   ```bash
   railway login
   ```

4. Initialize your project:
   ```bash
   railway init
   ```

5. Add environment variables in Railway dashboard:
   - `PAGE_ACCESS_TOKEN`
   - `VERIFY_TOKEN`
   - `SUPABASE_URL`
   - `SUPABASE_KEY`

6. Deploy:
   ```bash
   railway up
   ```

## Database Setup

1. Create a Supabase account at https://supabase.com
2. Create a new project
3. Go to SQL Editor
4. Run the SQL from `migrations/create_subscribers_table.sql`

## Available Commands

- `/help` - Show available commands
- `/stock` - View all current stock items
- `/checkstock` - Check for specific alert items
- `/subscribe` - Get notified when items are in stock
- `/unsubscribe` - Stop receiving notifications

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

## Environment Variables

- `PAGE_ACCESS_TOKEN`