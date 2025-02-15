import { CaseManager } from '@automoderator/util';
import { Rest } from '@cordis/rest';
import { CaseAction, PrismaClient } from '@prisma/client';
import { APIGuildInteraction, InteractionResponseType } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Command } from '../../command';
import type { UnmuteCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';

@injectable()
export default class implements Command {
	public constructor(
		public readonly rest: Rest,
		public readonly cases: CaseManager,
		public readonly prisma: PrismaClient,
	) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof UnmuteCommand>) {
		await send(interaction, { flags: 64 }, InteractionResponseType.DeferredChannelMessageWithSource);
		const { user: member, reason = 'no reason provided' } = args;
		if (reason && reason.length >= 1900) {
			throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
		}

		const cs = await this.prisma.case.findFirst({
			where: {
				guildId: interaction.guild_id,
				targetId: member.user.id,
				actionType: CaseAction.mute,
				task: { isNot: null },
			},
		});

		if (!cs) {
			throw new ControlFlowError('User is not muted');
		}

		await this.cases.undoTimedAction(cs, reason);
		await send(interaction, { content: `Successfully unmuted ${member.user.username}#${member.user.discriminator}` });
	}
}
