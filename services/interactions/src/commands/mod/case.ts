import { injectable, inject } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf, UserPerms, ControlFlowError, send } from '#util';
import { CaseCommand } from '#interactions';
import { Rest as DiscordRest } from '@cordis/rest';
import { Case, GuildSettings, makeCaseEmbed } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import { APIGuildInteraction, APIUser, ButtonStyle, ComponentType, Routes } from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import type { Sql } from 'postgres';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: DiscordRest,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof CaseCommand>) {
    const isShow = Object.keys(args)[0] === 'show';
    const caseId = isShow ? args.show.case : args.delete.case;

    const [cs] = await this.sql<[Case?]>`SELECT * FROM cases WHERE guild_id = ${interaction.guild_id} AND case_id = ${caseId}`;

    if (!cs) {
      throw new ControlFlowError('Case could not be found');
    }

    const [
      { mod_action_log_channel: logChannelId = null } = {}
    ] = await this.sql<[Pick<GuildSettings, 'mod_action_log_channel'>?]>`
      SELECT mod_action_log_channel FROM guild_settings WHERE guild_id = ${interaction.guild_id}
    `;

    const [target, mod] = await Promise.all([
      this.rest.get<APIUser>(Routes.user(cs.target_id)),
      cs.mod_id ? this.rest.get<APIUser>(Routes.user(cs.mod_id)) : Promise.resolve(null)
    ]);

    let refCs: Case | undefined;
    if (cs.ref_id) {
      refCs = await this
        .sql<[Case]>`SELECT * FROM cases WHERE case_id = ${cs.ref_id} AND guild_id = ${cs.guild_id}`
        .then(rows => rows[0]);
    }

    const embed = makeCaseEmbed({ logChannelId, cs, target, mod, refCs });

    if (isShow) {
      return send(interaction, { embed });
    }

    const id = nanoid();

    return send(interaction, {
      content: 'Are you sure you want to delete this case?',
      embed,
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              label: 'Confirm',
              style: ButtonStyle.Success,
              custom_id: `confirm-case-delete|${id}|${cs.case_id}|y`
            },
            {
              type: ComponentType.Button,
              label: 'Cancel',
              style: ButtonStyle.Secondary,
              custom_id: `confirm-case-delete|${id}|${cs.case_id}|n`
            }
          ]
        }
      ],
      flags: 64
    });
  }
}
