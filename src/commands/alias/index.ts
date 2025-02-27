import { EPermissionLevel } from './../../Typings/enums.js';
import gql, { ListItemAction } from './../../SevenTVGQL.js';
import SevenTVAllowed, { Get7TVUserMod } from './../../PreHandlers/7tv.can.modify.js';
import { registerCommand } from '../../controller/Commands/Handler.js';

type PreHandlers = {
	SevenTV: Get7TVUserMod;
};

registerCommand<PreHandlers>({
	Name: 'alias',
	Ping: false,
	Description: "Sets the alias of an emote, don't give it a name and it will remove the alias",
	Permission: EPermissionLevel.VIEWER,
	OnlyOffline: false,
	Aliases: [],
	Cooldown: 5,
	Params: [],
	Flags: [],
	PreHandlers: [SevenTVAllowed],
	Code: async function (ctx, mods) {
		const { EmoteSet } = mods.SevenTV;

		if (!ctx.input[0]) {
			this.EarlyEnd.InvalidInput('give me something to alias :)');
		}

		const input = ctx.input[0];

		const [src] = await gql.CurrentEnabledEmotes(EmoteSet(), (emote) => emote.name === input);

		if (!src) {
			return {
				Success: false,
				Result: "Can't find that emote :(",
			};
		}

		const dst = ctx.input[1] || '';

		const [_, newEmote] = await gql.ModifyEmoteSet(
			EmoteSet(),
			ListItemAction.UPDATE,
			src.id,
			dst,
		);

		if (dst === '') {
			return {
				Success: true,
				Result: `I reset the alias of ${src.name} to ${newEmote}`,
			};
		}

		return {
			Success: true,
			Result: `I set the alias of ${src.name} to ${dst}`,
		};
	},
	LongDescription: async (prefix) => [
		`This command allows you to set the alias of an emote.`,
		`If you don't give it a name, it will remove the alias.`,
		'',
		`**Usage**: ${prefix}alias <emote> [alias]`,
		`**Example**: ${prefix}alias FloppaL xqcL`,
		'',
		'**Required 7TV Flags**',
		'Modify Emotes',
	],
});
