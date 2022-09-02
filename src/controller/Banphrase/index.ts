import Got from './../../tools/Got.js';
import * as regex from '../../tools/regex.js';
import User from './../User/index.js';

interface Bans {
	type: Database.banphrase_type;
	pb1_url?: string;
	regex?: RegExp;
}

export class Banphrase {
	static GlobalBans: RegExp[] = [
		regex.racism1,
		regex.racism2,
		regex.racism3,
		regex.racism4,
		regex.underage,
		// regex.url,
	];

	private _bans: Bans[] = [];

	constructor(private owner: User) {}

	async Initialize() {
		const phrases = await Bot.SQL.Query<Database.banphrases[]>`
            SELECT *
            FROM banphrases
            WHERE channel = ${this.owner.TwitchUID}
        `;

		for (const phrase of phrases) {
			this._bans.push({
				type: phrase.type,
				pb1_url: phrase.pb1_url ?? undefined,
				regex: phrase.regex ? new RegExp(phrase.regex) : undefined,
			});
		}
	}

	async Update() {
		this._bans = [];
		await this.Initialize();
	}

	async Check(message: string): Promise<{ banned: boolean; reason?: string }> {
		// eslint-disable-next-line no-async-promise-executor
		const _chvl: boolean[] = [];

		Banphrase.GlobalBans.map((regex) => regex.test(message) && _chvl.push(true));
		if (_chvl.length) return { banned: true, reason: 'Global Banphrase' };

		for (const ban of this._bans) {
			switch (ban.type) {
				case 'regex': {
					ban.regex?.test(message) && _chvl.push(true);
					break;
				}
				case 'pb1': {
					const url = `${ban.pb1_url}/api/v1/banphrases/test`;
					const json = {
						message,
					};

					const { statusCode, body } = await Got('json').post(url, {
						json,
						throwHttpErrors: false,
					});

					const jsonBody = JSON.parse(body);

					if (statusCode >= 400) {
						throw new Error(
							'Error while checking banphrase' + JSON.stringify({ url, json, body }),
						);
					}

					_chvl.push(jsonBody.banned);

					break;
				}
			}
			if (_chvl.every((i) => i === true))
				return { banned: true, reason: 'Channel Banphrase' };
		}

		return { banned: _chvl.includes(true), reason: 'Channel Banphrase' };
	}
}
