import 'reflect-metadata';
import { Rest } from '@chatsift/api-wrapper';
import { initConfig, kLogger, kRedis } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { ProxyBucket, Rest as DiscordRest } from '@cordis/rest';
import type { Logger } from 'pino';
import { container } from 'tsyringe';
import { Handler } from './handler';
import { PrismaClient } from '@prisma/client';
import Redis, { Redis as IORedis } from 'ioredis';

void (() => {
	const config = initConfig();
	container.register(Rest, { useValue: new Rest(config.apiDomain, config.internalApiToken) });

	const logger = createLogger('scheduler');

	const discordRest = new DiscordRest(config.discordToken, {
		bucket: ProxyBucket,
		domain: config.discordProxyUrl,
		retries: 1,
		abortAfter: 20e3,
	}).on('abort', (req) => {
		logger.warn({ req }, `Aborted request ${req.method!} ${req.path!}`);
	});

	container.register(DiscordRest, { useValue: discordRest });
	container.register<IORedis>(kRedis, { useValue: new Redis(config.redisUrl) });
	container.register<Logger>(kLogger, { useValue: logger });
	container.register(PrismaClient, { useValue: new PrismaClient() });

	container.resolve(Handler).init();
	logger.info('Ready to process scheduled tasks');
})();
