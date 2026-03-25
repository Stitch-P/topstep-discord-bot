import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_GUILD_IDS = process.env.DISCORD_GUILD_ID;

if (!DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN');
if (!DISCORD_CLIENT_ID) throw new Error('Missing DISCORD_CLIENT_ID');
if (!DISCORD_GUILD_IDS) throw new Error('Missing DISCORD_GUILD_ID');

const guildIds = DISCORD_GUILD_IDS.split(',')
    .map(id => id.trim())
    .filter(Boolean);

const commands = [
    new SlashCommandBuilder()
        .setName('projectx-login')
        .setDescription('Save and verify your ProjectX credentials for this Discord account.')
        .addStringOption(option =>
            option.setName('username').setDescription('Your ProjectX username').setRequired(true)
        )
        .addStringOption(option =>
            option.setName('api_key').setDescription('Your ProjectX API key').setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('projectx-logout')
        .setDescription('Remove your saved ProjectX credentials from this bot.'),

    new SlashCommandBuilder()
        .setName('accounts')
        .setDescription('List your visible ProjectX accounts.'),

    new SlashCommandBuilder()
        .setName('trades')
        .setDescription('Show reconstructed completed round-trip trades from ProjectX.')
        .addIntegerOption(option =>
            option
                .setName('account_id')
                .setDescription('ProjectX account ID (optional)')
                .setAutocomplete(true)
        )
        .addIntegerOption(option =>
            option
                .setName('days')
                .setDescription('How many days back to search (default 1)')
                .setMinValue(1)
                .setMaxValue(30)
        )
        .addIntegerOption(option =>
            option
                .setName('limit')
                .setDescription('Trades per page (default 5)')
                .setMinValue(1)
                .setMaxValue(10)
        ),

    new SlashCommandBuilder()

        .setName('latesttrades')
        .setDescription('Show latest completed trades.')
        .addIntegerOption(option =>
            option.setName('account_id').setDescription('ProjectX account ID').setAutocomplete(true)
        )
        .addIntegerOption(option =>
            option
                .setName('days')
                .setDescription('Days back to search')
                .setMinValue(1)
                .setMaxValue(30)
        )
        .addIntegerOption(option =>
            option
                .setName('limit')
                .setDescription('Number of trades to show')
                .setMinValue(1)
                .setMaxValue(15)
        ),

    new SlashCommandBuilder()
        .setName('futures')
        .setDescription('Show futures contract performance summary for a ProjectX account.')
        .addIntegerOption(option =>
            option.setName('account_id').setDescription('ProjectX account ID').setAutocomplete(true)
        )
        .addIntegerOption(option =>
            option
                .setName('days')
                .setDescription('How many days back to summarize (default 7)')
                .setMinValue(1)
                .setMaxValue(30)
        )
        .addIntegerOption(option =>
            option
                .setName('limit')
                .setDescription('How many futures contracts to show (default 10)')
                .setMinValue(1)
                .setMaxValue(25)
        ),
    new SlashCommandBuilder()
        .setName('analysis')
        .setDescription('Draw a Trade Duration Analysis and Win Rate Analysis image.')
        .addStringOption(option =>
            option
                .setName('start_date')
                .setDescription('Range start in MM-DD-YY format')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('end_date')
                .setDescription('Range end in MM-DD-YY format')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('account_id').setDescription('ProjectX account ID').setAutocomplete(true)
        ),
    new SlashCommandBuilder()
        .setName('monthly')
        .setDescription('Draw a monthly P/L calendar image.')
        .addIntegerOption(option =>
            option.setName('account_id').setDescription('ProjectX account ID').setAutocomplete(true)
        )
        .addIntegerOption(option =>
            option
                .setName('month')
                .setDescription('Month number (1-12). Defaults to current month.')
                .setMinValue(1)
                .setMaxValue(12)
        )
        .addIntegerOption(option =>
            option
                .setName('year')
                .setDescription('Year. Defaults to current year.')
                .setMinValue(2020)
                .setMaxValue(2100)
        ),

    new SlashCommandBuilder()
        .setName('tradefeed-start')
        .setDescription('Start the live trade poller in this channel.')
        .addIntegerOption(option =>
            option.setName('account_id').setDescription('ProjectX account ID').setAutocomplete(true)
        )
        .addIntegerOption(option =>
            option
                .setName('days')
                .setDescription('Days back to scan')
                .setMinValue(1)
                .setMaxValue(30)
        )
        .addIntegerOption(option =>
            option
                .setName('limit')
                .setDescription('Recent trades limit')
                .setMinValue(1)
                .setMaxValue(15)
        )
        .addIntegerOption(option =>
            option
                .setName('interval_seconds')
                .setDescription('Polling interval')
                .setMinValue(10)
                .setMaxValue(300)
        ),

    new SlashCommandBuilder()
        .setName('tradefeed-stop')
        .setDescription('Stop the trade feed in this channel.'),

    new SlashCommandBuilder()
        .setName('tradefeed-status')
        .setDescription('Show trade feed status for this channel.'),

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all available bot commands and what they do.'),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

async function main() {
    console.log('Deploying commands...');
    console.log('Application ID:', DISCORD_CLIENT_ID);

    for (const guildId of guildIds) {
        console.log(`Deploying to guild ${guildId}...`);

        await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID!, guildId), {
            body: commands,
        });

        console.log(`✓ Deployed commands to guild ${guildId}`);
    }

    console.log('All guilds updated.');
}

main().catch(err => {
    console.error('Command deployment failed.');
    console.error(err);
    process.exit(1);
});
