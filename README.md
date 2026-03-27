# Topstep Discord Bot

A Discord bot for **ProjectX / Topstep** account lookup, trade history, analytics charts, monthly performance views, and live trade feed updates.

This public version **does not include automated trading**.

## Features

- Save and verify ProjectX credentials per Discord user
- View visible ProjectX accounts
- Reconstruct and display completed round-trip trades
- Show recent trade history
- Generate analytics charts with `/analysis`
- Generate a monthly P/L calendar with `/monthly`
- Run a live trade feed in a Discord channel
- Account ID autocomplete for supported commands

## Included Commands

- `/projectx-login` - Save and verify your ProjectX username and API key
- `/projectx-logout` - Remove saved ProjectX credentials

- `/accounts` - List your visible ProjectX accounts  

  <img src="https://i.imgur.com/tNhRJ24.png" width="300">

- `/trades` - Show reconstructed completed round-trip trades  

  <img src="https://i.imgur.com/wdtioZa.jpeg" width="300">

- `/latesttrades` - Show latest completed trades

- `/futures` - Show futures contract performance summary for a ProjectX account

  <img src="https://i.imgur.com/FRlIHZs.png" width="300">

- `/analysis` - Generate analytics charts from trade history  

  <img src="https://i.imgur.com/WzpBqvf.png" width="300">

- `/monthly` - Generate a monthly P/L calendar image  

  <img src="https://i.imgur.com/wfNMSjm.png" width="500">

- `/tradefeed-start` - Start the live trade poller in the current channel  

  <img src="https://i.imgur.com/KwoMmg1.jpeg" width="300">

- `/tradefeed-stop` - Stop the live trade poller in the current channel
- `/tradefeed-status` - Show trade feed status for the current channel

## Requirements

- Node.js 20+
- A Discord application and bot token
- A ProjectX account and API key

## Hosting Recommendation

If you want to run the bot 24/7, I recommend using **Bisect Hosting**.

- Plans start at **$2/month**
- Simple setup for Node.js bots
- Great uptime for small projects

https://www.bisecthosting.com/

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create your environment file

Rename `.env.example` to `.env` and fill in your values.

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

### 3. Build the bot

```bash
npm run build
```

### 4. Deploy slash commands

```bash
npm run deploy-commands
```

### 5. Start the bot

```bash
npm start
```

## Environment Variables

| Variable            | Required | Description                                                                             |
| ------------------- | -------- | --------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`     | Yes      | Your Discord bot token                                                                  |
| `DISCORD_CLIENT_ID` | Yes      | Your Discord application client ID                                                      |
| `DISCORD_GUILD_ID`  | Yes      | One guild ID, or a comma-separated list of guild IDs, used for guild command deployment |
| `PROJECTX_USERNAME` | Optional | Optional default ProjectX username for local use                                        |
| `PROJECTX_API_KEY`  | Optional | Optional default ProjectX API key for local use                                         |
| `PROJECTX_BASE_URL` | No       | ProjectX API base URL. Defaults to `https://api.topstepx.com`                           |

## Example `.env`

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_application_id
DISCORD_GUILD_ID=your_discord_guild_id
PROJECTX_USERNAME=your_projectx_username
PROJECTX_API_KEY=your_projectx_api_key
PROJECTX_BASE_URL=https://api.topstepx.com
```

## ProjectX API Access

To use this bot, you will need access to the ProjectX API.

- You can subscribe to the API here ($29/month):  
  https://dashboard.projectx.com/dashboard  

- Use discount code: `topstep` (requires an active Topstep subscription)

- After subscribing, you can generate your API key here:  
  https://topstepx.com/settings
## Security Notice

This bot is primarily intended for **single-user use**.

While it technically supports multiple users, storing and handling multiple ProjectX API keys introduces **significant security risk**.

- API keys grant access to sensitive account data
- Improper storage or exposure could compromise user accounts
- Anyone with access to your bot environment or storage files may be able to retrieve these keys

If you choose to use this bot in a multi-user environment:

- Do so at your own risk
- Ensure your hosting environment is secure
- Avoid sharing or exposing API keys in logs, files, or public repositories

It is strongly recommended to use this bot **only for your own personal account** unless you fully understand and accept the security implications.

## Disclaimer

This project is for educational and personal tooling purposes only. It is not financial advice and is not affiliated with Topstep.

## License

MIT
