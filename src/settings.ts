import { App, PluginSettingTab, Setting } from 'obsidian';
import type PowerlinkPlugin from './main';

export interface PowerlinkSettings {
	ideasApiUrl: string;
	openaiApiKey: string;
	openaiModel: string;
	prompt: string;
	notesFolder: string;
	deleteIdeaAfterSuccess: boolean;
	ytDlpPath: string;
	ffmpegLocation: string;
	cookiesFile: string;
	cookiesFromBrowser: string;
	whisperModel: string;
}

export const DEFAULT_SETTINGS: PowerlinkSettings = {
	ideasApiUrl: 'https://alaning-me-api.alaning0.workers.dev/api/ideas',
	openaiApiKey: '',
	openaiModel: 'gpt-4o-mini',
	prompt: 'Summarize this URL for my notes.',
	notesFolder: '',
	deleteIdeaAfterSuccess: true,
	ytDlpPath: 'yt-dlp',
	ffmpegLocation: '/opt/homebrew/bin/ffmpeg',
	cookiesFile: '/Users/alaning/instadev/yt-cookies.txt',
	cookiesFromBrowser: '',
	whisperModel: 'whisper-1',
};

export class PowerlinkSettingTab extends PluginSettingTab {
	plugin: PowerlinkPlugin;

	constructor(app: App, plugin: PowerlinkPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Ideas API URL')
			.setDesc('Endpoint that returns recent ideas/links.')
			.addText((text) =>
				text
					.setPlaceholder(
						'https://alaning-me-api.alaning0.workers.dev/api/ideas',
					)
					.setValue(this.plugin.settings.ideasApiUrl)
					.onChange(async (value) => {
						this.plugin.settings.ideasApiUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('OpenAI API key')
			.setDesc('Used to generate note filename and body from a URL.')
			.addText((text) => {
				text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
			});

		new Setting(containerEl)
			.setName('OpenAI model')
			.setDesc('Chat model id, e.g. gpt-4o-mini.')
			.addText((text) =>
				text
					.setPlaceholder('gpt-4o-mini')
					.setValue(this.plugin.settings.openaiModel)
					.onChange(async (value) => {
						this.plugin.settings.openaiModel = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Prompt')
			.setDesc(
				'Instructions for the note body. The URL is sent with this prompt.',
			)
			.addTextArea((text) => {
				text
					.setPlaceholder('Summarize this URL for my notes.')
					.setValue(this.plugin.settings.prompt)
					.onChange(async (value) => {
						this.plugin.settings.prompt = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 4;
				text.inputEl.addClass('powerlink-prompt-input');
			});

		new Setting(containerEl)
			.setName('Notes folder')
			.setDesc(
				'Vault-relative folder for new notes, e.g. Powerlinks or Inbox/Links.',
			)
			.addText((text) =>
				text
					.setPlaceholder('Powerlinks')
					.setValue(this.plugin.settings.notesFolder)
					.onChange(async (value) => {
						this.plugin.settings.notesFolder = value
							.trim()
							.replace(/^\/+|\/+$/g, '');
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Delete from Ideas after success')
			.setDesc(
				'When a recent Ideas API link is processed successfully, delete it from the API.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.deleteIdeaAfterSuccess)
					.onChange(async (value) => {
						this.plugin.settings.deleteIdeaAfterSuccess = value;
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl('h3', { text: 'Advanced (desktop only)' });
		containerEl.createEl('p', {
			text: 'Used by the Powerlink Advanced ribbon for YouTube and Instagram extraction via yt-dlp and Whisper.',
			cls: 'setting-item-description',
		});

		new Setting(containerEl)
			.setName('yt-dlp path')
			.setDesc(
				'Command or absolute path to yt-dlp (shell aliases are not used).',
			)
			.addText((text) =>
				text
					.setPlaceholder('yt-dlp')
					.setValue(this.plugin.settings.ytDlpPath)
					.onChange(async (value) => {
						this.plugin.settings.ytDlpPath =
							value.trim() || 'yt-dlp';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('ffmpeg location')
			.setDesc(
				'Path to the ffmpeg binary or its folder. Obsidian often lacks Homebrew on PATH.',
			)
			.addText((text) =>
				text
					.setPlaceholder('/opt/homebrew/bin/ffmpeg')
					.setValue(this.plugin.settings.ffmpegLocation)
					.onChange(async (value) => {
						this.plugin.settings.ffmpegLocation = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Cookies file')
			.setDesc(
				'Netscape cookies.txt path for yt-dlp (--cookies). Preferred over browser cookies. Export from Terminal with yt-dlp --cookies-from-browser safari --cookies <path>.',
			)
			.addText((text) =>
				text
					.setPlaceholder('/Users/alaning/instadev/yt-cookies.txt')
					.setValue(this.plugin.settings.cookiesFile)
					.onChange(async (value) => {
						this.plugin.settings.cookiesFile = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Cookies from browser')
			.setDesc(
				'Fallback when Cookies file is empty. Passed as --cookies-from-browser (often blocked inside Obsidian).',
			)
			.addText((text) =>
				text
					.setPlaceholder('safari')
					.setValue(this.plugin.settings.cookiesFromBrowser)
					.onChange(async (value) => {
						this.plugin.settings.cookiesFromBrowser = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Whisper model')
			.setDesc('OpenAI transcription model when captions are unavailable.')
			.addText((text) =>
				text
					.setPlaceholder('whisper-1')
					.setValue(this.plugin.settings.whisperModel)
					.onChange(async (value) => {
						this.plugin.settings.whisperModel =
							value.trim() || 'whisper-1';
						await this.plugin.saveSettings();
					}),
			);
	}
}
