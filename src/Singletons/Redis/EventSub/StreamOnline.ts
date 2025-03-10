import { IEventSubHandler } from './Base.js';
import { IPubStreamOnline } from './../Data.Types.js';
import { UppercaseFirst } from './../../../tools/tools.js';

export default {
	Type: () => 'stream.online',
	Log: ({ broadcaster_user_login, type }) =>
		Bot.Log.Info(`[%s] Is now online! (%s)`, broadcaster_user_login, UppercaseFirst(type)),
	Handle: async ({ broadcaster_user_id }) => {
		const channel = Bot.Twitch.Controller.TwitchChannelSpecific({
			ID: broadcaster_user_id,
		});

		if (!channel) {
			Bot.Log.Warn('EventSub.StreamOnline: Channel not found %O', {
				broadcaster_user_id,
			});
			return;
		}

		await Bot.SQL.updateTable('channels')
			.set({ live: true })
			.where('user_id', '=', channel.Id)
			.execute();

		await channel.UpdateLive();
	},
} as IEventSubHandler<IPubStreamOnline>;
