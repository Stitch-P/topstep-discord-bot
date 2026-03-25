import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from 'canvas';
import type { CanvasGradient, CanvasRenderingContext2D } from 'canvas';

// ──────────────────────────────────────────────────
// RUNTIME IMPORTS
// ──────────────────────────────────────────────────
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Client,
    ContainerBuilder,
    EmbedBuilder,
    Events,
    FileBuilder,
    GatewayIntentBits,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    TextDisplayBuilder,
} from 'discord.js';

// ──────────────────────────────────────────────────
// TYPE-ONLY IMPORTS
// ──────────────────────────────────────────────────
import type {
    AutocompleteInteraction,
    ChatInputCommandInteraction,
    GuildBasedChannel,
    Interaction,
    InteractionEditReplyOptions,
    Message,
} from 'discord.js';

// --------------------------------------------------
// ENV
// --------------------------------------------------
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const PROJECTX_BASE_URL =
    process.env.PROJECTX_BASE_URL?.replace(/\/+$/, '') ?? 'https://api.topstepx.com';
const PROJECTX_FETCH_TIMEOUT_MS = Math.max(
    5_000,
    Number(process.env.PROJECTX_FETCH_TIMEOUT_MS ?? 15_000) || 15_000
);

if (!DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN');
if (!DISCORD_CLIENT_ID) throw new Error('Missing DISCORD_CLIENT_ID');

// --------------------------------------------------
// TYPES
// --------------------------------------------------
type ProjectXApiResponseBase = {
    success?: boolean;
    errorCode?: number;
    errorMessage?: string | null;
};

type ProjectXLoginResponse = ProjectXApiResponseBase & {
    token?: string;
};
type ProjectXUserCredentials = {
    username: string;
    apiKey: string;
};

type ProjectXCredentialStore = Record<string, ProjectXUserCredentials>;

type SavedProjectXAccount = {
    id: number;
    name: string;
    canTrade: boolean;
    balance: number | null;
    fetchedAtIso: string;
};

type ProjectXAccountStore = Record<string, SavedProjectXAccount[]>;

type ProjectXAccount = {
    id: number;
    name: string;
    balance?: number;
    canTrade?: boolean;
    isVisible?: boolean;
};

type ProjectXAccountSearchResponse = ProjectXApiResponseBase & {
    accounts?: ProjectXAccount[];
};

type ProjectXTrade = {
    id: number;
    accountId: number;
    contractId: string;
    creationTimestamp: string;
    price: number;
    profitAndLoss: number | null;
    fees: number;
    side: number; // 0 = buy/bid, 1 = sell/ask
    size: number;
    voided: boolean;
    orderId: number;
};

type ProjectXTradeSearchResponse = ProjectXApiResponseBase & {
    trades?: ProjectXTrade[];
};

type ProjectXContract = {
    id: string;
    name: string;
    description?: string;
    tickSize?: number;
    tickValue?: number;
    activeContract?: boolean;
    symbolId?: string;
};

type ProjectXContractByIdResponse = ProjectXApiResponseBase & {
    contract?: ProjectXContract;
};

type ProjectXHistoryBar = {
    t: string;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
};

type ProjectXRetrieveBarsResponse = ProjectXApiResponseBase & {
    bars?: ProjectXHistoryBar[];
};

type OpenLot = {
    tradeId: number;
    contractId: string;
    entryTime: string;
    entryPrice: number;
    entrySide: number;
    remainingSize: number;
    allocatedOpenFees: number;
};

type RoundTripTrade = {
    contractId: string;
    symbol: string;
    size: number;
    direction: 'Long' | 'Short';
    entryTime: string;
    exitTime: string;
    durationMs: number;
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    fees: number;
    closeTradeId: number;
    closeOrderId: number;
};

type TradesViewState = {
    accountId: number;
    days: number;
    limit: number;
    page: number;
};

type TradeFeedConfig = {
    channelId: string;
    ownerDiscordUserId: string;
    accountId: number;
    days: number;
    limit: number;
    intervalMs: number;
    startedByUserId: string;
    startedAtIso: string;
    lastSuccessIso: string | null;
    lastError: string | null;
    lastSeenCloseTradeId: number | null;
    lastSeenExitTimeIso: string | null;
};

type TradeFeedStore = Record<string, TradeFeedConfig>;

type TradeFeedRuntime = {
    config: TradeFeedConfig;
    timer: NodeJS.Timeout;
    isRunning: boolean;
};

type SendableGuildChannel = GuildBasedChannel & {
    send: (options: unknown) => Promise<Message>;
};

type HistoryRequestConfig = {
    startTimeIso: string;
    endTimeIso: string;
    unit: 1 | 2 | 3 | 4 | 5 | 6;
    unitNumber: number;
    limit: number;
};

type ChartBundle = {
    attachment: AttachmentBuilder;
    filename: string;
};

type DateRangeInput = {
    startIso: string;
    endIso: string;
    fetchStartIso: string;
    fetchEndIso: string;
    startTradingDayKey: string;
    endTradingDayKey: string;
    startLabel: string;
    endLabel: string;
};

type DurationBucket = {
    label: string;
    minMs: number;
    maxMs: number | null;
};

type DurationBucketStat = {
    label: string;
    count: number;
    wins: number;
    winRate: number;
};

type DayAggregate = {
    pnl: number;
    grossPnl: number;
    trades: number;
};

type FuturesContractStat = {
    contractId: string;
    symbol: string;
    trades: number;
    wins: number;
    losses: number;
    flats: number;
    winRate: number;
    grossPnl: number;
    fees: number;
    netPnl: number;
    totalSize: number;
    avgDurationMs: number;
    avgWin: number;
    avgLoss: number;
    bestTrade: number;
    worstTrade: number;
};

type FuturesSummary = {
    totalTrades: number;
    wins: number;
    losses: number;
    flats: number;
    winRate: number;
    grossPnl: number;
    fees: number;
    netPnl: number;
    totalSize: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number | null;
    bestTrade: RoundTripTrade | null;
    worstTrade: RoundTripTrade | null;
    contracts: FuturesContractStat[];
};

// --------------------------------------------------
// CLIENT
// --------------------------------------------------
const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

// --------------------------------------------------
// FILES / CACHES
// --------------------------------------------------
const PROJECTX_USERS_FILE = path.join(process.cwd(), 'projectx-users.json');
const PROJECTX_TRADE_FEEDS_FILE = path.join(process.cwd(), 'projectx-trade-feeds.json');
const PROJECTX_ACCOUNTS_FILE = path.join(process.cwd(), 'projectx-accounts.json');

const cachedTokens = new Map<string, { value: string; expiresAt: number }>();
const contractNameCache = new Map<string, string>();
const tradeFeeds = new Map<string, TradeFeedRuntime>();

// --------------------------------------------------
// CREDENTIAL STORE// --------------------------------------------------
// CREDENTIAL STORE
// --------------------------------------------------
function ensureCredentialStoreFile(): void {
    if (!fs.existsSync(PROJECTX_USERS_FILE)) {
        fs.writeFileSync(PROJECTX_USERS_FILE, '{}', 'utf8');
    }
}
function buildChartGallery(bundles: ChartBundle[]): MediaGalleryBuilder | null {
    if (!bundles.length) return null;

    const gallery = new MediaGalleryBuilder();

    for (const bundle of bundles.slice(0, 10)) {
        gallery.addItems(
            new MediaGalleryItemBuilder()
                .setURL(`attachment://${bundle.filename}`)
                .setDescription(`Trade chart ${bundle.filename}`)
        );
    }

    return gallery;
}
function readCredentialStore(): ProjectXCredentialStore {
    try {
        ensureCredentialStoreFile();
        const raw = fs.readFileSync(PROJECTX_USERS_FILE, 'utf8');
        const parsed = JSON.parse(raw) as ProjectXCredentialStore;
        return parsed ?? {};
    } catch (error) {
        console.error('Failed to read projectx-users.json:', error);
        return {};
    }
}

function writeCredentialStore(store: ProjectXCredentialStore): void {
    ensureCredentialStoreFile();
    fs.writeFileSync(PROJECTX_USERS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function getCredentialsForDiscordUser(discordUserId: string): ProjectXUserCredentials | null {
    const store = readCredentialStore();
    return store[discordUserId] ?? null;
}

function setCredentialsForDiscordUser(
    discordUserId: string,
    credentials: ProjectXUserCredentials
): void {
    const store = readCredentialStore();
    store[discordUserId] = credentials;
    writeCredentialStore(store);
}

function removeCredentialsForDiscordUser(discordUserId: string): boolean {
    const store = readCredentialStore();
    if (!store[discordUserId]) return false;
    delete store[discordUserId];
    writeCredentialStore(store);
    return true;
}

// --------------------------------------------------
// ACCOUNT STORE
// --------------------------------------------------
function ensureAccountStoreFile(): void {
    if (!fs.existsSync(PROJECTX_ACCOUNTS_FILE)) {
        fs.writeFileSync(PROJECTX_ACCOUNTS_FILE, '{}', 'utf8');
    }
}

function readAccountStore(): ProjectXAccountStore {
    try {
        ensureAccountStoreFile();
        const raw = fs.readFileSync(PROJECTX_ACCOUNTS_FILE, 'utf8');
        const parsed = JSON.parse(raw) as ProjectXAccountStore;
        return parsed ?? {};
    } catch (error) {
        console.error('Failed to read projectx-accounts.json:', error);
        return {};
    }
}

function writeAccountStore(store: ProjectXAccountStore): void {
    ensureAccountStoreFile();
    fs.writeFileSync(PROJECTX_ACCOUNTS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function saveAccountsForDiscordUser(discordUserId: string, accounts: ProjectXAccount[]): void {
    const store = readAccountStore();

    store[discordUserId] = accounts.map(account => ({
        id: account.id,
        name: account.name,
        canTrade: account.canTrade !== false,
        balance: typeof account.balance === 'number' ? account.balance : null,
        fetchedAtIso: new Date().toISOString(),
    }));

    writeAccountStore(store);
}

function getSavedAccountsForDiscordUser(discordUserId: string): SavedProjectXAccount[] {
    const store = readAccountStore();
    return store[discordUserId] ?? [];
}

// --------------------------------------------------
// TRADE FEED STORE
// --------------------------------------------------
function ensureTradeFeedStoreFile(): void {
    if (!fs.existsSync(PROJECTX_TRADE_FEEDS_FILE)) {
        fs.writeFileSync(PROJECTX_TRADE_FEEDS_FILE, '{}', 'utf8');
    }
}

function readTradeFeedStore(): TradeFeedStore {
    try {
        ensureTradeFeedStoreFile();
        const raw = fs.readFileSync(PROJECTX_TRADE_FEEDS_FILE, 'utf8');
        const parsed = JSON.parse(raw) as TradeFeedStore;
        return parsed ?? {};
    } catch (error) {
        console.error('Failed to read projectx-trade-feeds.json:', error);
        return {};
    }
}

function writeTradeFeedStore(store: TradeFeedStore): void {
    ensureTradeFeedStoreFile();
    fs.writeFileSync(PROJECTX_TRADE_FEEDS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function saveTradeFeedConfig(config: TradeFeedConfig): void {
    const store = readTradeFeedStore();
    store[config.channelId] = config;
    writeTradeFeedStore(store);
}

function removeTradeFeedConfig(channelId: string): void {
    const store = readTradeFeedStore();
    if (store[channelId]) {
        delete store[channelId];
        writeTradeFeedStore(store);
    }
}

// --------------------------------------------------
// HELPERS
// --------------------------------------------------
function formatMoney(value: number): string {
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatMoneyNegative(value: number): string {
    return `-$${Math.abs(value).toFixed(2)}`;
}

function formatPrice(value: number): string {
    if (!Number.isFinite(value)) return '-';
    return value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 5,
    });
}

function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return '00:00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map(v => String(v).padStart(2, '0')).join(':');
}

function directionFromEntrySide(side: number): 'Long' | 'Short' {
    return side === 0 ? 'Long' : 'Short';
}

function clamp(num: number, min: number, max: number): number {
    return Math.min(Math.max(num, min), max);
}

function pnlEmoji(value: number): string {
    if (value > 0) return '🟢';
    if (value < 0) return '🔴';
    return '⚪';
}

function pnlAccentColor(value: number): number {
    if (value > 0) return 0x22c55e;
    if (value < 0) return 0xef4444;
    return 0x94a3b8;
}

function sanitizeFilenamePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60);
}

function parseIsoMs(input: string): number {
    return new Date(input).getTime();
}

function getNearestBarIndexByTime(bars: ProjectXHistoryBar[], timeMs: number): number {
    let bestIdx = 0;
    let bestDelta = Number.POSITIVE_INFINITY;

    for (let i = 0; i < bars.length; i++) {
        const barMs = parseIsoMs(bars[i].t);
        const delta = Math.abs(barMs - timeMs);
        if (delta < bestDelta) {
            bestDelta = delta;
            bestIdx = i;
        }
    }

    return bestIdx;
}

function sortBarsAscending(bars: ProjectXHistoryBar[]): ProjectXHistoryBar[] {
    return [...bars].sort((a, b) => parseIsoMs(a.t) - parseIsoMs(b.t));
}

function humanBarLabel(unit: number, unitNumber: number): string {
    const base =
        unit === 1
            ? 'sec'
            : unit === 2
              ? 'min'
              : unit === 3
                ? 'hr'
                : unit === 4
                  ? 'day'
                  : unit === 5
                    ? 'wk'
                    : 'mo';

    return `${unitNumber}${base}`;
}

function makeHistoryRequestConfig(trade: RoundTripTrade): HistoryRequestConfig {
    const durationMs = Math.max(trade.durationMs, 30_000);

    const beforeMs = clamp(Math.floor(durationMs * 2), 2 * 60_000, 45 * 60_000);
    const afterMs = clamp(Math.floor(durationMs * 1.5), 2 * 60_000, 45 * 60_000);

    const entryMs = parseIsoMs(trade.entryTime);
    const exitMs = parseIsoMs(trade.exitTime);

    const startMs = entryMs - beforeMs;
    const endMs = exitMs + afterMs;
    const rangeMs = Math.max(endMs - startMs, 60_000);

    let unit: 1 | 2 | 3 | 4 | 5 | 6 = 2;
    let unitNumber = 1;

    if (rangeMs <= 10 * 60_000) {
        unit = 1;
        unitNumber = 5;
    } else if (rangeMs <= 30 * 60_000) {
        unit = 1;
        unitNumber = 15;
    } else if (rangeMs <= 4 * 60 * 60_000) {
        unit = 2;
        unitNumber = 1;
    } else if (rangeMs <= 12 * 60 * 60_000) {
        unit = 2;
        unitNumber = 5;
    } else if (rangeMs <= 3 * 24 * 60 * 60_000) {
        unit = 2;
        unitNumber = 15;
    } else {
        unit = 3;
        unitNumber = 1;
    }

    const unitMs =
        unit === 1
            ? unitNumber * 1000
            : unit === 2
              ? unitNumber * 60_000
              : unit === 3
                ? unitNumber * 60 * 60_000
                : unit === 4
                  ? unitNumber * 24 * 60 * 60_000
                  : unit === 5
                    ? unitNumber * 7 * 24 * 60 * 60_000
                    : unitNumber * 30 * 24 * 60 * 60_000;

    const limit = clamp(Math.ceil(rangeMs / unitMs) + 8, 16, 250);

    return {
        startTimeIso: new Date(startMs).toISOString(),
        endTimeIso: new Date(endMs).toISOString(),
        unit,
        unitNumber,
        limit,
    };
}

const POSITIVE_TRADE_MESSAGES = [
    'Tiny chaos creature approves. Profit acquired. Snacks deserved.',
    'That trade actually worked. Suspicious, but beautiful.',
    'Green numbers make the universe slightly less embarrassing.',
    'You pressed buttons and somehow created money. Incredible.',
    'Even the gremlin is impressed. Clean little win.',
    'Profit detected. Screaming happily in a very controlled way.',
    'Nice. That trade had bite.',
    'Market tried something. You tried harder.',
    'That was sharp. Little chaos goblin salute.',
    'Win logged. Ego may now rise by 3%.',
    'That entry had manners and the exit had teeth.',
    'Good trade. Very snack-worthy behavior.',
    'You didn’t donate to the market this time. Proud of you.',
    'That one sparkled. Nicely done.',
    'A clean win. Disgustingly responsible.',
    'You hunted. You pounced. You got paid.',
    'That trade had main-character energy.',
    'Profit makes the goblin dance. Briefly. Menacingly.',
    'You snatched points like a feral genius.',
    'This was not luck. Probably. Let’s pretend it was skill.',
    'The chart blinked first. You won.',
    'That was a tasty little grab.',
    'Green candle blessing accepted.',
    'You survived the nonsense and left with cash. Elite behavior.',
    'The market coughed up money and you caught it.',
    'That trade was cleaner than it had any right to be.',
    'Very nice. Tiny monster gives approving head tilt.',
    'You bonked the market and loot fell out.',
    'That one goes in the shiny pile.',
    'Beautiful. More of that. Less chaos. Maybe.',
];

const NEGATIVE_TRADE_MESSAGES = [
    'Market said no. Rudely.',
    'That trade got stepped on. Happens.',
    'Tiny goblin hiss of disappointment.',
    'Well. That was a donation.',
    'The chart lured you into the woods and stole your lunch money.',
    'That entry looked brave right up until it wasn’t.',
    'The market bonked you with a newspaper.',
    'Not ideal. Very educational. Annoyingly so.',
    'That trade went splat.',
    'Even the gremlin needs a reset after that one.',
    'You fought the candle and the candle won.',
    'That setup belonged in the trash heap.',
    'The market reached into your pocket and took a souvenir.',
    'Small disaster. No funeral needed.',
    'That was not a loss. That was tuition.',
    'The chart laughed first. Rude behavior.',
    'That trade had the lifespan of a soap bubble.',
    'Tiny chaos creature recommends touching less nonsense.',
    'You got yoinked. Regroup.',
    'That one smelled bad from the middle onward.',
    'The market baited you and you bit. Villainous work.',
    'That was a spicy little fail.',
    'No treasure here. Only pain and commission fees.',
    'That candle was a liar and a criminal.',
    'Ouch. The gremlin throws that setup in the ocean.',
    'That trade needs to go sit in the shame corner.',
    'You poked the market and it bit back.',
    'Messy. Recoverable. Still annoying.',
    'That one belongs in the “never again” scrapbook.',
    'Bad trade. Stand up, shake it off, stop feeding nonsense.',
];

function pickTradeMessage(trade: RoundTripTrade): string {
    const pool =
        trade.pnl > 0
            ? POSITIVE_TRADE_MESSAGES
            : trade.pnl < 0
              ? NEGATIVE_TRADE_MESSAGES
              : ['Flat trade. Even Stitch is confused by that one.'];

    return pool[Math.floor(Math.random() * pool.length)];
}

function buildStateCustomId(prefix: string, state: TradesViewState): string {
    return `${prefix}|${state.accountId}|${state.days}|${state.limit}|${state.page}`;
}

function parseStateCustomId(customId: string): TradesViewState | null {
    const parts = customId.split('|');
    if (parts.length !== 5) return null;

    const [, accountIdRaw, daysRaw, limitRaw, pageRaw] = parts;
    const accountId = Number(accountIdRaw);
    const days = Number(daysRaw);
    const limit = Number(limitRaw);
    const page = Number(pageRaw);

    if (
        !Number.isInteger(accountId) ||
        !Number.isInteger(days) ||
        !Number.isInteger(limit) ||
        !Number.isInteger(page)
    ) {
        return null;
    }

    return { accountId, days, limit, page };
}

function assertSuccess(data: ProjectXApiResponseBase, fallbackMessage: string): void {
    if (data.success === false) {
        throw new Error(
            `${fallbackMessage} (errorCode=${data.errorCode ?? 'unknown'}, errorMessage=${data.errorMessage ?? 'null'})`
        );
    }
}

function isSendableGuildChannel(channel: unknown): channel is SendableGuildChannel {
    if (!channel || typeof channel !== 'object') return false;

    const c = channel as Partial<SendableGuildChannel> & { type?: ChannelType };

    return (
        typeof c.send === 'function' &&
        (c.type === ChannelType.GuildText ||
            c.type === ChannelType.GuildAnnouncement ||
            c.type === ChannelType.PublicThread ||
            c.type === ChannelType.PrivateThread ||
            c.type === ChannelType.AnnouncementThread)
    );
}

function toUnixSeconds(input: string | Date): number {
    const ms = input instanceof Date ? input.getTime() : new Date(input).getTime();
    return Math.floor(ms / 1000);
}

function discordTimestamp(
    input: string | Date,
    style: 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R' = 'f'
): string {
    return `<t:${toUnixSeconds(input)}:${style}>`;
}

function isRoundTripAfterCheckpoint(
    trade: RoundTripTrade,
    lastSeenCloseTradeId: number | null,
    lastSeenExitTimeIso: string | null
): boolean {
    if (!lastSeenExitTimeIso) return false;

    const tradeTime = new Date(trade.exitTime).getTime();
    const seenTime = new Date(lastSeenExitTimeIso).getTime();

    if (tradeTime > seenTime) return true;
    if (tradeTime < seenTime) return false;

    if (lastSeenCloseTradeId == null) return true;
    return trade.closeTradeId > lastSeenCloseTradeId;
}

// --------------------------------------------------
// PROJECTX HTTP
// --------------------------------------------------
async function projectXFetch<T>(
    pathName: string,
    body: Record<string, unknown>,
    useAuth = true,
    discordUserId?: string,
    credentials?: ProjectXUserCredentials
): Promise<T> {
    const headers: Record<string, string> = {
        accept: 'text/plain',
        'Content-Type': 'application/json',
    };

    if (useAuth) {
        if (!discordUserId || !credentials) {
            throw new Error(
                'Missing Discord user ID or ProjectX credentials for authenticated request.'
            );
        }

        const token = await getProjectXToken(discordUserId, credentials);
        headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROJECTX_FETCH_TIMEOUT_MS);

    try {
        const res = await fetch(`${PROJECTX_BASE_URL}${pathName}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`ProjectX HTTP ${res.status}: ${text || res.statusText}`);
        }

        return (await res.json()) as T;
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(
                `ProjectX request timed out after ${PROJECTX_FETCH_TIMEOUT_MS}ms for ${pathName}`
            );
        }

        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function getProjectXToken(
    discordUserId: string,
    credentials: ProjectXUserCredentials,
    forceRefresh = false
): Promise<string> {
    const now = Date.now();
    const cached = cachedTokens.get(discordUserId);

    if (!forceRefresh && cached && cached.expiresAt > now) {
        return cached.value;
    }

    const data = await projectXFetch<ProjectXLoginResponse>(
        '/api/Auth/loginKey',
        {
            userName: credentials.username,
            apiKey: credentials.apiKey,
        },
        false,
        discordUserId,
        credentials
    );

    assertSuccess(data, 'Failed to authenticate with ProjectX');

    if (!data.token) {
        throw new Error('ProjectX login succeeded but no token was returned.');
    }

    cachedTokens.set(discordUserId, {
        value: data.token,
        expiresAt: Date.now() + 50 * 60 * 1000,
    });

    return data.token;
}

async function searchAccounts(
    discordUserId: string,
    credentials: ProjectXUserCredentials
): Promise<ProjectXAccount[]> {
    const data = await projectXFetch<ProjectXAccountSearchResponse>(
        '/api/Account/search',
        { onlyActiveAccounts: true },
        true,
        discordUserId,
        credentials
    );

    assertSuccess(data, 'Failed to fetch accounts');
    return (data.accounts ?? []).filter(a => a.isVisible !== false);
}

async function getDefaultAccountId(
    discordUserId: string,
    credentials: ProjectXUserCredentials
): Promise<number> {
    const accounts = await searchAccounts(discordUserId, credentials);
    const account = accounts.find(a => a.canTrade !== false) ?? accounts[0];

    if (!account) {
        throw new Error('No visible ProjectX accounts were returned.');
    }

    return account.id;
}

async function searchTradesByRange(
    discordUserId: string,
    credentials: ProjectXUserCredentials,
    accountId: number,
    startTimestamp: string,
    endTimestamp: string
): Promise<ProjectXTrade[]> {
    const data = await projectXFetch<ProjectXTradeSearchResponse>(
        '/api/Trade/search',
        {
            accountId,
            startTimestamp,
            endTimestamp,
        },
        true,
        discordUserId,
        credentials
    );

    assertSuccess(data, 'Failed to fetch trades');

    return (data.trades ?? [])
        .filter(t => !t.voided)
        .sort(
            (a, b) =>
                new Date(a.creationTimestamp).getTime() - new Date(b.creationTimestamp).getTime()
        );
}

async function searchTrades(
    discordUserId: string,
    credentials: ProjectXUserCredentials,
    accountId: number,
    days: number
): Promise<ProjectXTrade[]> {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    return searchTradesByRange(
        discordUserId,
        credentials,
        accountId,
        start.toISOString(),
        end.toISOString()
    );
}

async function retrieveBarsForTrade(
    discordUserId: string,
    credentials: ProjectXUserCredentials,
    trade: RoundTripTrade
): Promise<{ bars: ProjectXHistoryBar[]; config: HistoryRequestConfig }> {
    const config = makeHistoryRequestConfig(trade);

    const data = await projectXFetch<ProjectXRetrieveBarsResponse>(
        '/api/History/retrieveBars',
        {
            contractId: trade.contractId,
            live: false,
            startTime: config.startTimeIso,
            endTime: config.endTimeIso,
            unit: config.unit,
            unitNumber: config.unitNumber,
            limit: config.limit,
            includePartialBar: false,
        },
        true,
        discordUserId,
        credentials
    );

    assertSuccess(data, `Failed to retrieve bars for contract ${trade.contractId}`);

    return {
        bars: sortBarsAscending(data.bars ?? []),
        config,
    };
}

async function getContractName(
    discordUserId: string,
    credentials: ProjectXUserCredentials,
    contractId: string
): Promise<string> {
    const cached = contractNameCache.get(contractId);
    if (cached) return cached;

    const data = await projectXFetch<ProjectXContractByIdResponse>(
        '/api/Contract/searchById',
        { contractId },
        true,
        discordUserId,
        credentials
    );

    assertSuccess(data, `Failed to fetch contract ${contractId}`);

    const name = data.contract?.name || data.contract?.description || contractId;

    contractNameCache.set(contractId, name);
    return name;
}

async function resolveContractNames(
    discordUserId: string,
    credentials: ProjectXUserCredentials,
    contractIds: string[]
): Promise<Map<string, string>> {
    const unique = [...new Set(contractIds)];
    await Promise.all(
        unique.map(id => getContractName(discordUserId, credentials, id).catch(() => id))
    );

    const map = new Map<string, string>();
    for (const id of unique) {
        map.set(id, contractNameCache.get(id) ?? id);
    }
    return map;
}

// --------------------------------------------------
// TRADE RECONSTRUCTION
// --------------------------------------------------
function reconstructRoundTrips(
    trades: ProjectXTrade[],
    contractNames: Map<string, string>
): {
    roundTrips: RoundTripTrade[];
    openLotsRemaining: number;
} {
    const openLotsByContract = new Map<string, OpenLot[]>();
    const roundTrips: RoundTripTrade[] = [];

    for (const trade of trades) {
        const contractId = trade.contractId;
        const symbol = contractNames.get(contractId) ?? contractId;

        const queue = openLotsByContract.get(contractId) ?? [];
        openLotsByContract.set(contractId, queue);

        if (trade.profitAndLoss == null) {
            queue.push({
                tradeId: trade.id,
                contractId,
                entryTime: trade.creationTimestamp,
                entryPrice: trade.price,
                entrySide: trade.side,
                remainingSize: trade.size,
                allocatedOpenFees: trade.fees,
            });
            continue;
        }

        let sizeLeftToClose = trade.size;
        const matchedLots: Array<{
            lot: OpenLot;
            size: number;
            openFeePortion: number;
        }> = [];

        while (sizeLeftToClose > 0 && queue.length > 0) {
            const lot = queue[0];
            const matchedSize = Math.min(sizeLeftToClose, lot.remainingSize);

            const lotOriginalSize = lot.remainingSize;
            const openFeePortion =
                lotOriginalSize > 0 ? (lot.allocatedOpenFees * matchedSize) / lotOriginalSize : 0;

            matchedLots.push({
                lot: { ...lot },
                size: matchedSize,
                openFeePortion,
            });

            lot.remainingSize -= matchedSize;
            lot.allocatedOpenFees -= openFeePortion;
            sizeLeftToClose -= matchedSize;

            if (lot.remainingSize <= 0.0000001) {
                queue.shift();
            }
        }

        if (matchedLots.length === 0) {
            continue;
        }

        const matchedTotalSize = matchedLots.reduce((sum, x) => sum + x.size, 0);
        const weightedEntryPrice =
            matchedLots.reduce((sum, x) => sum + x.lot.entryPrice * x.size, 0) / matchedTotalSize;

        const earliestEntryTime = matchedLots
            .map(x => new Date(x.lot.entryTime).getTime())
            .reduce((min, t) => Math.min(min, t), Number.POSITIVE_INFINITY);

        const entrySide = matchedLots[0].lot.entrySide;
        const direction = directionFromEntrySide(entrySide);

        const totalOpenFees = matchedLots.reduce((sum, x) => sum + x.openFeePortion, 0);
        const totalFees = totalOpenFees + trade.fees;

        roundTrips.push({
            contractId,
            symbol,
            size: matchedTotalSize,
            direction,
            entryTime: new Date(earliestEntryTime).toISOString(),
            exitTime: trade.creationTimestamp,
            durationMs: new Date(trade.creationTimestamp).getTime() - earliestEntryTime,
            entryPrice: weightedEntryPrice,
            exitPrice: trade.price,
            pnl: trade.profitAndLoss,
            fees: totalFees,
            closeTradeId: trade.id,
            closeOrderId: trade.orderId,
        });
    }

    const openLotsRemaining = [...openLotsByContract.values()].reduce(
        (sum, lots) => sum + lots.reduce((s, lot) => s + lot.remainingSize, 0),
        0
    );

    roundTrips.sort((a, b) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime());

    return { roundTrips, openLotsRemaining };
}

// --------------------------------------------------
// CANVAS CHART RENDERING
// --------------------------------------------------
function renderTradeChartPng(
    trade: RoundTripTrade,
    bars: ProjectXHistoryBar[],
    config: HistoryRequestConfig
): Buffer {
    const outputWidth = 3840;
    const outputHeight = 2160;
    const scale = 3;

    // Draw in a logical coordinate space, then scale up to 4K
    const width = outputWidth / scale; // 1280
    const height = outputHeight / scale; // 720

    const headerLeft = 22;
    const headerTop = 18;
    const headerHeight = 96;

    const padLeft = 68;
    const padRight = 92;
    const padBottom = 56;

    const chartLeft = padLeft;
    const chartTop = headerTop + headerHeight + 10;
    const chartWidth = width - padLeft - padRight;
    const chartHeight = height - chartTop - padBottom;

    const canvas = createCanvas(outputWidth, outputHeight);
    const ctx = canvas.getContext('2d');

    // Scale entire drawing space to 4K
    ctx.scale(scale, scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.fillStyle = '#07111f';
    ctx.fillRect(0, 0, width, height);

    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, '#09172d');
    bgGrad.addColorStop(1, '#040a13');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // subtle divider between header band and chart
    ctx.strokeStyle = 'rgba(79, 118, 177, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, chartTop - 8);
    ctx.lineTo(width, chartTop - 8);
    ctx.stroke();

    // Grid
    ctx.strokeStyle = 'rgba(79, 118, 177, 0.14)';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 8; i++) {
        const y = chartTop + (chartHeight / 8) * i;
        ctx.beginPath();
        ctx.moveTo(chartLeft, y);
        ctx.lineTo(chartLeft + chartWidth, y);
        ctx.stroke();
    }

    for (let i = 0; i <= 12; i++) {
        const x = chartLeft + (chartWidth / 12) * i;
        ctx.beginPath();
        ctx.moveTo(x, chartTop);
        ctx.lineTo(x, chartTop + chartHeight);
        ctx.stroke();
    }

    const lows = bars.map(b => b.l);
    const highs = bars.map(b => b.h);
    lows.push(trade.entryPrice, trade.exitPrice);
    highs.push(trade.entryPrice, trade.exitPrice);

    let minPrice = Math.min(...lows);
    let maxPrice = Math.max(...highs);

    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice === maxPrice) {
        minPrice = Math.min(trade.entryPrice, trade.exitPrice) - 2;
        maxPrice = Math.max(trade.entryPrice, trade.exitPrice) + 2;
    }

    const pricePadding = Math.max((maxPrice - minPrice) * 0.08, 0.25);
    minPrice -= pricePadding;
    maxPrice += pricePadding;

    const priceToY = (price: number) =>
        chartTop + ((maxPrice - price) / (maxPrice - minPrice)) * chartHeight;

    const candleAreaWidth = chartWidth / Math.max(bars.length, 1);
    const candleBodyWidth = Math.max(3, Math.min(18, candleAreaWidth * 0.72));

    // Candles
    for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        const centerX = chartLeft + candleAreaWidth * i + candleAreaWidth / 2;

        const openY = priceToY(bar.o);
        const highY = priceToY(bar.h);
        const lowY = priceToY(bar.l);
        const closeY = priceToY(bar.c);

        const isUp = bar.c >= bar.o;
        const color = isUp ? '#17c3a5' : '#ff3b4f';

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(centerX, highY);
        ctx.lineTo(centerX, lowY);
        ctx.stroke();

        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(2, Math.abs(closeY - openY));

        ctx.fillStyle = color;
        ctx.fillRect(centerX - candleBodyWidth / 2, bodyTop, candleBodyWidth, bodyHeight);
    }

    const entryMs = parseIsoMs(trade.entryTime);
    const exitMs = parseIsoMs(trade.exitTime);
    const entryIdx = getNearestBarIndexByTime(bars, entryMs);
    const exitIdx = getNearestBarIndexByTime(bars, exitMs);

    const entryX = chartLeft + candleAreaWidth * entryIdx + candleAreaWidth / 2;
    const exitX = chartLeft + candleAreaWidth * exitIdx + candleAreaWidth / 2;

    const entryY = priceToY(trade.entryPrice);
    const exitY = priceToY(trade.exitPrice);

    // Horizontal price lines
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(255, 196, 87, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(chartLeft, entryY);
    ctx.lineTo(chartLeft + chartWidth, entryY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(122, 221, 255, 0.9)';
    ctx.beginPath();
    ctx.moveTo(chartLeft, exitY);
    ctx.lineTo(chartLeft + chartWidth, exitY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Highlight exact entry/exit bars
    const highlightHalfWidth = Math.max(10, Math.min(20, candleAreaWidth * 0.85));

    ctx.fillStyle = 'rgba(255, 196, 87, 0.14)';
    ctx.fillRect(entryX - highlightHalfWidth, chartTop, highlightHalfWidth * 2, chartHeight);

    ctx.fillStyle = 'rgba(122, 221, 255, 0.14)';
    ctx.fillRect(exitX - highlightHalfWidth, chartTop, highlightHalfWidth * 2, chartHeight);

    // Vertical guides
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = 'rgba(255, 196, 87, 0.58)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(entryX, chartTop);
    ctx.lineTo(entryX, chartTop + chartHeight);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(122, 221, 255, 0.58)';
    ctx.beginPath();
    ctx.moveTo(exitX, chartTop);
    ctx.lineTo(exitX, chartTop + chartHeight);
    ctx.stroke();
    ctx.setLineDash([]);

    // Smaller entry/exit markers
    const drawDiamondMarker = (x: number, y: number, fill: string) => {
        ctx.save();

        ctx.beginPath();
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x + 8, y);
        ctx.lineTo(x, y + 8);
        ctx.lineTo(x - 8, y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.96)';
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(x, y - 5.5);
        ctx.lineTo(x + 5.5, y);
        ctx.lineTo(x, y + 5.5);
        ctx.lineTo(x - 5.5, y);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();

        ctx.restore();
    };

    const drawCircleMarker = (x: number, y: number, fill: string) => {
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.96)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, 4.75, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
    };

    drawDiamondMarker(entryX, entryY, '#ffc457');
    drawCircleMarker(exitX, exitY, '#7addff');

    // Header band content, fully outside chart
    ctx.fillStyle = '#f3f7ff';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText(`${trade.symbol}  ·  ${trade.direction}  ·  x${trade.size}`, headerLeft, 36);

    ctx.fillStyle = trade.pnl > 0 ? '#7ad46a' : trade.pnl < 0 ? '#ff7082' : '#cbd5e1';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(
        `${formatMoney(trade.pnl)}  |  Fees ${formatMoneyNegative(trade.fees)}  |  Held ${formatDuration(trade.durationMs)}`,
        headerLeft,
        72
    );

    ctx.fillStyle = 'rgba(223, 231, 245, 0.72)';
    ctx.font = '17px sans-serif';
    ctx.fillText(
        `Bars: ${bars.length} · ${humanBarLabel(config.unit, config.unitNumber)} · ${new Date(trade.entryTime).toLocaleString()} → ${new Date(trade.exitTime).toLocaleString()}`,
        headerLeft,
        100
    );

    // Right-side price tags pinned to the top-right inside the chart
    const drawRightPriceTag = (text: string, y: number, fill: string) => {
        ctx.font = 'bold 16px sans-serif';
        const textW = ctx.measureText(text).width;
        const boxW = textW + 16;
        const boxH = 28;
        const x = width - boxW - 16;

        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.roundRect(x, y - boxH / 2, boxW, boxH, 9);
        ctx.fill();

        ctx.fillStyle = '#0a1220';
        ctx.fillText(text, x + 8, y + 6);

        return { x, y, boxW, boxH };
    };

    const topPriceTagY = chartTop + 24;
    const stackedGap = 30;

    const entryTag = drawRightPriceTag(
        `ENTRY ${formatPrice(trade.entryPrice)}`,
        topPriceTagY,
        '#ffc457'
    );

    const exitTag = drawRightPriceTag(
        `EXIT ${formatPrice(trade.exitPrice)}`,
        topPriceTagY + stackedGap,
        '#7addff'
    );

    // Leader lines from markers to top-right price tags
    ctx.lineWidth = 1.2;

    ctx.strokeStyle = 'rgba(255, 196, 87, 0.55)';
    ctx.beginPath();
    ctx.moveTo(entryX + 8, entryY);
    ctx.lineTo(entryTag.x - 18, entryY);
    ctx.lineTo(entryTag.x - 8, entryTag.y);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(122, 221, 255, 0.55)';
    ctx.beginPath();
    ctx.moveTo(exitX + 8, exitY);
    ctx.lineTo(exitTag.x - 18, exitY);
    ctx.lineTo(exitTag.x - 8, exitTag.y);
    ctx.stroke();

    // Point labels attached directly to markers
    const drawPointLabel = (
        label: string,
        pointX: number,
        pointY: number,
        fill: string,
        side: 'left' | 'right',
        vertical: 'up' | 'down'
    ) => {
        ctx.font = 'bold 15px sans-serif';

        const textW = ctx.measureText(label).width;
        const boxW = textW + 18;
        const boxH = 26;
        const gapX = 14;
        const gapY = 12;

        let boxX = side === 'right' ? pointX + gapX : pointX - gapX - boxW;
        let boxY = vertical === 'up' ? pointY - boxH - gapY : pointY + gapY;

        boxX = Math.max(chartLeft + 6, Math.min(chartLeft + chartWidth - boxW - 6, boxX));
        boxY = Math.max(chartTop + 6, Math.min(chartTop + chartHeight - boxH - 6, boxY));

        const anchorX = side === 'right' ? boxX : boxX + boxW;
        const anchorY = Math.max(boxY + 6, Math.min(boxY + boxH - 6, pointY));

        ctx.strokeStyle = fill;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(pointX, pointY);
        ctx.lineTo(anchorX, anchorY);
        ctx.stroke();

        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 8);
        ctx.fill();

        ctx.fillStyle = '#08111d';
        ctx.fillText(label, boxX + 9, boxY + 18);
    };

    const crowded = Math.abs(entryX - exitX) < 96 && Math.abs(entryY - exitY) < 56;

    const resolveSide = (
        preferred: 'left' | 'right',
        pointX: number,
        boxEstimateWidth: number
    ): 'left' | 'right' => {
        if (preferred === 'right' && pointX + 16 + boxEstimateWidth > chartLeft + chartWidth - 6) {
            return 'left';
        }
        if (preferred === 'left' && pointX - 16 - boxEstimateWidth < chartLeft + 6) {
            return 'right';
        }
        return preferred;
    };

    const entryLabelWidthEstimate = 60;
    const exitLabelWidthEstimate = 50;

    const entrySide = resolveSide('left', entryX, entryLabelWidthEstimate);
    const exitSide = crowded
        ? resolveSide('right', exitX, exitLabelWidthEstimate)
        : resolveSide('left', exitX, exitLabelWidthEstimate);

    const entryVertical: 'up' | 'down' = crowded ? 'up' : entryY > chartTop + 44 ? 'up' : 'down';
    const exitVertical: 'up' | 'down' = crowded ? 'down' : exitY > chartTop + 44 ? 'up' : 'down';

    drawPointLabel('ENTRY', entryX, entryY, '#ffc457', entrySide, entryVertical);
    drawPointLabel('EXIT', exitX, exitY, '#7addff', exitSide, exitVertical);

    // Axis labels
    ctx.fillStyle = 'rgba(223, 231, 245, 0.65)';
    ctx.font = '14px sans-serif';

    for (let i = 0; i <= 5; i++) {
        const ratio = i / 5;
        const price = maxPrice - (maxPrice - minPrice) * ratio;
        const y = chartTop + chartHeight * ratio;
        ctx.fillText(formatPrice(price), width - 78, y + 4);
    }

    if (bars.length > 0) {
        const labelCount = Math.min(6, bars.length);
        for (let i = 0; i < labelCount; i++) {
            const idx = Math.floor((bars.length - 1) * (i / Math.max(labelCount - 1, 1)));
            const x = chartLeft + candleAreaWidth * idx + candleAreaWidth / 2;
            const ts = new Date(bars[idx].t);
            const text =
                config.unit === 1 || config.unit === 2
                    ? ts.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                    : ts.toLocaleDateString([], { month: 'short', day: 'numeric' });

            ctx.fillText(text, x - 22, height - 18);
        }
    }

    return canvas.toBuffer('image/png');
}

async function buildTradeChartAttachment(
    discordUserId: string,
    credentials: ProjectXUserCredentials,
    trade: RoundTripTrade,
    indexTag?: string
): Promise<ChartBundle | null> {
    try {
        const { bars, config } = await retrieveBarsForTrade(discordUserId, credentials, trade);

        if (!bars.length) return null;

        const png = renderTradeChartPng(trade, bars, config);
        const filenameBase = `${sanitizeFilenamePart(trade.symbol)}_${trade.closeTradeId}${
            indexTag ? `_${sanitizeFilenamePart(indexTag)}` : ''
        }`;
        const filename = `${filenameBase}.png`;

        return {
            attachment: new AttachmentBuilder(png, { name: filename }),
            filename,
        };
    } catch (error) {
        console.error(`[chart:${trade.closeTradeId}]`, error);
        return null;
    }
}

const DURATION_BUCKETS: DurationBucket[] = [
    { label: 'Under 15 sec', minMs: 0, maxMs: 15_000 },
    { label: '15-45 sec', minMs: 15_000, maxMs: 45_000 },
    { label: '45 sec - 1 min', minMs: 45_000, maxMs: 60_000 },
    { label: '1 min - 2 min', minMs: 60_000, maxMs: 120_000 },
    { label: '2 min - 5 min', minMs: 120_000, maxMs: 300_000 },
    { label: '5 min - 10 min', minMs: 300_000, maxMs: 600_000 },
    { label: '10 min - 30 min', minMs: 600_000, maxMs: 1_800_000 },
    { label: '30 min - 1 hour', minMs: 1_800_000, maxMs: 3_600_000 },
    { label: '1 hour - 2 hours', minMs: 3_600_000, maxMs: 7_200_000 },
    { label: '2 hours - 4 hours', minMs: 7_200_000, maxMs: 14_400_000 },
    { label: '4 hours and up', minMs: 14_400_000, maxMs: null },
];

function formatPct(value: number): string {
    return `${value.toFixed(2)}%`;
}

function formatSignedNumber(value: number, digits = 2): string {
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    return `${sign}${Math.abs(value).toFixed(digits)}`;
}

function getNetTradePnlWithFees(trade: RoundTripTrade): number {
    return trade.pnl - trade.fees;
}

function buildFuturesSummary(roundTrips: RoundTripTrade[]): FuturesSummary {
    const wins = roundTrips.filter(trade => trade.pnl > 0);
    const losses = roundTrips.filter(trade => trade.pnl < 0);
    const flats = roundTrips.filter(trade => trade.pnl === 0);

    const grossPnl = roundTrips.reduce((sum, trade) => sum + trade.pnl, 0);
    const fees = roundTrips.reduce((sum, trade) => sum + trade.fees, 0);
    const netPnl = grossPnl - fees;
    const totalSize = roundTrips.reduce((sum, trade) => sum + trade.size, 0);

    const grossWins = wins.reduce((sum, trade) => sum + trade.pnl, 0);
    const grossLossAbs = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));

    const byContract = new Map<string, RoundTripTrade[]>();

    for (const trade of roundTrips) {
        const key = `${trade.contractId}|||${trade.symbol}`;
        const arr = byContract.get(key) ?? [];
        arr.push(trade);
        byContract.set(key, arr);
    }

    const contracts: FuturesContractStat[] = [...byContract.entries()]
        .map(([key, trades]) => {
            const [contractId, symbol] = key.split('|||');
            const tradeWins = trades.filter(trade => trade.pnl > 0);
            const tradeLosses = trades.filter(trade => trade.pnl < 0);
            const tradeFlats = trades.filter(trade => trade.pnl === 0);

            const contractGrossPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
            const contractFees = trades.reduce((sum, trade) => sum + trade.fees, 0);
            const contractNetPnl = contractGrossPnl - contractFees;
            const contractTotalSize = trades.reduce((sum, trade) => sum + trade.size, 0);
            const contractAvgDurationMs =
                trades.length > 0
                    ? trades.reduce((sum, trade) => sum + trade.durationMs, 0) / trades.length
                    : 0;

            const avgWin =
                tradeWins.length > 0
                    ? tradeWins.reduce((sum, trade) => sum + trade.pnl, 0) / tradeWins.length
                    : 0;

            const avgLoss =
                tradeLosses.length > 0
                    ? tradeLosses.reduce((sum, trade) => sum + trade.pnl, 0) / tradeLosses.length
                    : 0;

            const bestTrade = trades.length > 0 ? Math.max(...trades.map(trade => trade.pnl)) : 0;

            const worstTrade = trades.length > 0 ? Math.min(...trades.map(trade => trade.pnl)) : 0;

            return {
                contractId,
                symbol,
                trades: trades.length,
                wins: tradeWins.length,
                losses: tradeLosses.length,
                flats: tradeFlats.length,
                winRate: trades.length > 0 ? (tradeWins.length / trades.length) * 100 : 0,
                grossPnl: contractGrossPnl,
                fees: contractFees,
                netPnl: contractNetPnl,
                totalSize: contractTotalSize,
                avgDurationMs: contractAvgDurationMs,
                avgWin,
                avgLoss,
                bestTrade,
                worstTrade,
            };
        })
        .sort((a, b) => {
            if (b.netPnl !== a.netPnl) return b.netPnl - a.netPnl;
            if (b.trades !== a.trades) return b.trades - a.trades;
            return a.symbol.localeCompare(b.symbol);
        });

    return {
        totalTrades: roundTrips.length,
        wins: wins.length,
        losses: losses.length,
        flats: flats.length,
        winRate: roundTrips.length > 0 ? (wins.length / roundTrips.length) * 100 : 0,
        grossPnl,
        fees,
        netPnl,
        totalSize,
        avgWin: wins.length > 0 ? grossWins / wins.length : 0,
        avgLoss:
            losses.length > 0
                ? losses.reduce((sum, trade) => sum + trade.pnl, 0) / losses.length
                : 0,
        profitFactor:
            grossLossAbs > 0
                ? grossWins / grossLossAbs
                : grossWins > 0
                  ? Number.POSITIVE_INFINITY
                  : null,
        bestTrade: roundTrips.length > 0 ? [...roundTrips].sort((a, b) => b.pnl - a.pnl)[0] : null,
        worstTrade: roundTrips.length > 0 ? [...roundTrips].sort((a, b) => a.pnl - b.pnl)[0] : null,
        contracts,
    };
}

function buildFuturesContainer(
    accountId: number,
    days: number,
    limit: number,
    roundTrips: RoundTripTrade[]
): ContainerBuilder {
    const summary = buildFuturesSummary(roundTrips);
    const topContracts = summary.contracts.slice(0, limit);

    const bestTradeLine = summary.bestTrade
        ? `${summary.bestTrade.symbol} ${formatMoney(summary.bestTrade.pnl)}`
        : 'n/a';

    const worstTradeLine = summary.worstTrade
        ? `${summary.worstTrade.symbol} ${formatMoney(summary.worstTrade.pnl)}`
        : 'n/a';

    const header = [
        `## 📘 Futures Summary`,
        `Account: \`${accountId}\``,
        `Range: last \`${days}\` day(s)`,
        `Contracts shown: \`${topContracts.length}\` of \`${summary.contracts.length}\``,
    ].join('\n');

    const overview = [
        `### Overall`,
        `**Trades:** \`${summary.totalTrades}\``,
        `**Wins / Losses / Flats:** \`${summary.wins}\` / \`${summary.losses}\` / \`${summary.flats}\``,
        `**Win Rate:** \`${formatPct(summary.winRate)}\``,
        `**Gross P/L:** \`${formatMoney(summary.grossPnl)}\``,
        `**Fees:** \`${formatMoneyNegative(summary.fees)}\``,
        `**Net P/L:** \`${formatMoney(summary.netPnl)}\``,
        `**Total Size:** \`${formatSignedNumber(summary.totalSize, 0).replace('+', '')}\``,
        `**Avg Win:** \`${formatMoney(summary.avgWin)}\``,
        `**Avg Loss:** \`${formatMoney(summary.avgLoss)}\``,
        `**Profit Factor:** \`${
            summary.profitFactor == null
                ? 'n/a'
                : Number.isFinite(summary.profitFactor)
                  ? summary.profitFactor.toFixed(2)
                  : '∞'
        }\``,
        `**Best Trade:** \`${bestTradeLine}\``,
        `**Worst Trade:** \`${worstTradeLine}\``,
    ].join('\n');

    const contractLines = topContracts.length
        ? topContracts
              .map((contract, index) =>
                  [
                      `### ${index + 1}. ${contract.symbol}`,
                      `Trades: \`${contract.trades}\`  •  Wins/Losses/Flats: \`${contract.wins}/${contract.losses}/${contract.flats}\`  •  Win Rate: \`${formatPct(contract.winRate)}\``,
                      `Gross: \`${formatMoney(contract.grossPnl)}\`  •  Fees: \`${formatMoneyNegative(contract.fees)}\`  •  Net: \`${formatMoney(contract.netPnl)}\``,
                      `Size: \`${contract.totalSize}\`  •  Avg Hold: \`${formatDuration(contract.avgDurationMs)}\``,
                      `Avg Win: \`${formatMoney(contract.avgWin)}\`  •  Avg Loss: \`${formatMoney(contract.avgLoss)}\``,
                      `Best: \`${formatMoney(contract.bestTrade)}\`  •  Worst: \`${formatMoney(contract.worstTrade)}\``,
                  ].join('\n')
              )
              .join('\n\n')
        : 'No completed round-trip trades were found in this range.';

    return new ContainerBuilder()
        .setAccentColor(pnlAccentColor(summary.netPnl))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(overview))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(contractLines));
}

async function buildFuturesPayload(
    discordUserId: string,
    credentials: ProjectXUserCredentials,
    accountId: number,
    days: number,
    limit: number
): Promise<InteractionEditReplyOptions> {
    const trades = await searchTrades(discordUserId, credentials, accountId, days);
    const contractNames = await resolveContractNames(
        discordUserId,
        credentials,
        trades.map(t => t.contractId)
    );
    const { roundTrips } = reconstructRoundTrips(trades, contractNames);

    const container = buildFuturesContainer(accountId, days, limit, roundTrips);

    return {
        flags: MessageFlags.IsComponentsV2 as InteractionEditReplyOptions['flags'],
        components: [container],
        files: [],
    };
}

function formatMonthYear(year: number, month: number): string {
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString([], {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

function parseDateInputOrThrow(input: string, endOfDay = false): Date {
    const trimmed = input.trim();
    const match = trimmed.match(/^(\d{2})-(\d{2})-(\d{2})$/);

    if (!match) {
        throw new Error(`Invalid date "${input}". Use MM-DD-YY.`);
    }

    const [, monthStr, dayStr, yearStr] = match;
    const month = Number(monthStr);
    const day = Number(dayStr);
    const year = 2000 + Number(yearStr);

    const date = new Date(
        Date.UTC(
            year,
            month - 1,
            day,
            endOfDay ? 23 : 0,
            endOfDay ? 59 : 0,
            endOfDay ? 59 : 0,
            endOfDay ? 999 : 0
        )
    );

    if (
        Number.isNaN(date.getTime()) ||
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        throw new Error(`Invalid date "${input}". Use MM-DD-YY.`);
    }

    return date;
}

function buildDateRangeInput(startInput: string, endInput: string): DateRangeInput {
    const start = parseDateInputOrThrow(startInput, false);
    const end = parseDateInputOrThrow(endInput, true);

    if (start.getTime() > end.getTime()) {
        throw new Error('Start date must be on or before end date.');
    }

    const startTradingDayKey = `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}-${pad2(start.getUTCDate())}`;
    const endTradingDayKey = `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}`;

    const fetchStart = new Date(start);
    fetchStart.setUTCDate(fetchStart.getUTCDate() - 3);
    fetchStart.setUTCHours(0, 0, 0, 0);

    const fetchEnd = new Date(end);
    fetchEnd.setUTCDate(fetchEnd.getUTCDate() + 3);
    fetchEnd.setUTCHours(23, 59, 59, 999);

    return {
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        fetchStartIso: fetchStart.toISOString(),
        fetchEndIso: fetchEnd.toISOString(),
        startTradingDayKey,
        endTradingDayKey,
        startLabel: startInput,
        endLabel: endInput,
    };
}

function findDurationBucketIndex(durationMs: number): number {
    for (let i = 0; i < DURATION_BUCKETS.length; i++) {
        const bucket = DURATION_BUCKETS[i];
        const withinMin = durationMs >= bucket.minMs;
        const withinMax = bucket.maxMs == null ? true : durationMs < bucket.maxMs;
        if (withinMin && withinMax) return i;
    }

    return DURATION_BUCKETS.length - 1;
}

function buildDurationBucketStats(roundTrips: RoundTripTrade[]): DurationBucketStat[] {
    const stats = DURATION_BUCKETS.map(bucket => ({
        label: bucket.label,
        count: 0,
        wins: 0,
        winRate: 0,
    }));

    for (const trade of roundTrips) {
        const idx = findDurationBucketIndex(Math.max(0, trade.durationMs));
        stats[idx].count += 1;
        if (trade.pnl > 0) stats[idx].wins += 1;
    }

    for (const stat of stats) {
        stat.winRate = stat.count > 0 ? (stat.wins / stat.count) * 100 : 0;
    }

    return stats;
}

function roundRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function fillRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    fill: string | CanvasGradient
): void {
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
}

function strokeRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    stroke: string,
    lineWidth = 1
): void {
    roundRectPath(ctx, x, y, w, h, r);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
}

function renderAnalysisPng(
    roundTrips: RoundTripTrade[],
    accountId: number,
    range: DateRangeInput
): Buffer {
    const width = 3840;
    const height = 2160;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, '#081423');
    bgGrad.addColorStop(1, '#020814');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(32, 81, 145, 0.18)';
    ctx.fillRect(0, 0, width, 220);

    const stats = buildDurationBucketStats(roundTrips);
    const totalTrades = roundTrips.length;
    const wins = roundTrips.filter(t => t.pnl > 0).length;
    const losses = roundTrips.filter(t => t.pnl < 0).length;
    const totalPnl = roundTrips.reduce((sum, t) => sum + t.pnl, 0);
    const avgPnl = totalTrades ? totalPnl / totalTrades : 0;
    const avgDurationMs = totalTrades
        ? roundTrips.reduce((sum, t) => sum + t.durationMs, 0) / totalTrades
        : 0;

    ctx.fillStyle = '#f8fbff';
    ctx.font = 'bold 76px sans-serif';
    ctx.fillText('Trade Duration & Win Rate Analysis', 96, 108);

    ctx.fillStyle = 'rgba(230, 238, 249, 0.76)';
    ctx.font = '34px sans-serif';
    ctx.fillText(`Account ${accountId}  •  ${range.startLabel} → ${range.endLabel}`, 96, 164);

    const summaryY = 250;
    const summaryBoxH = 160;
    const summaryGap = 22;
    const summaryWidth = (width - 96 * 2 - summaryGap * 4) / 5;
    const summaryItems = [
        ['Trades', String(totalTrades)],
        ['Wins / Losses', `${wins} / ${losses}`],
        ['Net P/L', formatMoney(totalPnl)],
        ['Avg P/L', formatMoney(avgPnl)],
        ['Avg Duration', formatDuration(avgDurationMs)],
    ];

    for (let i = 0; i < summaryItems.length; i++) {
        const x = 96 + i * (summaryWidth + summaryGap);
        fillRoundedRect(ctx, x, summaryY, summaryWidth, summaryBoxH, 26, 'rgba(5, 14, 27, 0.9)');
        strokeRoundedRect(
            ctx,
            x,
            summaryY,
            summaryWidth,
            summaryBoxH,
            26,
            'rgba(88, 127, 184, 0.24)'
        );

        ctx.fillStyle = 'rgba(202, 215, 234, 0.78)';
        ctx.font = '30px sans-serif';
        ctx.fillText(summaryItems[i][0], x + 34, summaryY + 52);

        ctx.fillStyle =
            i === 2 || i === 3
                ? Number(summaryItems[i][1].replace(/[^\d.-]/g, '')) >= 0
                    ? '#59dd75'
                    : '#ff6b7d'
                : '#f8fbff';
        ctx.font = 'bold 48px sans-serif';
        ctx.fillText(summaryItems[i][1], x + 34, summaryY + 115);
    }

    const cardGap = 40;
    const cardY = 470;
    const cardH = 1560;
    const cardW = (width - 96 * 2 - cardGap) / 2;

    const drawBarCard = (x: number, title: string, subtitle: string, mode: 'count' | 'winrate') => {
        fillRoundedRect(ctx, x, cardY, cardW, cardH, 32, 'rgba(3, 10, 20, 0.94)');
        strokeRoundedRect(ctx, x, cardY, cardW, cardH, 32, 'rgba(88, 127, 184, 0.24)');

        ctx.fillStyle = '#f8fbff';
        ctx.font = 'bold 48px sans-serif';
        ctx.fillText(title, x + 44, cardY + 78);

        ctx.fillStyle = 'rgba(202, 215, 234, 0.72)';
        ctx.font = '28px sans-serif';
        ctx.fillText(subtitle, x + 44, cardY + 120);

        const chartLeft = x + 320;
        const chartTop = cardY + 180;
        const chartRight = x + cardW - 54;
        const chartBottom = cardY + cardH - 58;
        const chartW = chartRight - chartLeft;
        const rowH = (chartBottom - chartTop) / stats.length;
        const maxCount = Math.max(...stats.map(s => s.count), 1);

        const gridCount = mode === 'count' ? 4 : 10;
        for (let i = 0; i <= gridCount; i++) {
            const ratio = i / gridCount;
            const gridX = chartLeft + chartW * ratio;
            ctx.strokeStyle = 'rgba(99, 126, 162, 0.22)';
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 10]);
            ctx.beginPath();
            ctx.moveTo(gridX, chartTop - 8);
            ctx.lineTo(gridX, chartBottom + 8);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = 'rgba(197, 210, 229, 0.72)';
            ctx.font = '24px sans-serif';
            const label =
                mode === 'count'
                    ? String(Math.round(maxCount * ratio))
                    : `${Math.round(100 * ratio)}%`;
            ctx.fillText(label, gridX - 12, chartBottom + 40);
        }

        for (let i = 0; i < stats.length; i++) {
            const stat = stats[i];
            const rowY = chartTop + i * rowH;
            const barY = rowY + rowH * 0.18;
            const barH = rowH * 0.64;
            const value = mode === 'count' ? stat.count : stat.winRate;
            const maxValue = mode === 'count' ? maxCount : 100;
            const barW = maxValue > 0 ? (value / maxValue) * chartW : 0;

            ctx.fillStyle = '#eef4ff';
            ctx.font = '28px sans-serif';
            ctx.fillText(stat.label, x + 44, rowY + rowH * 0.58);

            fillRoundedRect(ctx, chartLeft, barY, chartW, barH, 18, 'rgba(22, 34, 53, 0.9)');

            const fill =
                mode === 'count'
                    ? '#b9b9bb'
                    : stat.count === 0
                      ? '#64748b'
                      : stat.winRate >= 70
                        ? '#59dd75'
                        : '#e56572';

            if (barW > 0) {
                fillRoundedRect(ctx, chartLeft, barY, Math.max(barW, 10), barH, 18, fill);
            }

            ctx.fillStyle = '#f8fbff';
            ctx.font = 'bold 28px sans-serif';
            const valueLabel = mode === 'count' ? `${stat.count}` : formatPct(stat.winRate);
            ctx.fillText(valueLabel, chartLeft + Math.max(barW, 8) + 14, rowY + rowH * 0.58);
        }
    };

    drawBarCard(96, 'Trade Duration Analysis', 'Trade count by holding time bucket', 'count');
    drawBarCard(
        96 + cardW + cardGap,
        'Win Rate Analysis',
        'Win rate inside each duration bucket',
        'winrate'
    );

    return canvas.toBuffer('image/png');
}

function buildAnalysisAttachment(
    roundTrips: RoundTripTrade[],
    accountId: number,
    range: DateRangeInput
): AttachmentBuilder {
    const png = renderAnalysisPng(roundTrips, accountId, range);
    return new AttachmentBuilder(png, {
        name: `analysis_${accountId}_${range.startLabel}_${range.endLabel}.png`,
    });
}

type WeekdayPerformance = {
    weekdayIndex: number;
    weekday: string;
    activeDays: number;
    totalTrades: number;
    avgTradesPerDay: number;
    pnl: number;
};

type DailyPerformance = {
    key: string;
    weekdayIndex: number;
    weekday: string;
    pnl: number;
    trades: number;
};

type AnalysisOverviewStats = {
    mostActiveDay: WeekdayPerformance;
    mostProfitableDay: WeekdayPerformance;
    leastProfitableDay: WeekdayPerformance;
    totalTrades: number;
    totalLots: number;
    totalNetPnl: number;
    averageTradeDurationMs: number;
    averageWinDurationMs: number;
    averageLossDurationMs: number;
    averageWinningTrade: number;
    averageLosingTrade: number;
    winningTrades: number;
    losingTrades: number;
    tradeWinPct: number;
    avgWinLossRatio: number | null;
    winningDays: number;
    losingDays: number;
    flatDays: number;
    dayWinPct: number;
    profitFactor: number | null;
    grossWinningPnl: number;
    grossLosingPnlAbs: number;
    bestDayPctOfTotalProfit: number;
    longTrades: number;
    shortTrades: number;
    longTradePct: number;
    bestTrade: RoundTripTrade | null;
    worstTrade: RoundTripTrade | null;
};

function formatDurationWords(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '0 sec';

    const totalSeconds = Math.round(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts: string[] = [];

    if (hours > 0) parts.push(`${hours} hr${hours === 1 ? '' : 's'}`);
    if (minutes > 0) parts.push(`${minutes} min`);
    if (seconds > 0 || !parts.length) parts.push(`${seconds} sec`);

    return parts.slice(0, 2).join(' ');
}

function formatDateTimeForDisplay(input: string): string {
    const date = new Date(input);
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    const year = date.getFullYear();
    const hours = pad2(date.getHours());
    const minutes = pad2(date.getMinutes());
    const seconds = pad2(date.getSeconds());
    return `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`;
}

function getWeekdayNameFromTradingKey(key: string): string {
    const [year, month, day] = key.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

function getCalendarDateParts(
    input: string,
    timeZone = 'America/New_York'
): {
    year: number;
    month: number;
    day: number;
} {
    const date = new Date(input);
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);

    const year = Number(parts.find(part => part.type === 'year')?.value);
    const month = Number(parts.find(part => part.type === 'month')?.value);
    const day = Number(parts.find(part => part.type === 'day')?.value);

    if (!year || !month || !day) {
        throw new Error(`Failed to resolve calendar date parts for timestamp: ${input}`);
    }

    return { year, month, day };
}

function getNetTradePnl(trade: RoundTripTrade): number {
    return trade.pnl - trade.fees;
}

function filterRoundTripsForTradingDayRange(
    roundTrips: RoundTripTrade[],
    startTradingDayKey: string,
    endTradingDayKey: string
): RoundTripTrade[] {
    return roundTrips.filter(trade => {
        const tradingDayKey = getTradingDayKey(trade.exitTime);
        return tradingDayKey >= startTradingDayKey && tradingDayKey <= endTradingDayKey;
    });
}

function buildAnalysisOverviewStats(roundTrips: RoundTripTrade[]): AnalysisOverviewStats {
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const calendarDayMap = new Map<string, DayAggregate>();
    let totalLots = 0;
    let totalDurationMs = 0;
    let winDurationMsTotal = 0;
    let lossDurationMsTotal = 0;
    let winCount = 0;
    let lossCount = 0;
    let winTotal = 0;
    let lossTotal = 0;
    let longTrades = 0;
    let shortTrades = 0;
    let bestTrade: RoundTripTrade | null = null;
    let worstTrade: RoundTripTrade | null = null;
    let bestTradeNet = Number.NEGATIVE_INFINITY;
    let worstTradeNet = Number.POSITIVE_INFINITY;

    for (const trade of roundTrips) {
        const key = getTradingDayKey(trade.exitTime);
        const current = calendarDayMap.get(key) ?? { pnl: 0, grossPnl: 0, trades: 0 };
        const netPnl = getNetTradePnl(trade);
        current.pnl += netPnl;
        current.grossPnl += trade.pnl;
        current.trades += 1;
        calendarDayMap.set(key, current);

        totalLots += trade.size;
        totalDurationMs += trade.durationMs;

        if (trade.direction === 'Long') longTrades += 1;
        else shortTrades += 1;

        if (netPnl > 0) {
            winCount += 1;
            winDurationMsTotal += trade.durationMs;
            winTotal += netPnl;
        } else if (netPnl < 0) {
            lossCount += 1;
            lossDurationMsTotal += trade.durationMs;
            lossTotal += netPnl;
        }

        if (netPnl > bestTradeNet) {
            bestTradeNet = netPnl;
            bestTrade = trade;
        }
        if (netPnl < worstTradeNet) {
            worstTradeNet = netPnl;
            worstTrade = trade;
        }
    }

    const dailyPerformances: DailyPerformance[] = [...calendarDayMap.entries()].map(
        ([key, aggregate]) => {
            const weekday = getWeekdayNameFromTradingKey(key);
            const weekdayIndex = weekdays.indexOf(weekday);
            return {
                key,
                weekdayIndex: weekdayIndex >= 0 ? weekdayIndex : 0,
                weekday,
                pnl: aggregate.pnl,
                trades: aggregate.trades,
            };
        }
    );

    const byWeekday = weekdays.map((weekday, weekdayIndex) => ({
        weekdayIndex,
        weekday,
        activeDays: 0,
        totalTrades: 0,
        avgTradesPerDay: 0,
        pnl: 0,
    }));

    let winningDays = 0;
    let losingDays = 0;
    let flatDays = 0;

    for (const daily of dailyPerformances) {
        const weekdayEntry = byWeekday[daily.weekdayIndex];
        weekdayEntry.activeDays += 1;
        weekdayEntry.totalTrades += daily.trades;
        weekdayEntry.pnl += daily.pnl;

        if (daily.pnl > 0) {
            winningDays += 1;
        } else if (daily.pnl < 0) {
            losingDays += 1;
        } else {
            flatDays += 1;
        }
    }

    for (const entry of byWeekday) {
        entry.avgTradesPerDay = entry.activeDays > 0 ? entry.totalTrades / entry.activeDays : 0;
    }

    const activeWeekdayEntries = byWeekday.filter(entry => entry.activeDays > 0);
    const fallbackWeekday = byWeekday[0];
    const fallbackDaily = dailyPerformances[0] ?? {
        key: '',
        weekdayIndex: 0,
        weekday: fallbackWeekday.weekday,
        pnl: 0,
        trades: 0,
    };

    const mostActiveDay =
        activeWeekdayEntries.slice().sort((a, b) => {
            if (b.totalTrades !== a.totalTrades) return b.totalTrades - a.totalTrades;
            if (b.avgTradesPerDay !== a.avgTradesPerDay)
                return b.avgTradesPerDay - a.avgTradesPerDay;
            return a.weekdayIndex - b.weekdayIndex;
        })[0] ?? fallbackWeekday;

    const bestDaily =
        dailyPerformances.slice().sort((a, b) => {
            if (b.pnl !== a.pnl) return b.pnl - a.pnl;
            return a.key.localeCompare(b.key);
        })[0] ?? fallbackDaily;

    const worstDaily =
        dailyPerformances.slice().sort((a, b) => {
            if (a.pnl !== b.pnl) return a.pnl - b.pnl;
            return a.key.localeCompare(b.key);
        })[0] ?? fallbackDaily;

    const mostProfitableDay: WeekdayPerformance = {
        weekdayIndex: bestDaily.weekdayIndex,
        weekday: bestDaily.weekday,
        activeDays: 1,
        totalTrades: bestDaily.trades,
        avgTradesPerDay: bestDaily.trades,
        pnl: bestDaily.pnl,
    };

    const leastProfitableDay: WeekdayPerformance = {
        weekdayIndex: worstDaily.weekdayIndex,
        weekday: worstDaily.weekday,
        activeDays: 1,
        totalTrades: worstDaily.trades,
        avgTradesPerDay: worstDaily.trades,
        pnl: worstDaily.pnl,
    };

    const totalNetPnl = winTotal + lossTotal;
    const grossLosingPnlAbs = Math.abs(lossTotal);
    const decidedDayCount = winningDays + losingDays;

    return {
        mostActiveDay,
        mostProfitableDay,
        leastProfitableDay,
        totalTrades: roundTrips.length,
        totalLots,
        totalNetPnl,
        averageTradeDurationMs: roundTrips.length ? totalDurationMs / roundTrips.length : 0,
        averageWinDurationMs: winCount ? winDurationMsTotal / winCount : 0,
        averageLossDurationMs: lossCount ? lossDurationMsTotal / lossCount : 0,
        averageWinningTrade: winCount ? winTotal / winCount : 0,
        averageLosingTrade: lossCount ? lossTotal / lossCount : 0,
        winningTrades: winCount,
        losingTrades: lossCount,
        tradeWinPct: roundTrips.length ? (winCount / roundTrips.length) * 100 : 0,
        avgWinLossRatio:
            winCount && lossCount && Math.abs(lossTotal / lossCount) > 0
                ? winTotal / winCount / Math.abs(lossTotal / lossCount)
                : null,
        winningDays,
        losingDays,
        flatDays,
        dayWinPct: decidedDayCount ? (winningDays / decidedDayCount) * 100 : 0,
        profitFactor:
            grossLosingPnlAbs > 0
                ? winTotal / grossLosingPnlAbs
                : winTotal > 0
                  ? Number.POSITIVE_INFINITY
                  : null,
        grossWinningPnl: winTotal,
        grossLosingPnlAbs,
        bestDayPctOfTotalProfit:
            totalNetPnl > 0 && mostProfitableDay.pnl > 0
                ? (mostProfitableDay.pnl / totalNetPnl) * 100
                : 0,
        longTrades,
        shortTrades,
        longTradePct: roundTrips.length ? (longTrades / roundTrips.length) * 100 : 0,
        bestTrade,
        worstTrade,
    };
}

function drawInfoIcon(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(219, 229, 241, 0.84)';
    ctx.fill();

    ctx.fillStyle = '#07111f';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('?', x - 7, y + 8);
}

function renderAnalysisOverviewPng(
    roundTrips: RoundTripTrade[],
    accountId: number,
    range: DateRangeInput
): Buffer {
    const width = 3840;
    const height = 2680;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, '#081423');
    bgGrad.addColorStop(1, '#020814');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(32, 81, 145, 0.14)';
    ctx.fillRect(0, 0, width, 190);

    ctx.fillStyle = '#f8fbff';
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText('Trade Performance Overview', 92, 106);

    ctx.fillStyle = 'rgba(230, 238, 249, 0.76)';
    ctx.font = '30px sans-serif';
    ctx.fillText(`Account ${accountId}  •  ${range.startLabel} → ${range.endLabel}`, 92, 154);

    const stats = buildAnalysisOverviewStats(roundTrips);
    const gap = 36;
    const left = 60;
    const top = 230;
    const colW = (width - left * 2 - gap * 2) / 3;
    const rowHeights = [250, 250, 260, 260, 260, 260, 300];
    const rowYs: number[] = [];
    let cursorY = top;
    for (const rowH of rowHeights) {
        rowYs.push(cursorY);
        cursorY += rowH + gap;
    }

    function drawCard(x: number, y: number, w: number, h: number, title: string): void {
        fillRoundedRect(ctx, x, y, w, h, 30, 'rgba(3, 10, 20, 0.94)');
        strokeRoundedRect(ctx, x, y, w, h, 30, 'rgba(88, 127, 184, 0.24)');
        ctx.fillStyle = 'rgba(202, 215, 234, 0.74)';
        ctx.font = '30px sans-serif';
        ctx.fillText(title, x + 34, y + 56);
        drawInfoIcon(ctx, x + 34 + ctx.measureText(title).width + 40, y + 47);
    }

    function drawMetricValue(
        x: number,
        y: number,
        value: string,
        color = '#f8fbff',
        size = 64
    ): void {
        ctx.fillStyle = color;
        ctx.font = `bold ${size}px sans-serif`;
        ctx.fillText(value, x, y);
    }

    function drawMetricValueRight(
        x: number,
        y: number,
        value: string,
        color = '#f8fbff',
        size = 64
    ): void {
        ctx.fillStyle = color;
        ctx.font = `bold ${size}px sans-serif`;
        const prevAlign = ctx.textAlign;
        ctx.textAlign = 'right';
        ctx.fillText(value, x, y);
        ctx.textAlign = prevAlign;
    }

    function drawTradeDetailBlock(
        x: number,
        y: number,
        trade: RoundTripTrade | null,
        pnlColor: string
    ): void {
        if (!trade) {
            ctx.fillStyle = 'rgba(202, 215, 234, 0.6)';
            ctx.font = '28px sans-serif';
            ctx.fillText('No trade data', x, y + 20);
            return;
        }

        const net = getNetTradePnl(trade);
        drawMetricValue(x, y + 26, formatMoney(net), pnlColor, 70);

        ctx.fillStyle = 'rgba(230, 238, 249, 0.76)';
        ctx.font = '34px sans-serif';
        ctx.fillText(
            `${trade.direction} ${trade.size} ${trade.symbol} @ ${formatPrice(trade.entryPrice)}`,
            x + 700,
            y + 26
        );
        ctx.fillText(`Exited @ ${formatPrice(trade.exitPrice)}`, x + 700, y + 78);
        ctx.fillText(formatDateTimeForDisplay(trade.exitTime), x + 700, y + 130);
    }

    function drawSemiGauge(
        x: number,
        y: number,
        w: number,
        h: number,
        title: string,
        percent: number,
        positiveCount: number,
        negativeCount: number
    ): void {
        drawCard(x, y, w, h, title);
        drawMetricValue(x + 34, y + 164, `${percent.toFixed(2)}%`, '#f8fbff', 70);

        const gaugeCx = x + w - 210;
        const gaugeCy = y + h - 78;
        const radius = 86;
        const stroke = 26;
        const totalCount = Math.max(positiveCount + negativeCount, 1);
        const negativeRatio = clamp(negativeCount / totalCount, 0, 1);

        ctx.lineCap = 'round';
        ctx.lineWidth = stroke;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(55, 73, 99, 0.92)';
        ctx.arc(gaugeCx, gaugeCy, radius, Math.PI, Math.PI * 2);
        ctx.stroke();

        if (negativeRatio > 0) {
            ctx.beginPath();
            ctx.strokeStyle = '#ff6678';
            ctx.arc(gaugeCx, gaugeCy, radius, Math.PI, Math.PI + Math.PI * negativeRatio);
            ctx.stroke();
        }

        if (negativeRatio < 1) {
            ctx.beginPath();
            ctx.strokeStyle = '#59dd75';
            ctx.arc(gaugeCx, gaugeCy, radius, Math.PI + Math.PI * negativeRatio, Math.PI * 2);
            ctx.stroke();
        }

        ctx.lineCap = 'butt';
        ctx.font = 'bold 38px sans-serif';

        const positiveText = String(positiveCount);
        const negativeText = String(negativeCount);
        const positiveWidth = ctx.measureText(positiveText).width;
        const negativeWidth = ctx.measureText(negativeText).width;

        ctx.fillStyle = '#59dd75';
        ctx.fillText(
            positiveText,
            Math.min(gaugeCx + radius + 44, x + w - positiveWidth - 28),
            gaugeCy - 22
        );
        ctx.fillStyle = '#ff6678';
        ctx.fillText(
            negativeText,
            Math.max(x + 28, gaugeCx - radius - 44 - negativeWidth),
            gaugeCy - 22
        );
    }

    function drawDonutBreakdown(
        x: number,
        y: number,
        w: number,
        h: number,
        title: string,
        primaryValue: string,
        positiveAmount: number,
        negativeAmountAbs: number,
        positiveLabel: string,
        negativeLabel: string
    ): void {
        drawCard(x, y, w, h, title);
        drawMetricValue(x + 34, y + 164, primaryValue, '#f8fbff', 70);

        const donutCx = x + w - 360;
        const donutCy = y + h / 2 + 2;
        const radius = 66;
        const stroke = 26;
        const total = Math.max(positiveAmount + negativeAmountAbs, 1);
        const positiveAngle = (Math.PI * 2 * positiveAmount) / total;
        const positiveStart = Math.PI - positiveAngle / 2;
        const positiveEnd = positiveStart + positiveAngle;

        ctx.lineWidth = stroke;
        ctx.beginPath();
        ctx.strokeStyle = '#ff6678';
        ctx.arc(donutCx, donutCy, radius, positiveEnd, positiveStart + Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = '#59dd75';
        ctx.arc(donutCx, donutCy, radius, positiveStart, positiveEnd);
        ctx.stroke();

        ctx.fillStyle = '#59dd75';
        ctx.font = 'bold 32px sans-serif';
        const posWidth = ctx.measureText(positiveLabel).width;
        ctx.fillText(
            positiveLabel,
            Math.max(x + 34, donutCx - radius - 34 - posWidth),
            donutCy + 12
        );

        ctx.fillStyle = '#ff6678';
        const negWidth = ctx.measureText(negativeLabel).width;
        ctx.fillText(
            negativeLabel,
            Math.min(donutCx + radius + 20, x + w - negWidth - 34),
            donutCy - 2
        );
    }

    function drawAvgWinLossCard(x: number, y: number, w: number, h: number): void {
        drawCard(x, y, w, h, 'Avg Win / Avg Loss');
        const ratioText =
            stats.avgWinLossRatio == null
                ? 'n/a'
                : Number.isFinite(stats.avgWinLossRatio)
                  ? stats.avgWinLossRatio.toFixed(2)
                  : '∞';
        drawMetricValue(x + 34, y + 164, ratioText, '#f8fbff', 70);

        const barX = x + 520;
        const barY = y + 44;
        const barW = w - 600;
        const barH = 28;
        const avgWinAbs = Math.max(stats.averageWinningTrade, 0);
        const avgLossAbs = Math.abs(stats.averageLosingTrade);
        const total = Math.max(avgWinAbs + avgLossAbs, 1);
        const greenW = (barW * avgWinAbs) / total;
        const redW = barW - greenW;

        fillRoundedRect(ctx, barX, barY, barW, barH, 14, 'rgba(22, 34, 53, 0.9)');
        if (greenW > 0) {
            fillRoundedRect(ctx, barX, barY, Math.max(greenW, 8), barH, 14, '#59dd75');
        }
        if (redW > 0) {
            fillRoundedRect(ctx, barX + greenW, barY, Math.max(redW, 8), barH, 14, '#ff6678');
        }

        drawMetricValueRight(
            x + w - 430,
            y + 158,
            formatMoney(stats.averageWinningTrade),
            '#59dd75',
            58
        );
        drawMetricValueRight(
            x + w - 60,
            y + 158,
            formatMoney(stats.averageLosingTrade),
            '#ff6678',
            58
        );
    }

    // Row 1
    drawCard(left, rowYs[0], colW, rowHeights[0], 'Total P&L');
    drawMetricValue(
        left + 34,
        rowYs[0] + 164,
        formatMoney(stats.totalNetPnl),
        stats.totalNetPnl >= 0 ? '#59dd75' : '#ff6b7d',
        78
    );

    drawSemiGauge(
        left + colW + gap,
        rowYs[0],
        colW,
        rowHeights[0],
        'Trade Win %',
        stats.tradeWinPct,
        stats.winningTrades,
        stats.losingTrades
    );

    drawAvgWinLossCard(left + (colW + gap) * 2, rowYs[0], colW, rowHeights[0]);

    // Row 2
    drawSemiGauge(
        left,
        rowYs[1],
        colW,
        rowHeights[1],
        'Day Win %',
        stats.dayWinPct,
        stats.winningDays,
        stats.losingDays
    );

    drawDonutBreakdown(
        left + colW + gap,
        rowYs[1],
        colW,
        rowHeights[1],
        'Profit Factor',
        stats.profitFactor == null
            ? 'n/a'
            : Number.isFinite(stats.profitFactor)
              ? stats.profitFactor.toFixed(2)
              : '∞',
        stats.grossWinningPnl,
        stats.grossLosingPnlAbs,
        formatMoney(stats.grossWinningPnl),
        formatMoney(-stats.grossLosingPnlAbs)
    );

    drawCard(left + (colW + gap) * 2, rowYs[1], colW, rowHeights[1], 'Best Day % of Total Profit');
    drawMetricValue(
        left + (colW + gap) * 2 + 34,
        rowYs[1] + 164,
        `${stats.bestDayPctOfTotalProfit.toFixed(2)}%`,
        '#f8fbff',
        72
    );

    // Row 3
    drawCard(left, rowYs[2], colW, rowHeights[2], 'Most Active Day');
    drawMetricValue(left + 34, rowYs[2] + 140, stats.mostActiveDay.weekday, '#f8fbff', 74);
    ctx.fillStyle = 'rgba(230, 238, 249, 0.76)';
    ctx.font = '30px sans-serif';
    ctx.fillText(`${stats.mostActiveDay.activeDays} active days`, left + colW - 380, rowYs[2] + 62);
    ctx.fillText(
        `${stats.mostActiveDay.totalTrades} total trades`,
        left + colW - 380,
        rowYs[2] + 104
    );
    ctx.fillText(
        `${stats.mostActiveDay.avgTradesPerDay.toFixed(2)} avg trades/day`,
        left + colW - 380,
        rowYs[2] + 146
    );

    drawCard(left + colW + gap, rowYs[2], colW, rowHeights[2], 'Most Profitable Day');
    drawMetricValue(
        left + colW + gap + 34,
        rowYs[2] + 140,
        stats.mostProfitableDay.weekday,
        '#f8fbff',
        74
    );
    drawMetricValueRight(
        left + colW + gap + colW - 34,
        rowYs[2] + 120,
        formatMoney(stats.mostProfitableDay.pnl),
        '#59dd75',
        56
    );

    drawCard(left + (colW + gap) * 2, rowYs[2], colW, rowHeights[2], 'Least Profitable Day');
    drawMetricValue(
        left + (colW + gap) * 2 + 34,
        rowYs[2] + 140,
        stats.leastProfitableDay.weekday,
        '#f8fbff',
        74
    );
    drawMetricValueRight(
        left + (colW + gap) * 2 + colW - 34,
        rowYs[2] + 120,
        formatMoney(stats.leastProfitableDay.pnl),
        stats.leastProfitableDay.pnl >= 0 ? '#59dd75' : '#ff6b7d',
        56
    );

    // Row 4
    drawCard(left, rowYs[3], colW, rowHeights[3], 'Total Number of Trades');
    drawMetricValue(left + 34, rowYs[3] + 152, String(stats.totalTrades), '#f8fbff', 76);

    drawCard(left + colW + gap, rowYs[3], colW, rowHeights[3], 'Total Number of Lots Traded');
    drawMetricValue(left + colW + gap + 34, rowYs[3] + 152, String(stats.totalLots), '#f8fbff', 76);

    drawCard(left + (colW + gap) * 2, rowYs[3], colW, rowHeights[3], 'Average Trade Duration');
    drawMetricValue(
        left + (colW + gap) * 2 + 34,
        rowYs[3] + 152,
        formatDurationWords(stats.averageTradeDurationMs),
        '#f8fbff',
        70
    );

    // Row 5
    drawCard(left, rowYs[4], colW * 1.5 + gap / 2, rowHeights[4], 'Average Win Duration');
    drawMetricValue(
        left + 34,
        rowYs[4] + 152,
        formatDurationWords(stats.averageWinDurationMs),
        '#f8fbff',
        74
    );

    const rightWideX = left + colW * 1.5 + gap * 1.5;
    drawCard(rightWideX, rowYs[4], colW * 1.5 + gap / 2, rowHeights[4], 'Average Loss Duration');
    drawMetricValue(
        rightWideX + 34,
        rowYs[4] + 152,
        formatDurationWords(stats.averageLossDurationMs),
        '#f8fbff',
        74
    );

    // Row 6
    drawCard(left, rowYs[5], colW, rowHeights[5], 'Avg Winning Trade');
    drawMetricValue(
        left + 34,
        rowYs[5] + 152,
        formatMoney(stats.averageWinningTrade),
        '#59dd75',
        70
    );

    drawCard(left + colW + gap, rowYs[5], colW, rowHeights[5], 'Avg Losing Trade');
    drawMetricValue(
        left + colW + gap + 34,
        rowYs[5] + 152,
        formatMoney(stats.averageLosingTrade),
        '#ff6b7d',
        70
    );

    const donutX = left + (colW + gap) * 2;
    drawCard(donutX, rowYs[5], colW, rowHeights[5], 'Trade Direction %');
    drawMetricValue(
        donutX + 34,
        rowYs[5] + 152,
        `${stats.longTradePct.toFixed(2)}%`,
        '#f8fbff',
        74
    );
    const cx = donutX + colW - 190;
    const cy = rowYs[5] + rowHeights[5] / 2 + 12;
    const radius = 78;
    const lineWidth = 30;
    const totalDirectionTrades = Math.max(stats.longTrades + stats.shortTrades, 1);
    const longAngle = (Math.PI * 2 * stats.longTrades) / totalDirectionTrades;
    const longStart = -longAngle / 2;
    const longEnd = longStart + longAngle;

    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.strokeStyle = '#ff6678';
    ctx.arc(cx, cy, radius, longEnd, longStart + Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = '#59dd75';
    ctx.arc(cx, cy, radius, longStart, longEnd);
    ctx.stroke();

    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'left';
    const longTradesText = String(stats.longTrades);
    const shortTradesText = String(stats.shortTrades);
    const shortTradesWidth = ctx.measureText(shortTradesText).width;
    ctx.fillStyle = '#59dd75';
    ctx.fillText(longTradesText, cx + radius + 34, cy + 16);
    ctx.fillStyle = '#ff6678';
    ctx.fillText(shortTradesText, cx - radius - 34 - shortTradesWidth, cy + 16);
    ctx.textAlign = 'left';

    // Row 7
    const bottomW = (width - left * 2 - gap) / 2;
    drawCard(left, rowYs[6], bottomW, rowHeights[6], 'Best Trade');
    drawTradeDetailBlock(left + 34, rowYs[6] + 112, stats.bestTrade, '#59dd75');

    drawCard(left + bottomW + gap, rowYs[6], bottomW, rowHeights[6], 'Worst Trade');
    drawTradeDetailBlock(left + bottomW + gap + 34, rowYs[6] + 112, stats.worstTrade, '#ff6b7d');

    return canvas.toBuffer('image/png');
}

function buildAnalysisOverviewAttachment(
    roundTrips: RoundTripTrade[],
    accountId: number,
    range: DateRangeInput
): AttachmentBuilder {
    const png = renderAnalysisOverviewPng(roundTrips, accountId, range);
    return new AttachmentBuilder(png, {
        name: `analysis_overview_${accountId}_${range.startLabel}_${range.endLabel}.png`,
    });
}

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

function getChicagoDateParts(input: string): {
    year: number;
    month: number;
    day: number;
    hour: number;
} {
    const date = new Date(input);
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
    }).formatToParts(date);

    const year = Number(parts.find(part => part.type === 'year')?.value);
    const month = Number(parts.find(part => part.type === 'month')?.value);
    const day = Number(parts.find(part => part.type === 'day')?.value);
    const hour = Number(parts.find(part => part.type === 'hour')?.value);

    if (!year || !month || !day || Number.isNaN(hour)) {
        throw new Error(`Failed to resolve Chicago date parts for timestamp: ${input}`);
    }

    return { year, month, day, hour };
}

function getTradingDayKey(input: string): string {
    const parts = getChicagoDateParts(input);
    const tradingDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

    if (parts.hour >= 16) {
        tradingDate.setUTCDate(tradingDate.getUTCDate() + 1);
    }

    return `${tradingDate.getUTCFullYear()}-${pad2(tradingDate.getUTCMonth() + 1)}-${pad2(tradingDate.getUTCDate())}`;
}

function buildDailyAggregates(roundTrips: RoundTripTrade[]): Map<string, DayAggregate> {
    const map = new Map<string, DayAggregate>();

    for (const trade of roundTrips) {
        const key = getTradingDayKey(trade.exitTime);
        const current = map.get(key) ?? { pnl: 0, grossPnl: 0, trades: 0 };
        current.pnl += trade.pnl - trade.fees;
        current.grossPnl += trade.pnl;
        current.trades += 1;
        map.set(key, current);
    }

    return map;
}

function filterRoundTripsForMonth(
    roundTrips: RoundTripTrade[],
    year: number,
    month: number
): RoundTripTrade[] {
    const prefix = `${year}-${pad2(month)}-`;
    return roundTrips.filter(trade => getTradingDayKey(trade.exitTime).startsWith(prefix));
}

function renderMonthlyPng(
    roundTrips: RoundTripTrade[],
    accountId: number,
    year: number,
    month: number
): Buffer {
    const width = 3840;
    const height = 2160;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, '#081423');
    bgGrad.addColorStop(1, '#020814');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    const monthLabel = formatMonthYear(year, month);
    const totalPnl = roundTrips.reduce((sum, t) => sum + (t.pnl - t.fees), 0);
    const totalTrades = roundTrips.length;

    ctx.fillStyle = '#f8fbff';
    ctx.font = 'bold 72px sans-serif';
    ctx.fillText(monthLabel, 180, 130);

    ctx.fillStyle = totalPnl >= 0 ? '#59dd75' : '#ff6b7d';
    ctx.font = 'bold 64px sans-serif';
    const pnlText = `Monthly P/L: ${formatMoney(totalPnl)}`;
    const pnlWidth = ctx.measureText(pnlText).width;
    ctx.fillText(pnlText, width / 2 - pnlWidth / 2, 130);

    ctx.fillStyle = 'rgba(230, 238, 249, 0.76)';
    ctx.font = '32px sans-serif';
    ctx.fillText(`Account ${accountId}  •  ${totalTrades} trades`, width - 700, 130);

    const gridX = 140;
    const gridY = 230;
    const gridW = width - 280;
    const gridH = height - 320;
    const cols = 7;
    const rows = 6;
    const cellW = gridW / cols;
    const cellH = gridH / rows;
    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    for (let i = 0; i < dayNames.length; i++) {
        ctx.fillStyle = 'rgba(210, 222, 239, 0.8)';
        ctx.font = 'bold 28px sans-serif';
        ctx.fillText(dayNames[i], gridX + i * cellW + 18, gridY - 18);
    }

    fillRoundedRect(ctx, gridX, gridY, gridW, gridH, 24, 'rgba(2, 8, 16, 0.75)');
    strokeRoundedRect(ctx, gridX, gridY, gridW, gridH, 24, 'rgba(88, 127, 184, 0.25)');

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));
    const firstWeekday = monthStart.getUTCDay();
    const daysInMonth = monthEnd.getUTCDate();
    const previousMonthDays = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
    const daily = buildDailyAggregates(roundTrips);

    const weekSummaries = Array.from({ length: rows }, (_, row) => {
        const startDay = row * 7 - firstWeekday + 1;
        let pnl = 0;
        let trades = 0;

        for (let d = 0; d < 7; d++) {
            const day = startDay + d;
            if (day < 1 || day > daysInMonth) continue;
            const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const value = daily.get(key);
            if (!value) continue;
            pnl += value.pnl;
            trades += value.trades;
        }

        return { pnl, trades };
    });

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const idx = row * cols + col;
            const dayNum = idx - firstWeekday + 1;
            const x = gridX + col * cellW;
            const y = gridY + row * cellH;
            const inMonth = dayNum >= 1 && dayNum <= daysInMonth;

            let displayDay = dayNum;
            let dimmed = false;
            let key: string | null = null;

            if (!inMonth) {
                dimmed = true;
                if (dayNum < 1) {
                    displayDay = previousMonthDays + dayNum;
                } else {
                    displayDay = dayNum - daysInMonth;
                }
            } else {
                key = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            }

            const agg = key ? (daily.get(key) ?? null) : null;

            const positiveFill = 'rgba(15, 103, 36, 0.75)';
            const negativeFill = 'rgba(140, 34, 48, 0.75)';
            const neutralFill = dimmed ? 'rgba(8, 12, 20, 0.7)' : 'rgba(3, 7, 15, 0.86)';
            const cellFill = agg ? (agg.pnl >= 0 ? positiveFill : negativeFill) : neutralFill;

            ctx.fillStyle = cellFill;
            ctx.fillRect(x, y, cellW, cellH);
            ctx.strokeStyle = 'rgba(132, 151, 180, 0.34)';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, cellW, cellH);

            ctx.fillStyle = dimmed ? 'rgba(161, 175, 195, 0.25)' : 'rgba(225, 233, 245, 0.9)';
            ctx.font = '28px sans-serif';
            ctx.fillText(String(displayDay), x + 18, y + 42);

            if (agg) {
                ctx.fillStyle = agg.pnl >= 0 ? '#59dd75' : '#ff6b7d';
                ctx.font = 'bold 54px sans-serif';
                const pnlLabel = formatMoney(agg.pnl);
                const pnlWidth = ctx.measureText(pnlLabel).width;
                ctx.fillText(pnlLabel, x + cellW / 2 - pnlWidth / 2, y + cellH / 2 + 8);

                ctx.fillStyle = 'rgba(229, 236, 246, 0.85)';
                ctx.font = '32px sans-serif';
                const tradesLabel = `${agg.trades} trade${agg.trades === 1 ? '' : 's'}`;
                const tradesWidth = ctx.measureText(tradesLabel).width;
                ctx.fillText(tradesLabel, x + cellW / 2 - tradesWidth / 2, y + cellH / 2 + 54);
            }

            if (col == 6) {
                const week = weekSummaries[row];
                ctx.fillStyle = 'rgba(232, 239, 248, 0.9)';
                ctx.font = 'bold 28px sans-serif';
                ctx.fillText(`Week ${row + 1}`, x + cellW - 150, y + 46);

                ctx.fillStyle = week.pnl >= 0 ? '#59dd75' : week.pnl < 0 ? '#ff6b7d' : '#f8fbff';
                ctx.font = 'bold 46px sans-serif';
                const weekPnl = formatMoney(week.pnl);
                const weekPnlWidth = ctx.measureText(weekPnl).width;
                ctx.fillText(weekPnl, x + cellW - weekPnlWidth - 18, y + cellH - 62);

                ctx.fillStyle = 'rgba(224, 232, 243, 0.82)';
                ctx.font = '28px sans-serif';
                const weekTrades = `${week.trades} trade${week.trades === 1 ? '' : 's'}`;
                const weekTradesWidth = ctx.measureText(weekTrades).width;
                ctx.fillText(weekTrades, x + cellW - weekTradesWidth - 18, y + cellH - 24);
            }
        }
    }

    return canvas.toBuffer('image/png');
}

function buildMonthlyAttachment(
    roundTrips: RoundTripTrade[],
    accountId: number,
    year: number,
    month: number
): AttachmentBuilder {
    const png = renderMonthlyPng(roundTrips, accountId, year, month);
    return new AttachmentBuilder(png, {
        name: `monthly_${accountId}_${year}-${String(month).padStart(2, '0')}.png`,
    });
}

// --------------------------------------------------
// COMPONENTS V2 BUILDERS
// --------------------------------------------------
function buildTradesContainer(
    accountId: number,
    days: number,
    page: number,
    perPage: number,
    roundTrips: RoundTripTrade[],
    openLotsRemaining: number
): ContainerBuilder {
    const totalPages = Math.max(1, Math.ceil(roundTrips.length / perPage));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const slice = roundTrips.slice(safePage * perPage, safePage * perPage + perPage);

    const totalPnl = roundTrips.reduce((sum, t) => sum + t.pnl, 0);
    const totalFees = roundTrips.reduce((sum, t) => sum + t.fees, 0);
    const wins = roundTrips.filter(t => t.pnl > 0).length;
    const losses = roundTrips.filter(t => t.pnl < 0).length;

    const container = new ContainerBuilder().setAccentColor(pnlAccentColor(totalPnl));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            [
                '# ProjectX Trades',
                `**Account:** \`${accountId}\``,
                `**Window:** \`${days} day(s)\``,
                `**Page:** \`${safePage + 1}/${totalPages}\``,
                `**Completed Trades:** \`${roundTrips.length}\``,
                `**Total PnL:** \`${formatMoney(totalPnl)}\``,
                `**Total Fees:** \`${formatMoneyNegative(totalFees)}\``,
                `**Wins / Losses:** \`${wins} / ${losses}\``,
                `**Open Lots Remaining:** \`${openLotsRemaining}\``,
            ].join('\n')
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder());

    if (slice.length === 0) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                'No completed round-trip trades were reconstructed for this window.'
            )
        );
    } else {
        for (const [i, t] of slice.entries()) {
            const n = safePage * perPage + i + 1;

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    [
                        `## ${pnlEmoji(t.pnl)} #${n} · ${t.symbol} · ${t.direction} · x${t.size}`,
                        `**Entry:** ${discordTimestamp(t.entryTime, 'f')} (${discordTimestamp(t.entryTime, 'R')}) @ \`${formatPrice(t.entryPrice)}\``,
                        `**Exit:** ${discordTimestamp(t.exitTime, 'f')} (${discordTimestamp(t.exitTime, 'R')}) @ \`${formatPrice(t.exitPrice)}\``,
                        `**Duration:** \`${formatDuration(t.durationMs)}\``,
                        `**PnL:** \`${formatMoney(t.pnl)}\``,
                        `**Fees:** \`${formatMoneyNegative(t.fees)}\``,
                        `**Close Trade ID:** \`${t.closeTradeId}\``,
                        `**Order ID:** \`${t.closeOrderId}\``,
                    ].join('\n')
                )
            );

            if (i < slice.length - 1) {
                container.addSeparatorComponents(new SeparatorBuilder());
            }
        }
    }

    container.addSeparatorComponents(new SeparatorBuilder());

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            '-# Built from ProjectX trade legs. Entry/exit rows are reconstructed FIFO from half-turn/open-close data.'
        )
    );

    return container;
}

function buildLatestTradesContainer(
    accountId: number,
    days: number,
    limit: number,
    roundTrips: RoundTripTrade[],
    openLotsRemaining: number
): ContainerBuilder {
    const slice = roundTrips.slice(0, limit);
    const totalPnl = roundTrips.reduce((sum, t) => sum + t.pnl, 0);
    const totalFees = roundTrips.reduce((sum, t) => sum + t.fees, 0);
    const wins = roundTrips.filter(t => t.pnl > 0).length;
    const losses = roundTrips.filter(t => t.pnl < 0).length;
    const latest = slice[0] ?? null;

    const container = new ContainerBuilder().setAccentColor(pnlAccentColor(latest?.pnl ?? 0));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            [
                '# 📈 Latest Trades',
                `**Account:** \`${accountId}\``,
                `**Window:** \`${days} day(s)\``,
                `**Shown:** \`${slice.length}/${roundTrips.length}\``,
                `**Open Lots:** \`${openLotsRemaining}\``,
                `**Latest Symbol:** \`${latest?.symbol ?? 'n/a'}\``,
                `**Latest Direction:** \`${latest?.direction ?? 'n/a'}\``,
                `**Latest PnL:** \`${latest ? formatMoney(latest.pnl) : 'n/a'}\``,
                `**Total PnL:** \`${formatMoney(totalPnl)}\``,
                `**Total Fees:** \`${formatMoneyNegative(totalFees)}\``,
                `**Wins / Losses:** \`${wins} / ${losses}\``,
            ].join('\n')
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder());

    if (slice.length === 0) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                'No completed round-trip trades were reconstructed for this window.'
            )
        );
    } else {
        for (const [i, t] of slice.entries()) {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    [
                        `## ${pnlEmoji(t.pnl)} ${i + 1}. ${t.symbol} · ${t.direction} · x${t.size}`,
                        `**Entry:** ${discordTimestamp(t.entryTime, 'f')} @ \`${formatPrice(t.entryPrice)}\``,
                        `**Exit:** ${discordTimestamp(t.exitTime, 'f')} @ \`${formatPrice(t.exitPrice)}\``,
                        `**Duration:** \`${formatDuration(t.durationMs)}\``,
                        `**PnL:** \`${formatMoney(t.pnl)}\``,
                        `**Fees:** \`${formatMoneyNegative(t.fees)}\``,
                        `**Close Trade ID:** \`${t.closeTradeId}\``,
                        `**Order ID:** \`${t.closeOrderId}\``,
                    ].join('\n')
                )
            );

            if (i < slice.length - 1) {
                container.addSeparatorComponents(new SeparatorBuilder());
            }
        }
    }

    return container;
}

function buildTradeUpdateContainer(
    accountId: number,
    trade: RoundTripTrade,
    feedConfig: TradeFeedConfig
): ContainerBuilder {
    const flavorMessage = pickTradeMessage(trade);

    const container = new ContainerBuilder().setAccentColor(pnlAccentColor(trade.pnl));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            [
                `# ${pnlEmoji(trade.pnl)} New Closed Trade · ${trade.symbol}`,
                `**Direction:** \`${trade.direction}\``,
                `**Size:** \`x${trade.size}\``,
                `**Entry:** ${discordTimestamp(trade.entryTime, 'f')} (${discordTimestamp(trade.entryTime, 'R')}) @ \`${formatPrice(trade.entryPrice)}\``,
                `**Exit:** ${discordTimestamp(trade.exitTime, 'f')} (${discordTimestamp(trade.exitTime, 'R')}) @ \`${formatPrice(trade.exitPrice)}\``,
                `**Duration:** \`${formatDuration(trade.durationMs)}\``,
            ].join('\n')
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder());

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            [
                `**PnL:** \`${formatMoney(trade.pnl)}\``,
                `**Fees:** \`${formatMoneyNegative(trade.fees)}\``,
                `**Account:** \`${accountId}\``,
                `**Close Trade ID:** \`${trade.closeTradeId}\``,
                `**Order ID:** \`${trade.closeOrderId}\``,
                `**Polling:** \`${Math.round(feedConfig.intervalMs / 1000)}s\``,
                `**Lookback:** \`${feedConfig.days} day(s)\``,
                `**Started:** ${discordTimestamp(feedConfig.startedAtIso, 'f')} (${discordTimestamp(feedConfig.startedAtIso, 'R')})`,
            ].join('\n')
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder());

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`> **Stitch:** ${flavorMessage}`)
    );

    return container;
}

function buildTradesButtons(
    state: TradesViewState,
    totalRows: number
): ActionRowBuilder<ButtonBuilder> {
    const totalPages = Math.max(1, Math.ceil(totalRows / state.limit));
    const isFirst = state.page <= 0;
    const isLast = state.page >= totalPages - 1;

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(
                buildStateCustomId('trades_prev', {
                    ...state,
                    page: Math.max(0, state.page - 1),
                })
            )
            .setLabel('Prev')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(isFirst),
        new ButtonBuilder()
            .setCustomId(buildStateCustomId('trades_refresh', state))
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(
                buildStateCustomId('trades_next', {
                    ...state,
                    page: state.page + 1,
                })
            )
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(isLast)
    );
}

// --------------------------------------------------
// PAYLOAD BUILDERS
// --------------------------------------------------
async function buildTradesPayload(
    discordUserId: string,
    credentials: ProjectXUserCredentials,
    accountId: number,
    days: number,
    limit: number,
    page: number
): Promise<InteractionEditReplyOptions> {
    const trades = await searchTrades(discordUserId, credentials, accountId, days);
    const contractNames = await resolveContractNames(
        discordUserId,
        credentials,
        trades.map(t => t.contractId)
    );
    const { roundTrips, openLotsRemaining } = reconstructRoundTrips(trades, contractNames);

    const totalPages = Math.max(1, Math.ceil(roundTrips.length / limit));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const slice = roundTrips.slice(safePage * limit, safePage * limit + limit);

    const container = buildTradesContainer(
        accountId,
        days,
        safePage,
        limit,
        roundTrips,
        openLotsRemaining
    );

    const buttons = buildTradesButtons(
        { accountId, days, limit, page: safePage },
        roundTrips.length
    );

    container.addActionRowComponents(buttons);

    const chartBundles = await Promise.all(
        slice.map((trade, idx) =>
            buildTradeChartAttachment(
                discordUserId,
                credentials,
                trade,
                `page${safePage + 1}_${idx + 1}`
            )
        )
    );

    const validBundles = chartBundles.filter((x): x is ChartBundle => x !== null);
    const gallery = buildChartGallery(validBundles);

    return {
        flags: MessageFlags.IsComponentsV2 as InteractionEditReplyOptions['flags'],
        components: gallery ? [container, gallery] : [container],
        files: validBundles.map(x => x.attachment),
    };
}

async function buildLatestTradesPayload(
    discordUserId: string,
    credentials: ProjectXUserCredentials,
    accountId: number,
    days: number,
    limit: number
): Promise<InteractionEditReplyOptions> {
    const trades = await searchTrades(discordUserId, credentials, accountId, days);
    const contractNames = await resolveContractNames(
        discordUserId,
        credentials,
        trades.map(t => t.contractId)
    );
    const { roundTrips, openLotsRemaining } = reconstructRoundTrips(trades, contractNames);
    const slice = roundTrips.slice(0, limit);

    const container = buildLatestTradesContainer(
        accountId,
        days,
        limit,
        roundTrips,
        openLotsRemaining
    );

    const chartBundles = await Promise.all(
        slice.map((trade, idx) =>
            buildTradeChartAttachment(discordUserId, credentials, trade, `latest_${idx + 1}`)
        )
    );

    const validBundles = chartBundles.filter((x): x is ChartBundle => x !== null);
    const gallery = buildChartGallery(validBundles);

    return {
        flags: MessageFlags.IsComponentsV2 as InteractionEditReplyOptions['flags'],
        components: gallery ? [container, gallery] : [container],
        files: validBundles.map(x => x.attachment),
    };
}

// --------------------------------------------------
// FEED HELPERS
// --------------------------------------------------

async function loadRoundTripsForRange(
    discordUserId: string,
    credentials: ProjectXUserCredentials,
    accountId: number,
    startIso: string,
    endIso: string
): Promise<RoundTripTrade[]> {
    const trades = await searchTradesByRange(
        discordUserId,
        credentials,
        accountId,
        startIso,
        endIso
    );
    const contractNames = await resolveContractNames(
        discordUserId,
        credentials,
        trades.map(t => t.contractId)
    );
    const { roundTrips } = reconstructRoundTrips(trades, contractNames);
    return roundTrips;
}

async function loadRoundTripsForFeed(
    discordUserId: string,
    credentials: ProjectXUserCredentials,
    accountId: number,
    days: number
): Promise<RoundTripTrade[]> {
    const trades = await searchTrades(discordUserId, credentials, accountId, days);
    const contractNames = await resolveContractNames(
        discordUserId,
        credentials,
        trades.map(t => t.contractId)
    );
    const { roundTrips } = reconstructRoundTrips(trades, contractNames);
    return roundTrips;
}

async function pollTradeFeed(channelId: string): Promise<void> {
    const runtime = tradeFeeds.get(channelId);
    if (!runtime || runtime.isRunning) return;

    runtime.isRunning = true;

    try {
        const channel = await client.channels.fetch(channelId);

        if (!isSendableGuildChannel(channel)) {
            throw new Error('Configured channel is not a sendable guild text/thread channel.');
        }

        const credentials = getCredentialsForDiscordUser(runtime.config.ownerDiscordUserId);
        if (!credentials) {
            throw new Error('No saved ProjectX credentials exist for the feed owner.');
        }

        const roundTrips = await loadRoundTripsForFeed(
            runtime.config.ownerDiscordUserId,
            credentials,
            runtime.config.accountId,
            runtime.config.days
        );

        const newestTrade = roundTrips[0] ?? null;

        if (!runtime.config.lastSeenExitTimeIso && newestTrade) {
            runtime.config.lastSeenCloseTradeId = newestTrade.closeTradeId;
            runtime.config.lastSeenExitTimeIso = newestTrade.exitTime;
            runtime.config.lastSuccessIso = new Date().toISOString();
            runtime.config.lastError = null;
            saveTradeFeedConfig(runtime.config);
            return;
        }

        const newTrades = roundTrips
            .filter(t =>
                isRoundTripAfterCheckpoint(
                    t,
                    runtime.config.lastSeenCloseTradeId,
                    runtime.config.lastSeenExitTimeIso
                )
            )
            .sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime());

        for (const trade of newTrades) {
            const container = buildTradeUpdateContainer(
                runtime.config.accountId,
                trade,
                runtime.config
            );

            const chart = await buildTradeChartAttachment(
                runtime.config.ownerDiscordUserId,
                credentials,
                trade,
                'feed'
            );

            const components: Array<ContainerBuilder | MediaGalleryBuilder> = [container];

            if (chart) {
                const gallery = buildChartGallery([chart]);
                if (gallery) components.push(gallery);
            }

            await channel.send({
                flags: MessageFlags.IsComponentsV2,
                components,
                files: chart ? [chart.attachment] : [],
            });
        }

        if (newestTrade) {
            runtime.config.lastSeenCloseTradeId = newestTrade.closeTradeId;
            runtime.config.lastSeenExitTimeIso = newestTrade.exitTime;
        }

        runtime.config.lastSuccessIso = new Date().toISOString();
        runtime.config.lastError = null;
        saveTradeFeedConfig(runtime.config);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown feed polling error';
        runtime.config.lastError = message;
        saveTradeFeedConfig(runtime.config);
        console.error(`[tradefeed:${channelId}]`, error);
    } finally {
        runtime.isRunning = false;
    }
}

function startTradeFeed(config: TradeFeedConfig): void {
    const existing = tradeFeeds.get(config.channelId);
    if (existing) {
        clearInterval(existing.timer);
        tradeFeeds.delete(config.channelId);
    }

    saveTradeFeedConfig(config);

    const runtime: TradeFeedRuntime = {
        config,
        timer: setInterval(() => {
            void pollTradeFeed(config.channelId);
        }, config.intervalMs),
        isRunning: false,
    };

    tradeFeeds.set(config.channelId, runtime);
}

function stopTradeFeed(channelId: string): boolean {
    const existing = tradeFeeds.get(channelId);

    if (!existing) {
        removeTradeFeedConfig(channelId);
        return false;
    }

    clearInterval(existing.timer);
    tradeFeeds.delete(channelId);
    removeTradeFeedConfig(channelId);
    return true;
}

function restoreTradeFeedsFromDisk(): void {
    const store = readTradeFeedStore();

    for (const config of Object.values(store)) {
        startTradeFeed(config);
        void pollTradeFeed(config.channelId);
    }
}

// --------------------------------------------------
// COMMAND HELPERS
// --------------------------------------------------
async function requireUserCredentials(
    interaction: ChatInputCommandInteraction
): Promise<ProjectXUserCredentials> {
    const credentials = getCredentialsForDiscordUser(interaction.user.id);

    if (!credentials) {
        throw new Error(
            'No ProjectX credentials are saved for your Discord account. Use /projectx-login first.'
        );
    }

    return credentials;
}

async function handleAccountIdAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const savedAccounts = getSavedAccountsForDiscordUser(interaction.user.id);

    if (!savedAccounts.length) {
        await interaction.respond([
            {
                name: 'Run /accounts first to cache your ProjectX accounts',
                value: 0,
            },
        ]);
        return;
    }

    const focused = interaction.options.getFocused(true);
    const focusedValue = String(focused.value ?? '')
        .trim()
        .toLowerCase();

    const filtered = savedAccounts
        .filter(account => {
            if (!focusedValue) return true;

            return (
                String(account.id).includes(focusedValue) ||
                account.name.toLowerCase().includes(focusedValue)
            );
        })
        .slice(0, 25)
        .map(account => ({
            name: `${account.name} (${account.id})${account.canTrade ? '' : ' [read-only]'}`,
            value: account.id,
        }));

    await interaction.respond(
        filtered.length
            ? filtered
            : [
                  {
                      name: 'No saved matching accounts found. Run /accounts again.',
                      value: 0,
                  },
              ]
    );
}

// --------------------------------------------------
// COMMAND HANDLERS
// --------------------------------------------------
async function handleHelpCommand(interaction: ChatInputCommandInteraction) {
    const embed = new EmbedBuilder()
        .setTitle('📊 Stitch Bot Help')
        .setDescription('ProjectX trading tools and analytics.')
        .addFields(
            {
                name: '🔐 Account',
                value:
                    '`/projectx-login` - Save your ProjectX credentials\n' +
                    '`/projectx-logout` - Remove saved credentials\n' +
                    '`/accounts` - View your ProjectX accounts',
            },
            {
                name: '📈 Trading',
                value:
                    '`/trades` - View reconstructed trades with charts\n' +
                    '`/latesttrades` - Show your most recent trades\n' +
                    '`/futures` - Summarize futures contract performance by account',
            },
            {
                name: '🧠 Analysis',
                value:
                    '`/analysis` - Full trade breakdown (win rate + duration stats + charts)\n' +
                    '`/monthly` - Monthly P/L calendar overview',
            },
            {
                name: '📡 Live Feed',
                value:
                    '`/tradefeed-start` - Start live trade feed\n' +
                    '`/tradefeed-stop` - Stop trade feed\n' +
                    '`/tradefeed-status` - View feed status',
            }
        )
        .setTimestamp(new Date());

    await interaction.reply({ embeds: [embed] });
}

async function handleProjectXLoginCommand(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const username = interaction.options.getString('username', true).trim();
    const apiKey = interaction.options.getString('api_key', true).trim();

    await getProjectXToken(interaction.user.id, { username, apiKey }, true);
    setCredentialsForDiscordUser(interaction.user.id, { username, apiKey });

    await interaction.editReply(`✅ Your ProjectX credentials were verified and saved to this bot.

⚠️ **Security Notice**

This bot is primarily intended for single-user use.

While multiple users are supported, storing API keys for others introduces security risks. API keys may be exposed if the bot, hosting environment, or storage files are compromised.

By using this command, you acknowledge:

- Your API key is stored by this bot for functionality
- The developer is not responsible for any leaked, exposed, corrupted, invalid, or "scrambled" API keys
- You should never share your API key with others
- You are responsible for securing your own credentials and hosting environment

If you believe your API key has been compromised or is no longer working properly, regenerate it immediately from the ProjectX dashboard.

Use at your own risk.`);
}

async function handleProjectXLogoutCommand(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const removed = removeCredentialsForDiscordUser(interaction.user.id);
    cachedTokens.delete(interaction.user.id);

    await interaction.editReply(
        removed
            ? '🗑️ Your saved ProjectX credentials were removed.'
            : 'No saved ProjectX credentials were found for your Discord ID.'
    );
}

async function handleAccountsCommand(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const credentials = await requireUserCredentials(interaction);
    const accounts = await searchAccounts(interaction.user.id, credentials);
    saveAccountsForDiscordUser(interaction.user.id, accounts);

    if (!accounts.length) {
        await interaction.editReply('No visible ProjectX accounts were found.');
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle('ProjectX Accounts')
        .setDescription(
            accounts
                .map(
                    a =>
                        `**${a.name}**\nID: \`${a.id}\`\nCan trade: \`${a.canTrade !== false}\`\nBalance: \`${a.balance ?? 'n/a'}\``
                )
                .join('\n\n')
        )
        .setFooter({
            text: 'ProjectX accounts snapshot',
        })
        .setTimestamp(new Date());

    await interaction.editReply({ embeds: [embed] });
}

async function handleTradesCommand(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const days = clamp(interaction.options.getInteger('days') ?? 1, 1, 30);
    const limit = clamp(interaction.options.getInteger('limit') ?? 5, 1, 10);
    const credentials = await requireUserCredentials(interaction);

    const accountId =
        interaction.options.getInteger('account_id') ??
        (await getDefaultAccountId(interaction.user.id, credentials));

    const payload = await buildTradesPayload(
        interaction.user.id,
        credentials,
        accountId,
        days,
        limit,
        0
    );

    await interaction.editReply(payload);
}

async function handleLatestTradesCommand(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const days = clamp(interaction.options.getInteger('days') ?? 1, 1, 30);
    const limit = clamp(interaction.options.getInteger('limit') ?? 5, 1, 15);
    const credentials = await requireUserCredentials(interaction);

    const accountId =
        interaction.options.getInteger('account_id') ??
        (await getDefaultAccountId(interaction.user.id, credentials));

    const payload = await buildLatestTradesPayload(
        interaction.user.id,
        credentials,
        accountId,
        days,
        limit
    );

    await interaction.editReply(payload);
}

async function handleFuturesCommand(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const days = clamp(interaction.options.getInteger('days') ?? 7, 1, 30);
    const limit = clamp(interaction.options.getInteger('limit') ?? 10, 1, 25);
    const credentials = await requireUserCredentials(interaction);

    const accountId =
        interaction.options.getInteger('account_id') ??
        (await getDefaultAccountId(interaction.user.id, credentials));

    const payload = await buildFuturesPayload(
        interaction.user.id,
        credentials,
        accountId,
        days,
        limit
    );

    await interaction.editReply(payload);
}

async function handleAnalysisCommand(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const credentials = await requireUserCredentials(interaction);
    const startDate = interaction.options.getString('start_date', true);
    const endDate = interaction.options.getString('end_date', true);
    const range = buildDateRangeInput(startDate, endDate);

    const accountId =
        interaction.options.getInteger('account_id') ??
        (await getDefaultAccountId(interaction.user.id, credentials));

    const allRoundTrips = await loadRoundTripsForRange(
        interaction.user.id,
        credentials,
        accountId,
        range.fetchStartIso,
        range.fetchEndIso
    );
    const roundTrips = filterRoundTripsForTradingDayRange(
        allRoundTrips,
        range.startTradingDayKey,
        range.endTradingDayKey
    );

    if (!roundTrips.length) {
        await interaction.editReply(
            `No completed round-trip trades were found for account ${accountId} between ${range.startLabel} and ${range.endLabel}.`
        );
        return;
    }

    const attachment = buildAnalysisAttachment(roundTrips, accountId, range);
    const overviewAttachment = buildAnalysisOverviewAttachment(roundTrips, accountId, range);

    await interaction.editReply({
        content: `Trade duration analysis for account \`${accountId}\` from \`${range.startLabel}\` to \`${range.endLabel}\`.`,
        files: [attachment, overviewAttachment],
    });
}

async function handleMonthlyCommand(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const credentials = await requireUserCredentials(interaction);
    const now = new Date();
    const month = clamp(interaction.options.getInteger('month') ?? now.getMonth() + 1, 1, 12);
    const year = clamp(interaction.options.getInteger('year') ?? now.getFullYear(), 2020, 2100);

    const accountId =
        interaction.options.getInteger('account_id') ??
        (await getDefaultAccountId(interaction.user.id, credentials));

    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    start.setUTCDate(start.getUTCDate() - 3);

    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    end.setUTCDate(end.getUTCDate() + 3);

    const trades = await searchTradesByRange(
        interaction.user.id,
        credentials,
        accountId,
        start.toISOString(),
        end.toISOString()
    );

    const contractNames = await resolveContractNames(
        interaction.user.id,
        credentials,
        trades.map(trade => trade.contractId)
    );
    const { roundTrips } = reconstructRoundTrips(trades, contractNames);
    const monthlyRoundTrips = filterRoundTripsForMonth(roundTrips, year, month);
    const attachment = buildMonthlyAttachment(monthlyRoundTrips, accountId, year, month);

    await interaction.editReply({
        content: `Monthly P/L calendar for account \`${accountId}\` for \`${formatMonthYear(year, month)}\`.`,
        files: [attachment],
    });
}

async function handleTradeFeedStartCommand(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const days = clamp(interaction.options.getInteger('days') ?? 1, 1, 30);
    const limit = clamp(interaction.options.getInteger('limit') ?? 5, 1, 15);
    const intervalSeconds = clamp(
        interaction.options.getInteger('interval_seconds') ?? 30,
        10,
        300
    );

    const credentials = await requireUserCredentials(interaction);

    const accountId =
        interaction.options.getInteger('account_id') ??
        (await getDefaultAccountId(interaction.user.id, credentials));

    const existing = tradeFeeds.get(interaction.channelId);

    const config: TradeFeedConfig = {
        channelId: interaction.channelId,
        ownerDiscordUserId: interaction.user.id,
        accountId,
        days,
        limit,
        intervalMs: intervalSeconds * 1000,
        startedByUserId: interaction.user.id,
        startedAtIso: existing?.config.startedAtIso ?? new Date().toISOString(),
        lastSuccessIso: existing?.config.lastSuccessIso ?? null,
        lastError: existing?.config.lastError ?? null,
        lastSeenCloseTradeId: existing?.config.lastSeenCloseTradeId ?? null,
        lastSeenExitTimeIso: existing?.config.lastSeenExitTimeIso ?? null,
    };

    startTradeFeed(config);
    await pollTradeFeed(interaction.channelId);

    await interaction.editReply(
        [
            '✅ Trade feed started in this channel.',
            `Account: \`${accountId}\``,
            `Days: \`${days}\``,
            `Recent-trades limit for manual views: \`${limit}\``,
            `Poll interval: \`${intervalSeconds}s\``,
            `Started: ${discordTimestamp(config.startedAtIso, 'f')} (${discordTimestamp(config.startedAtIso, 'R')})`,
            'Active pollers are persisted and restored after bot restart.',
            'Newly closed trades will now be posted here.',
        ].join('\n')
    );
}

async function handleTradeFeedStopCommand(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const stopped = stopTradeFeed(interaction.channelId);

    await interaction.editReply(
        stopped
            ? '🛑 Trade feed stopped for this channel.'
            : 'No active trade feed exists in this channel.'
    );
}

async function handleTradeFeedStatusCommand(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const runtime = tradeFeeds.get(interaction.channelId);

    if (!runtime) {
        await interaction.editReply('No active trade feed exists in this channel.');
        return;
    }

    const c = runtime.config;

    await interaction.editReply(
        [
            '📡 Trade feed is active in this channel.',
            `Owner Discord ID: \`${c.ownerDiscordUserId}\``,
            `Account: \`${c.accountId}\``,
            `Days: \`${c.days}\``,
            `Recent-trades limit for manual views: \`${c.limit}\``,
            `Poll interval: \`${Math.round(c.intervalMs / 1000)}s\``,
            `Started: ${discordTimestamp(c.startedAtIso, 'f')} (${discordTimestamp(c.startedAtIso, 'R')})`,
            `Last success: ${c.lastSuccessIso ? `${discordTimestamp(c.lastSuccessIso, 'f')} (${discordTimestamp(c.lastSuccessIso, 'R')})` : '`never`'}`,
            `Last error: \`${c.lastError ?? 'none'}\``,
            `Last seen close trade ID: \`${c.lastSeenCloseTradeId ?? 'none'}\``,
            `Last seen exit time: ${c.lastSeenExitTimeIso ? `${discordTimestamp(c.lastSeenExitTimeIso, 'f')} (${discordTimestamp(c.lastSeenExitTimeIso, 'R')})` : '`none`'}`,
        ].join('\n')
    );
}

// --------------------------------------------------
// INTERACTIONS
// --------------------------------------------------
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
        if (interaction.isAutocomplete()) {
            const accountCommands = new Set([
                'trades',
                'latesttrades',
                'tradefeed-start',
                'analysis',
                'monthly',
            ]);

            if (
                accountCommands.has(interaction.commandName) &&
                interaction.options.getFocused(true).name === 'account_id'
            ) {
                await handleAccountIdAutocomplete(interaction);
                return;
            }
        }

        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'help') {
                await handleHelpCommand(interaction);
                return;
            }

            if (interaction.commandName === 'projectx-login') {
                await handleProjectXLoginCommand(interaction);
                return;
            }

            if (interaction.commandName === 'projectx-logout') {
                await handleProjectXLogoutCommand(interaction);
                return;
            }

            if (interaction.commandName === 'accounts') {
                await handleAccountsCommand(interaction);
                return;
            }

            if (interaction.commandName === 'trades') {
                await handleTradesCommand(interaction);
                return;
            }

            if (interaction.commandName === 'latesttrades') {
                await handleLatestTradesCommand(interaction);
                return;
            }

            if (interaction.commandName === 'futures') {
                await handleFuturesCommand(interaction);
                return;
            }

            if (interaction.commandName === 'analysis') {
                await handleAnalysisCommand(interaction);
                return;
            }

            if (interaction.commandName === 'monthly') {
                await handleMonthlyCommand(interaction);
                return;
            }

            if (interaction.commandName === 'tradefeed-start') {
                await handleTradeFeedStartCommand(interaction);
                return;
            }

            if (interaction.commandName === 'tradefeed-stop') {
                await handleTradeFeedStopCommand(interaction);
                return;
            }

            if (interaction.commandName === 'tradefeed-status') {
                await handleTradeFeedStatusCommand(interaction);
                return;
            }
        }

        if (interaction.isButton()) {
            const isTradesButton =
                interaction.customId.startsWith('trades_prev|') ||
                interaction.customId.startsWith('trades_next|') ||
                interaction.customId.startsWith('trades_refresh|');

            if (!isTradesButton) return;

            const state = parseStateCustomId(interaction.customId);
            if (!state) {
                await interaction.reply({
                    content: 'Invalid pagination state.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const credentials = getCredentialsForDiscordUser(interaction.user.id);
            if (!credentials) {
                await interaction.reply({
                    content:
                        'No ProjectX credentials are saved for your Discord account. Use /projectx-login first.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            await interaction.deferUpdate();

            const payload = await buildTradesPayload(
                interaction.user.id,
                credentials,
                state.accountId,
                state.days,
                state.limit,
                state.page
            );

            await interaction.editReply(payload);
        }
    } catch (error) {
        console.error(error);

        const message = error instanceof Error ? error.message : 'An unknown error occurred.';

        if (interaction.isRepliable()) {
            if (interaction.deferred || interaction.replied) {
                const isV2Interaction =
                    (interaction.isChatInputCommand() &&
                        (interaction.commandName === 'trades' ||
                            interaction.commandName === 'latesttrades')) ||
                    (interaction.isButton() &&
                        (interaction.customId.startsWith('trades_prev|') ||
                            interaction.customId.startsWith('trades_next|') ||
                            interaction.customId.startsWith('trades_refresh|')));

                if (isV2Interaction) {
                    await interaction
                        .editReply({
                            components: [
                                new ContainerBuilder()
                                    .setAccentColor(0xef4444)
                                    .addTextDisplayComponents(
                                        new TextDisplayBuilder().setContent(
                                            `## ❌ Error\n${message}`
                                        )
                                    ),
                            ],
                            files: [],
                            flags: MessageFlags.IsComponentsV2 as InteractionEditReplyOptions['flags'],
                        })
                        .catch(async () => {
                            try {
                                await interaction.followUp({
                                    content: `❌ ${message}`,
                                    flags: MessageFlags.Ephemeral,
                                });
                            } catch {
                                return null;
                            }
                        });
                } else {
                    await interaction
                        .editReply({
                            content: `❌ ${message}`,
                            embeds: [],
                            components: [],
                        })
                        .catch(() => null);
                }
            } else {
                await interaction
                    .reply({
                        content: `❌ ${message}`,
                        flags: MessageFlags.Ephemeral,
                    })
                    .catch(() => null);
            }
        }
    }
});

// --------------------------------------------------
// READY
// --------------------------------------------------
client.once(Events.ClientReady, c => {
    console.log(`Logged in as ${c.user.tag}`);
    ensureCredentialStoreFile();
    ensureAccountStoreFile();
    ensureTradeFeedStoreFile();
    restoreTradeFeedsFromDisk();
    console.log('✅ successfully finished startup');
});

// --------------------------------------------------
// LOGIN
// --------------------------------------------------
client.login(DISCORD_TOKEN).catch(err => {
    console.error('Discord login failed:', err);
    process.exit(1);
});
