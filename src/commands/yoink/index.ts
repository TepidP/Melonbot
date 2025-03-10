import { EPermissionLevel } from '../../Typings/enums.js';
import { ArgType } from '../../Models/Command.js';
import gql, {
	ChangeEmoteInset,
	ConnectionPlatform,
	V3User,
	EnabledEmote,
	ListItemAction,
} from '../../SevenTVGQL.js';
import { ExtractAllSettledPromises, UnpingUser } from './../../tools/tools.js';
import { registerCommand } from '../../controller/Commands/Handler.js';

registerCommand({
	Name: 'yoink',
	Ping: false,
	Description: 'Steal several 7TV emotes from another channel TriHard ',
	Permission: EPermissionLevel.VIEWER,
	OnlyOffline: false,
	Aliases: ['steal'],
	Cooldown: 10,
	Params: [
		[ArgType.Boolean, 'case'],
		[ArgType.Boolean, 'alias'],
	],
	Flags: [],
	PreHandlers: [],
	Code: async function (ctx) {
		const errNoInputMsg = () =>
			`Provide an emote name and if you want to add to the current channel, a channel to steal from prefixed with @ or #, e.g @${ctx.user.Name} FloppaL`;

		const input = ctx.input;
		const caseSensitive = ctx.data.Params.case as boolean;
		const keepAlias = ctx.data.Params.alias as boolean;

		if (!input.length) {
			return {
				Success: false,
				Result: errNoInputMsg(),
			};
		}

		const prefixes: string[] = [`@`, `#`];
		const chanIdx: number = input.findIndex((chan: string) => prefixes.includes(chan[0]));

		const emotes = input.reduce((emotes: (never | string)[], emote: string, idx: number) => {
			if (idx === chanIdx) return emotes;

			if (!caseSensitive) emote = emote.toLowerCase();

			emotes.push(emote);
			return emotes;
		}, []);

		let writeChan: V3User | string = ctx.channel.Name;
		let readChan: V3User | string | undefined = input[chanIdx]?.slice(1);

		if (!readChan) {
			writeChan = ctx.user.Name;
			readChan = ctx.channel.Name;
		}

		if (writeChan === readChan) {
			this.EarlyEnd.InvalidInput("You can't steal an emote from yourself");
		}

		let readSet: string;
		let writeSet: string;

		switch (ctx.channel.Name) {
			case readChan:
				readSet = (await ctx.channel.GetChannelData('SevenTVEmoteSet')).ToString();
				break;
			case writeChan:
				writeSet = (await ctx.channel.GetChannelData('SevenTVEmoteSet')).ToString();
				break;
		}

		const convertToEmoteSet = async (user: string) =>
			(await getSevenTVAccount(user)).connections.find(
				(i) => i.platform === ConnectionPlatform.TWITCH,
			)?.emote_set_id ??
			(() => {
				throw new Error();
			})();

		try {
			readSet ??= await convertToEmoteSet(readChan);
			writeSet ??= await convertToEmoteSet(writeChan);
		} catch {
			return {
				Success: false,
				Result: 'User or channel not found',
			};
		}

		let toAdd: Set<EnabledEmote> = new Set();
		const channelEmotes = await gql.CurrentEnabledEmotes(readSet);

		for (const emote of channelEmotes) {
			(caseSensitive
				? emotes.includes(emote.name)
				: emotes.includes(emote.name.toLowerCase())) && toAdd.add(emote);
		}

		if (!toAdd.size) {
			return {
				Success: false,
				Result: 'Could not find any emotes to add',
			};
		}

		const writeChanPrompt =
			ctx.channel.Name === writeChan ? `` : ` (in #${UnpingUser(writeChan)})`;

		const promises: Promise<[string, ChangeEmoteInset]>[] = [];

		toAdd.forEach((emote) => promises.push(addEmote(emote, writeSet, keepAlias)));

		const [success, failed] = await Promise.allSettled(promises).then((i) =>
			ExtractAllSettledPromises<[string, ChangeEmoteInset], [string, string]>(i),
		);

		for (const f of failed) {
			ctx.channel.say(`👎 Failed to add ${f[0]} -> ${f[1]}` + writeChanPrompt);
		}

		for (const s of success) {
			ctx.channel.say(`👍 Added ${s[0]}` + writeChanPrompt);
		}

		return {
			Success: true,
			Result: '',
		};
	},
	LongDescription: async (prefix) => [
		'Steal several 7TV emotes from a channel.',
		"If the current channel is not specified, target will be set to the current channel, and the bot will add to the user's channel.",
		'',
		`**Usage**: ${prefix} yoink #channel emote`,
		`**Example**: ${prefix} yoink NOTED`,
		`**Example**: ${prefix} yoink #pajlada WideDankCrouching`,
		`**Example**: ${prefix} yoink @melon095 FloppaDank FloppaL`,
		`**Example**: ${prefix} yoink FloppaDank FloppaL #melon095`,
		'',
		'**Note**: Emotes are added case insensitive by default. Use the `-c` flag to make it case sensitive',
		'',
		`**Flags**`,
		'-c, --case',
		'   Case sensitive emote names',
		'',
		'-a, --alias',
		'   Add the emote while retaining the alias',
		'',
	],
});

const getSevenTVAccount = async (channel: string) => {
	const user = await Bot.User.ResolveUsername(channel);

	return gql.GetUser(user);
};

const addEmote = async (
	emote: EnabledEmote,
	emoteset: string,
	keepAlias: boolean,
): Promise<[string, ChangeEmoteInset]> => {
	try {
		const opts: [string, ListItemAction, string, string | undefined] = [
			emoteset,
			ListItemAction.ADD,
			emote.id,
			undefined,
		];

		if (keepAlias) {
			opts[3] = emote.name;
		}

		const [newEmoteSet, name] = await gql.ModifyEmoteSet(...opts);
		return [name ?? emote.name, newEmoteSet];
	} catch (error) {
		let msg = emote.data.name;
		if (emote.IsAlias()) {
			msg += ` (alias of ${emote.data.name})`;
		}

		throw [msg, error];
	}
};
