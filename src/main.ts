import {
	Editor,
	MarkdownView,
	Notice,
	Platform,
	Plugin,
	TFile,
	TFolder,
} from 'obsidian';
import {
	deleteIdea,
	formatNoteContent,
	generateFromTranscript,
	generateFromUrl,
	sanitizeFilename,
	testIdeasApi,
	type GenerateResult,
} from './api';
import {
	extractMediaTranscript,
	isMediaUrl,
} from './desktop-extract';
import {
	DestinationModal,
	LinkOrCloseModal,
	UrlPickerModal,
	type UrlSelection,
} from './modals';
import {
	DEFAULT_SETTINGS,
	PowerlinkSettingTab,
	PowerlinkSettings,
} from './settings';

export default class PowerlinkPlugin extends Plugin {
	settings!: PowerlinkSettings;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon('link', 'Powerlink', () => {
			this.startFlow(false);
		});

		this.addCommand({
			id: 'open',
			name: 'Open',
			callback: () => this.startFlow(false),
		});

		if (Platform.isDesktopApp) {
			this.addRibbonIcon('sparkles', 'Powerlink advanced', () => {
				this.startFlow(true);
			});

			this.addCommand({
				id: 'open-advanced',
				name: 'Open advanced',
				callback: () => this.startFlow(true),
			});
		}

		this.addSettingTab(new PowerlinkSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<PowerlinkSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async testIdeasApi(): Promise<void> {
		const loading = new Notice('Testing Ideas API…', 0);
		try {
			const message = await testIdeasApi(
				this.settings.ideasApiUrl,
				this.settings.ideasApiKey,
			);
			new Notice(message, 8000);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			new Notice(`Ideas API test failed: ${message}`, 8000);
			console.error(err);
		} finally {
			loading.hide();
		}
	}

	private startFlow(advanced: boolean): void {
		const sourceView =
			this.app.workspace.getActiveViewOfType(MarkdownView) ?? null;

		new UrlPickerModal(
			this.app,
			this.settings.ideasApiUrl,
			(selection) => {
				new DestinationModal(
					this.app,
					this.settings.notesFolder,
					(choice) => {
						void this.handleDestination(
							selection,
							choice,
							sourceView,
							advanced,
						);
					},
				).open();
			},
		).open();
	}

	private async handleDestination(
		selection: UrlSelection,
		choice: 'current' | 'folder',
		sourceView: MarkdownView | null,
		advanced: boolean,
	): Promise<void> {
		const { url, ideaId } = selection;

		if (!this.settings.openaiApiKey.trim()) {
			new Notice('Set your OpenAI API key in Powerlink settings');
			return;
		}

		const loading = new Notice(
			advanced
				? 'Powerlink Advanced: starting…'
				: 'Powerlink: fetching page and generating…',
			0,
		);

		const setStatus = (message: string) => {
			loading.setMessage(message);
		};

		try {
			const result = advanced
				? await this.generateAdvanced(url, setStatus)
				: await generateFromUrl({
						apiKey: this.settings.openaiApiKey,
						model: this.settings.openaiModel,
						prompt: this.settings.prompt,
						url,
					});

			const content = formatNoteContent(url, result.body);
			await this.applyResult(content, result.filename, choice, sourceView, ideaId);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			new Notice(`Powerlink failed: ${message}`);
			console.error(err);
		} finally {
			loading.hide();
		}
	}

	private async generateAdvanced(
		url: string,
		onStatus: (message: string) => void,
	): Promise<GenerateResult> {
		if (!Platform.isDesktopApp) {
			throw new Error('Advanced mode is only available on desktop');
		}

		if (isMediaUrl(url)) {
			const extracted = await extractMediaTranscript({
				url,
				ytDlpPath: this.settings.ytDlpPath,
				ffmpegLocation: this.settings.ffmpegLocation,
				cookiesFile: this.settings.cookiesFile,
				cookiesFromBrowser: this.settings.cookiesFromBrowser,
				openaiApiKey: this.settings.openaiApiKey,
				whisperModel: this.settings.whisperModel,
				onStatus,
			});

			onStatus(
				`Generating note from ${extracted.source === 'captions' ? 'captions' : 'Whisper transcript'}…`,
			);

			return generateFromTranscript({
				apiKey: this.settings.openaiApiKey,
				model: this.settings.openaiModel,
				prompt: this.settings.prompt,
				url,
				transcript: extracted.transcript,
				titleHint: extracted.titleHint,
			});
		}

		onStatus('Powerlink Advanced: fetching page and generating…');
		return generateFromUrl({
			apiKey: this.settings.openaiApiKey,
			model: this.settings.openaiModel,
			prompt: this.settings.prompt,
			url,
		});
	}

	private async applyResult(
		content: string,
		filename: string,
		choice: 'current' | 'folder',
		sourceView: MarkdownView | null,
		ideaId: number | undefined,
	): Promise<void> {
		if (choice === 'current') {
			const inserted = this.insertIntoCurrent(content, sourceView);
			if (inserted) {
				new Notice('Inserted into current note');
				await this.maybeDeleteIdea(ideaId);
			}
			return;
		}

		const file = await this.createNoteInFolder(filename, content);
		new Notice(`Created ${file.path}`);
		await this.maybeDeleteIdea(ideaId);

		new LinkOrCloseModal(
			this.app,
			file.path,
			() => {
				void this.app.workspace.getLeaf(false).openFile(file);
			},
			() => {
				this.insertWikiLink(file, sourceView);
			},
		).open();
	}

	private async maybeDeleteIdea(ideaId: number | undefined): Promise<void> {
		if (
			ideaId == null ||
			!this.settings.deleteIdeaAfterSuccess ||
			!this.settings.ideasApiUrl.trim()
		) {
			return;
		}

		try {
			await deleteIdea(
				this.settings.ideasApiUrl,
				ideaId,
				this.settings.ideasApiKey,
			);
			new Notice(`Removed idea #${ideaId} from Ideas API`);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			new Notice(`Processed, but failed to delete idea: ${message}`);
			console.error(err);
		}
	}

	private insertIntoCurrent(
		content: string,
		sourceView: MarkdownView | null,
	): boolean {
		const view =
			sourceView ??
			this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice('No active markdown note to insert into');
			return false;
		}
		this.insertAtCursor(view.editor, content);
		return true;
	}

	private insertWikiLink(
		file: TFile,
		sourceView: MarkdownView | null,
	): void {
		const view =
			sourceView ??
			this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice('No active markdown note to insert a link into');
			return;
		}

		const linkPath = file.path.replace(/\.md$/i, '');
		this.insertAtCursor(view.editor, `[[${linkPath}]]`);
		new Notice('Link inserted into current note');
	}

	private insertAtCursor(editor: Editor, text: string): void {
		const cursor = editor.getCursor();
		const before =
			cursor.ch > 0 ? editor.getRange({ line: cursor.line, ch: 0 }, cursor) : '';
		const prefix =
			before.length > 0 && !/\s$/.test(before) ? `\n${text}` : text;
		editor.replaceRange(prefix, cursor);
		const lines = prefix.split('\n');
		const last = lines[lines.length - 1] ?? '';
		editor.setCursor({
			line: cursor.line + lines.length - 1,
			ch: lines.length === 1 ? cursor.ch + last.length : last.length,
		});
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		const normalized = folderPath.replace(/^\/+|\/+$/g, '');
		if (!normalized) return;

		const parts = normalized.split('/');
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (!existing) {
				await this.app.vault.createFolder(current);
			} else if (!(existing instanceof TFolder)) {
				throw new Error(`Path exists and is not a folder: ${current}`);
			}
		}
	}

	private async createNoteInFolder(
		rawFilename: string,
		content: string,
	): Promise<TFile> {
		const folder = this.settings.notesFolder.trim().replace(/^\/+|\/+$/g, '');
		if (!folder) {
			throw new Error('Notes folder is not set');
		}

		await this.ensureFolder(folder);

		const base = sanitizeFilename(rawFilename);
		let path = `${folder}/${base}.md`;
		let n = 2;
		while (this.app.vault.getAbstractFileByPath(path)) {
			path = `${folder}/${base} ${n}.md`;
			n += 1;
		}

		return this.app.vault.create(path, content);
	}
}
