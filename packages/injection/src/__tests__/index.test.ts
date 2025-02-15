import { initConfig } from '../';

const data = {
	AMQP_URL: 'amqp://example',
	ROOT_DOMAIN: 'example.com',
	DASH_DOMAIN: 'dash.example.com',
	GHOST_DOMAIN: 'ghost.example.com',
	DISCORD_CLIENT_ID: '123',
	DEV_IDS: '123,456',
	INTERACTIONS_TEST_GUILDS: '123',
	DISCORD_CLIENT_SECRET: '456',
	DISCORD_TOKEN: 'abc',
	DISCORD_PUB_KEY: 'h',
	DISCORD_SCOPES: 'a,b',
	DB_URL: 'postgres://something',
	REDIS_URL: 'redis://something',
	ENCRYPTION_KEY: 'awooga',
	NSFW_PREDICT_API_KEY: 'lol',
	GHOST_INTEGRATION_KEY: 'lol',
	DISCORD_PROXY_URL: 'https://proxy.example.com',
} as const;

for (const key of Object.keys(data) as (keyof typeof data)[]) {
	process.env[key] = data[key];
}

test('test', () => {
	const config = initConfig();

	expect(config).toStrictEqual({
		amqpUrl: data.AMQP_URL,
		rootDomain: data.ROOT_DOMAIN,
		dashDomain: data.DASH_DOMAIN,
		ghostDomain: data.GHOST_DOMAIN,
		discordClientId: data.DISCORD_CLIENT_ID,
		devIds: ['123', '456'],
		interactionsTestGuilds: [data.INTERACTIONS_TEST_GUILDS],
		discordClientSecret: data.DISCORD_CLIENT_SECRET,
		discordToken: data.DISCORD_TOKEN,
		discordPubKey: data.DISCORD_PUB_KEY,
		discordScopes: 'a b',
		dbUrl: data.DB_URL,
		redisUrl: data.REDIS_URL,
		nodeEnv: 'test',
		encryptionKey: data.ENCRYPTION_KEY,
		cors: '*',
		nsfwPredictApiKey: data.NSFW_PREDICT_API_KEY,
		ghostIntegrationKey: data.GHOST_INTEGRATION_KEY,
		discordProxyUrl: data.DISCORD_PROXY_URL,
	});
});
