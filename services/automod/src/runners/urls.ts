import { readFileSync } from 'fs';
import { join as joinPath } from 'path';
import { Log, Runners, UrlsRunnerResult } from '@automoderator/broker-types';
import { MessageCache } from '@automoderator/cache';
import { kLogger } from '@automoderator/injection';
import { dmUser } from '@automoderator/util';
import { PubSubPublisher } from '@cordis/brokers';
import { Rest } from '@cordis/rest';
import { PrismaClient } from '@prisma/client';
import { Routes, GatewayMessageCreateDispatchData } from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';
import type { IRunner } from './IRunner';

interface UrlsTransform {
	urls: string[];
	use: boolean;
}

@singleton()
export class UrlsRunner implements IRunner<UrlsTransform, UrlsTransform, UrlsRunnerResult> {
	public readonly ignore = 'urls';

	public readonly urlRegex = /https?:\/\/(?<url>([^\.\s\/]+\.)+(?<tld>[^\.\s\/]+)(?<path>\/[^\s]*)?)/gm;
	public readonly tlds: Set<string>;

	public constructor(
		@inject(kLogger) public readonly logger: Logger,
		public readonly prisma: PrismaClient,
		public readonly messages: MessageCache,
		public readonly discord: Rest,
		public readonly logs: PubSubPublisher<Log>,
	) {
		const contents = readFileSync(joinPath(__dirname, '..', '..', 'tlds.txt'), 'utf8');
		this.tlds = contents.split('\n').reduce((acc, line) => {
			if (!line.startsWith('#') && line.length) {
				acc.add(line.toLowerCase());
			}

			return acc;
		}, new Set<string>());
	}

	private extractRoot(url: string): string {
		const split = url.split('.');
		// This means that we've got at least 1 subdomain - there could be more nested
		if (split.length > 2) {
			// Extract the root domain
			return split.slice(split.length - 2, split.length).join('.');
		}

		return url;
	}

	private cleanDomain(url: string) {
		url = url.replace(/https?:\/\//g, '');

		if (url.includes('/')) {
			// Assume that the URL is formatted correctly. Extract the domain (including the subdomain)
			const fullDomain = url.split('/')[0]!;
			return this.extractRoot(fullDomain);
		}

		return this.extractRoot(url);
	}

	public async transform(message: GatewayMessageCreateDispatchData): Promise<UrlsTransform> {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: message.guild_id } });

		const urls = [...message.content.matchAll(this.urlRegex)].reduce<Set<string>>((acc, match) => {
			if (this.tlds.has(match.groups!.tld!.toLowerCase())) {
				acc.add(this.cleanDomain(match.groups!.url!));
			}

			return acc;
		}, new Set());

		return {
			urls: [...urls.values()],
			use: settings?.useUrlFilters ?? false,
		};
	}

	public check({ use, urls }: UrlsTransform): boolean {
		return use && urls.length > 0;
	}

	public async run(
		{ use, urls }: UrlsTransform,
		message: GatewayMessageCreateDispatchData,
	): Promise<UrlsTransform | null> {
		const allowedUrls = await this.prisma.allowedUrl.findMany({ where: { guildId: message.guild_id } });
		const allowed = new Set(allowedUrls.map((url) => this.cleanDomain(url.domain)));

		const forbidden = [...urls.values()].filter((url) => !allowed.has(url));

		if (!forbidden.length) {
			return null;
		}

		return { use, urls: forbidden };
	}

	public async cleanup(_: UrlsTransform, message: GatewayMessageCreateDispatchData): Promise<void> {
		await this.discord
			.delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'URL filter trigger' })
			.then(() => dmUser(message.author.id, 'Your message was deleted due to containing a link.'))
			.catch(() => null);
	}

	public log({ urls }: UrlsTransform): UrlsRunnerResult {
		return { runner: Runners.urls, data: urls };
	}
}
