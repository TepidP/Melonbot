import Got from './../../tools/Got.js';
import { JWTData } from 'web/index.js';
import { UserRole } from './../../Typings/models/bot/index.js';
import Helix from './../../Helix/index.js';
import type { Ivr } from './../../Typings/types.js';

export class GetSafeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'GetSafeError';
	}
}

export interface TwitchToken {
	access_token: string;
	refresh_token: string;
	expires_in: number;
}

export interface UserSettings {
	Eventsub: boolean;
	// [key: string]: string | boolean;
}

export default class User {
	// Two hours
	static readonly cacheExpireTime = 1000 * 60 * 60 * 2;
	static readonly cacheExpireInterval = setInterval(
		() => User.Cache.clear(),
		User.cacheExpireTime,
	);

	/**
	 * Cache by the user's name
	 * This allows for name changes to not break it.
	 */
	static Cache = new Map<string, User>();

	public readonly ID: number;
	public readonly Name: string;
	public readonly TwitchUID: string;
	public readonly Role: UserRole;
	public readonly FirstSeen: Date;

	constructor(user: Database.users) {
		this.ID = user.id;
		this.Name = user.name;
		this.TwitchUID = user.twitch_uid;
		this.Role = user.role;
		this.FirstSeen = user.first_seen;
	}

	static async Get(
		TwitchID: string,
		Name: string,
		options = { throwOnNotFound: false },
	): Promise<User> {
		// Check if cached
		const cacheUser = User.Cache.get(Name);

		if (cacheUser) {
			return cacheUser;
		}

		// Find the user in the database
		// Based of the twitch uid
		// Name changes won't break it as it should pick the latest detected user
		const dbUser = await Bot.SQL.Query<Database.users[]>`
            SELECT * FROM users
            WHERE twitch_uid = ${TwitchID}
            ORDER BY first_seen DESC
            LIMIT 1
        `;

		if (dbUser.length) {
			const user = new User(dbUser[0]);
			User.Cache.set(Name, user);
			return user;
		}

		if (options.throwOnNotFound) {
			throw new GetSafeError(`User ${Name} not found in database.`);
		}

		// Create new user
		const newUser = await Bot.SQL.Query<Database.users[]>`
            INSERT INTO users (name, twitch_uid, role)
            VALUES (${Name}, ${TwitchID}, 'user')
            RETURNING *
        `;

		const user = new User(newUser[0]);
		User.Cache.set(Name, user);
		return user;
	}

	static async GetMultiple(Users: { TwitchID: string; Name: string }[]): Promise<User[]> {
		const users = [];

		for (const user of Users) {
			users.push(User.Get(user.TwitchID, user.Name));
		}

		return Promise.all(users);
	}

	static CleanName(name: string) {
		return name.toLowerCase().replace(/[@#]/g, '');
	}

	static async ResolveTwitchID(id: string[]): Promise<{ Okay: User[]; Failed: string[] }> {
		const searchParams = new URLSearchParams({ id: id.join(',') });

		const response = (await Got('json')
			.get({
				url: `https://api.ivr.fi/v2/twitch/user`,
				searchParams: searchParams,
			})
			.json()) as Ivr.User[];

		if (!response.length) {
			return { Okay: [], Failed: id };
		}

		const Okay = [];
		const Failed = [];

		const promise = await Promise.allSettled(
			response.map(async (user) => {
				const { login, id: twitchID } = user;

				const a = await User.Get(twitchID, login);
				if (a) {
					return a;
				}
				throw new GetSafeError(`User ${login} not found`);
			}),
		);

		Okay.push(
			...(
				promise.filter((p) => p.status === 'fulfilled') as PromiseFulfilledResult<User>[]
			).map((p) => p.value),
		);
		Failed.push(
			...(promise.filter((p) => p.status === 'rejected') as PromiseRejectedResult[]).map(
				(p) => p.reason,
			),
		);

		return { Okay, Failed };
	}

	static async ResolveUsername(username: string): Promise<User> {
		const cache = User.Cache.get(username);

		if (cache) {
			return cache;
		}

		const user = await Bot.SQL.Query<Database.users[]>`
            SELECT * FROM users
            WHERE name = ${username}
            LIMIT 1
        `;

		if (user.length) {
			const dbUser = new User(user[0]);
			User.Cache.set(username, dbUser);
			return dbUser;
		}

		const response = (await Got('json')
			.get({
				url: `https://api.ivr.fi/v2/twitch/user`,
				searchParams: {
					login: username,
				},
			})
			.json()) as Ivr.User[];

		if (!response.length) {
			throw new GetSafeError(`User ${username} not found`);
		}

		const { login, id } = response[0];

		const newUser = await Bot.SQL.Query<Database.users[]>`
            INSERT INTO users (name, twitch_uid, role)
            VALUES (${login}, ${id}, 'user')
            RETURNING *
        `;

		const newIvr = new User(newUser[0]);
		User.Cache.set(login, newIvr);
		return newIvr;
	}

	async SetToken(
		token: TwitchToken,
		JWTGenerator: (data: JWTData) => Promise<string>,
	): Promise<string> {
		const jwt = await JWTGenerator({
			id: this.TwitchUID,
			name: this.Name,
			v: 1,
		});

		// Expire in 7 das, same as jwt does.
		(await Bot.Redis.SSet(`session:${this.TwitchUID}:${this.Name}`, jwt))(60 * 60 * 24 * 7);

		// Store TwitchToken aswell
		await Bot.Redis.SSet(`token:${this.TwitchUID}:${this.Name}`, JSON.stringify(token));

		return jwt;
	}

	async GetProfilePicture(): Promise<string> {
		const cached = await Bot.Redis.SGet(`profilepicture:${this.TwitchUID}`);
		if (cached) {
			return cached;
		}

		const user = await Helix.Users([this]);

		const url = user.data[0].profile_image_url;

		// Expire in 30 minutes
		await (
			await Bot.Redis.SSet(`profilepicture:${this.TwitchUID}`, url)
		)(60 * 30);

		return url;
	}

	async RemoveBanphrase(id: number): Promise<'ACK'> {
		await Bot.SQL.Query<Database.banphrases[]>`
            DELETE FROM banphrases
            WHERE id = ${id}
        `;

		return 'ACK';
	}

	async GetSettings(): Promise<UserSettings> {
		const DefaultOptions: UserSettings = { Eventsub: false };

		const Options = await Bot.Redis.SGet(`user:${this.TwitchUID}:options`).then((options) => {
			if (!options) return DefaultOptions;
			return JSON.parse(options);
		});

		return Options;
	}

	async SetSettings(options: UserSettings): Promise<'ACK'> {
		await Bot.Redis.SSet(`user:${this.TwitchUID}:options`, JSON.stringify(options));
		return 'ACK';
	}

	HasSuperPermission(): boolean {
		return this.Role === 'admin' || this.Role === 'moderator';
	}

	/**
	 * User((1) melon095:146910710 - admin - 2021-05-01T20:00:00.000Z)
	 */
	toString() {
		return `User((${this.ID}) ${this.Name}:${this.TwitchUID} - ${
			this.Role
		} - ${this.FirstSeen.toLocaleDateString()})`;
	}
}
