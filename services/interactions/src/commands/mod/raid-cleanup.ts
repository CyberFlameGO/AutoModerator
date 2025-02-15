import type { DiscordEvents } from '@automoderator/broker-types';
import { kLogger } from '@automoderator/injection';
import { CaseManager } from '@automoderator/util';
import { PubSubPublisher, RoutingSubscriber } from '@cordis/brokers';
import { Rest } from '@cordis/rest';
import { getCreationData } from '@cordis/util';
import ms from '@naval-base/ms';
import { CaseAction } from '@prisma/client';
import type { APIMessageComponentInteraction, RESTGetAPIGuildQuery } from 'discord-api-types/v9';
import {
	APIGuild,
	APIGuildInteraction,
	APIGuildMember,
	GatewaySendPayload,
	GatewayGuildMembersChunkDispatchData,
	GatewayDispatchEvents,
	GatewayOpcodes,
	InteractionResponseType,
	Snowflake,
	ComponentType,
	ButtonStyle,
	Routes,
} from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import type { Logger } from 'pino';
import { inject, injectable } from 'tsyringe';
import type { Command } from '../../command';
import { Handler, CollectorTimeoutError } from '../../handler';
import type { RaidCleanupCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, kGatewayBroadcasts, send } from '#util';

interface RaidCleanupMember {
	id: Snowflake;
	tag: string;
}

@injectable()
export default class implements Command {
	public constructor(
		public readonly gateway: RoutingSubscriber<keyof DiscordEvents, DiscordEvents>,
		@inject(kGatewayBroadcasts) public readonly gatewayBroadcaster: PubSubPublisher<GatewaySendPayload>,
		@inject(kLogger) public readonly logger: Logger,
		public readonly handler: Handler,
		public readonly cases: CaseManager,
		public readonly rest: Rest,
	) {}

	private async _fetchGuildMembers(interaction: APIGuildInteraction): Promise<APIGuildMember[]> {
		const guild = await this.rest.get<APIGuild, RESTGetAPIGuildQuery>(Routes.guild(interaction.guild_id), {
			query: { with_counts: true },
		});

		return new Promise((resolve) => {
			const members: APIGuildMember[] = [];
			let index = 0;

			const interval = setInterval(() => {
				void send(interaction, {
					content: `Collecting all of your server members... This operation could take up to 2 minutes. ${
						members.length
					}/${guild.approximate_member_count!} members collected`,
				}).catch(() => null);
			}, ms('10s'));

			const timeout = setTimeout(() => {
				// eslint-disable-next-line @typescript-eslint/no-use-before-define
				this.gateway.off(GatewayDispatchEvents.GuildMembersChunk, handler);
				clearInterval(interval);
				resolve(members);
			}, ms('2m'));

			const handler = (chunk: GatewayGuildMembersChunkDispatchData) => {
				for (const member of chunk.members) {
					if (member.user) {
						members.push(member);
					}
				}

				if (++index === chunk.chunk_count || members.length >= guild.approximate_member_count!) {
					this.gateway.off(GatewayDispatchEvents.GuildMembersChunk, handler);
					clearTimeout(timeout);
					clearInterval(interval);
					return resolve(members);
				}
			};

			this.gateway.on(GatewayDispatchEvents.GuildMembersChunk, handler);
			this.gatewayBroadcaster.publish({
				op: GatewayOpcodes.RequestGuildMembers,
				d: {
					guild_id: interaction.guild_id,
					query: '',
					limit: 0,
				},
			});
		});
	}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof RaidCleanupCommand>) {
		await send(interaction, {}, InteractionResponseType.DeferredChannelMessageWithSource);

		const { join, age, name, 'avatar-hash': hash, ban = false } = args;

		if (join == null && age == null && name == null && hash == null) {
			throw new ControlFlowError('You must pass at least one of the given arguments (other than ban)');
		}

		let joinCutOff: number | undefined;
		if (join) {
			const joinMinutesAgo = Number(join);

			if (isNaN(joinMinutesAgo)) {
				const joinAgo = ms(join);
				if (joinAgo <= 0) {
					throw new ControlFlowError('Failed to parse the provided join time');
				}

				joinCutOff = Date.now() - joinAgo;
			} else {
				joinCutOff = Date.now() - joinMinutesAgo * 6e4;
			}
		}

		let ageCutOff: number | undefined;
		if (age) {
			const ageMinutesAgo = Number(age);

			if (isNaN(ageMinutesAgo)) {
				const ageAgo = ms(age);
				if (ageAgo <= 0) {
					throw new ControlFlowError('Failed to parse the provided age time');
				}

				ageCutOff = Date.now() - ageAgo;
			} else {
				ageCutOff = Date.now() - ageMinutesAgo * 6e4;
			}
		}

		await send(interaction, {
			content:
				'Collecting all of your server members... This operation could take up to 2 minutes. 0/? members collected',
		});

		const allMembers = await this._fetchGuildMembers(interaction);

		await send(interaction, { content: 'Selecting members that match your criteria...' });

		const members = allMembers.reduce<RaidCleanupMember[]>((acc, member) => {
			let meetsJoinCriteria = true;
			let meetsAgeCriteria = true;
			let meetsNameCriteria = true;
			let meetsHashCriteria = true;

			if (joinCutOff) {
				meetsJoinCriteria = new Date(member.joined_at).getTime() > joinCutOff;
			}

			if (ageCutOff) {
				const { createdTimestamp } = getCreationData(member.user!.id);
				meetsAgeCriteria = createdTimestamp > ageCutOff;
			}

			if (name) {
				meetsNameCriteria = member.user!.username.includes(name) || (member.nick?.includes(name) ?? false);
			}

			if (hash) {
				meetsHashCriteria = member.user!.avatar === hash;
			}

			if (meetsJoinCriteria && meetsAgeCriteria && meetsNameCriteria && meetsHashCriteria) {
				acc.push({ id: member.user!.id, tag: `${member.user!.username}#${member.user!.discriminator}` });
			}

			return acc;
		}, []);

		if (!members.length) {
			const joinInfo = joinCutOff ? `\nAccounts that joined ${ms(Date.now() - joinCutOff, true)} ago` : '';
			const ageInfo = ageCutOff ? `\nAccounts that were created ${ms(Date.now() - ageCutOff, true)} ago` : '';
			const nameInfo = name ? `\nAccounts with the name "${name}"` : '';
			const hashInfo = hash ? `\nAccounts with the avatar hash "${hash}"` : '';

			return send(interaction, {
				content: `There were no members that matched the given criteria. Searched for:${joinInfo}${ageInfo}${nameInfo}${hashInfo}`,
			});
		}

		const confirmId = nanoid();
		await send(interaction, {
			content: `Are you absolutely sure you want to nuke these ${members.length} users?`,
			files: [
				{
					name: 'target_complete.txt',
					content: Buffer.from(members.map((m) => `${m.tag} (${m.id})`).join('\n')),
				},
				{
					name: 'target_ids.txt',
					content: Buffer.from(members.map((m) => m.id).join('\n')),
				},
			],
			components: [
				{
					type: ComponentType.ActionRow,
					components: [
						{
							type: ComponentType.Button,
							label: 'Cancel',
							style: ButtonStyle.Secondary,
							custom_id: `${confirmId}|n`,
						},
						{
							type: ComponentType.Button,
							label: 'Confirm',
							style: ButtonStyle.Success,
							custom_id: `${confirmId}|y`,
						},
					],
				},
			],
		});

		try {
			const done = await this.handler.collectorManager
				.makeCollector<APIMessageComponentInteraction>(confirmId)
				.waitForOneAndDestroy(30000);

			const [, action] = done.data.custom_id.split('|') as [string, string];
			if (action === 'n') {
				return await send(
					interaction,
					{ content: 'Cancelled.' },
					InteractionResponseType.ChannelMessageWithSource,
					true,
				);
			}

			const promises: Promise<void>[] = [];
			const sweeped: Snowflake[] = [];
			const missed: Snowflake[] = [];

			let index = 0;

			for (const { id: targetId, tag: targetTag } of members) {
				promises.push(
					this.cases
						.create({
							actionType: ban ? CaseAction.ban : CaseAction.kick,
							guildId: interaction.guild_id,
							mod: {
								id: interaction.member.user.id,
								tag: `${interaction.member.user.username}#${interaction.member.user.discriminator}`,
							},
							targetId,
							targetTag,
							reason: `Raid cleanup (${++index}/${members.length})`,
							deleteDays: ban ? 1 : undefined,
						})
						.then(() => {
							sweeped.push(targetId);
						})
						.catch((error) => {
							this.logger.error(error, 'Failed to sweep member');
							missed.push(targetId);
						}),
				);
			}

			await Promise.allSettled(promises);

			const files: { name: string; content: Buffer }[] = [];
			if (sweeped.length) {
				files.push({
					name: 'sweeped.txt',
					content: Buffer.from(sweeped.map((x) => `${x}`).join('\n')),
				});
			}

			if (missed.length) {
				files.push({
					name: 'missed.txt',
					content: Buffer.from(missed.map((x) => `${x}`).join('\n')),
				});
			}

			return await send(
				interaction,
				{
					content: "Done cleaning up! Here's a summary",
					files,
				},
				InteractionResponseType.ChannelMessageWithSource,
				true,
			);
		} catch (error) {
			if (error instanceof CollectorTimeoutError) {
				return await send(
					interaction,
					{ content: 'Timed out.' },
					InteractionResponseType.ChannelMessageWithSource,
					true,
				);
			}

			throw error;
		} finally {
			void send(interaction, { components: [] });
		}
	}
}
