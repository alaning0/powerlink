import { App, Modal, Notice, Setting } from 'obsidian';
import { fetchRecentIdeaUrls, type IdeaLink } from './api';

export type DestinationChoice = 'current' | 'folder';

export interface UrlSelection {
	url: string;
	ideaId?: number;
}

export class UrlPickerModal extends Modal {
	private ideasApiUrl: string;
	private urlInput = '';
	private selectedIdeaId: number | undefined;
	private onSubmit: (selection: UrlSelection) => void;
	private recentListEl: HTMLElement | null = null;

	constructor(
		app: App,
		ideasApiUrl: string,
		onSubmit: (selection: UrlSelection) => void,
	) {
		super(app);
		this.ideasApiUrl = ideasApiUrl;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('powerlink-modal');

		contentEl.createEl('h2', { text: 'Powerlink' });
		contentEl.createEl('p', {
			text: 'Paste a URL, or pick a recent link from your Ideas API.',
			cls: 'powerlink-muted',
		});

		new Setting(contentEl)
			.setName('URL')
			.addText((text) => {
				text
					.setPlaceholder('https://...')
					.setValue(this.urlInput)
					.onChange((value) => {
						this.urlInput = value;
						// Pasted/edited URLs are not tied to an Ideas row
						this.selectedIdeaId = undefined;
					});
				text.inputEl.addClass('powerlink-url-input');
				text.inputEl.addEventListener('keydown', (evt) => {
					if (evt.key === 'Enter') {
						evt.preventDefault();
						this.submit();
					}
				});
			});

		const recentHeader = contentEl.createDiv({ cls: 'powerlink-recent-header' });
		recentHeader.createSpan({ text: 'Recent links' });
		const refreshBtn = recentHeader.createEl('button', {
			text: 'Load',
			cls: 'mod-cta',
		});
		refreshBtn.addEventListener('click', () => {
			void this.loadRecent();
		});

		this.recentListEl = contentEl.createDiv({ cls: 'powerlink-recent-list' });
		this.recentListEl.createEl('p', {
			text: 'Click Load to fetch recent URLs.',
			cls: 'powerlink-muted',
		});

		const actions = contentEl.createDiv({ cls: 'powerlink-actions' });
		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const nextBtn = actions.createEl('button', {
			text: 'Next',
			cls: 'mod-cta',
		});
		nextBtn.addEventListener('click', () => this.submit());

		void this.loadRecent();
	}

	private async loadRecent(): Promise<void> {
		if (!this.recentListEl) return;
		this.recentListEl.empty();
		this.recentListEl.createEl('p', {
			text: 'Loading…',
			cls: 'powerlink-muted',
		});

		try {
			if (!this.ideasApiUrl.trim()) {
				throw new Error('Ideas API URL is not set in settings');
			}
			const links = await fetchRecentIdeaUrls(this.ideasApiUrl.trim(), 10);
			this.recentListEl.empty();
			if (links.length === 0) {
				this.recentListEl.createEl('p', {
					text: 'No URL-like ideas found.',
					cls: 'powerlink-muted',
				});
				return;
			}
			for (const link of links) {
				const btn = this.recentListEl.createEl('button', {
					text: link.url,
					cls: 'powerlink-recent-item',
				});
				btn.addEventListener('click', () => {
					this.selectLink(link);
				});
			}
		} catch (err) {
			this.recentListEl.empty();
			const message = err instanceof Error ? err.message : String(err);
			this.recentListEl.createEl('p', {
				text: `Failed to load: ${message}`,
				cls: 'powerlink-error',
			});
		}
	}

	private selectLink(link: IdeaLink): void {
		this.urlInput = link.url;
		this.selectedIdeaId = link.id;
		const input = this.contentEl.querySelector('.powerlink-url-input');
		if (input instanceof HTMLInputElement) {
			input.value = link.url;
		}
	}

	private submit(): void {
		const url = this.urlInput.trim();
		if (!url) {
			new Notice('Enter or select a URL first');
			return;
		}
		if (!/^https?:\/\//i.test(url)) {
			new Notice('URL must start with http:// or https://');
			return;
		}
		this.close();
		this.onSubmit({
			url,
			ideaId: this.selectedIdeaId,
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class DestinationModal extends Modal {
	private notesFolder: string;
	private onChoose: (choice: DestinationChoice) => void;

	constructor(
		app: App,
		notesFolder: string,
		onChoose: (choice: DestinationChoice) => void,
	) {
		super(app);
		this.notesFolder = notesFolder;
		this.onChoose = onChoose;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('powerlink-modal');

		contentEl.createEl('h2', { text: 'Where should this go?' });

		const actions = contentEl.createDiv({ cls: 'powerlink-stack' });

		const currentBtn = actions.createEl('button', {
			text: 'Insert into current note',
			cls: 'mod-cta powerlink-choice',
		});
		currentBtn.addEventListener('click', () => {
			this.close();
			this.onChoose('current');
		});

		const folderLabel = this.notesFolder.trim()
			? `New note in folder (${this.notesFolder})`
			: 'New note in folder';
		const folderBtn = actions.createEl('button', {
			text: folderLabel,
			cls: 'powerlink-choice',
		});
		folderBtn.addEventListener('click', () => {
			if (!this.notesFolder.trim()) {
				new Notice(
					'Set a Notes folder in Powerlink settings first',
				);
				return;
			}
			this.close();
			this.onChoose('folder');
		});

		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class LinkOrCloseModal extends Modal {
	private notePath: string;
	private onOpenNote: () => void;
	private onInsertLink: () => void;

	constructor(
		app: App,
		notePath: string,
		onOpenNote: () => void,
		onInsertLink: () => void,
	) {
		super(app);
		this.notePath = notePath;
		this.onOpenNote = onOpenNote;
		this.onInsertLink = onInsertLink;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('powerlink-modal');

		contentEl.createEl('h2', { text: 'Note created' });
		contentEl.createEl('p', {
			text: this.notePath,
			cls: 'powerlink-path',
		});
		contentEl.createEl('p', {
			text: 'Open the note, insert a link into the current note, or close.',
			cls: 'powerlink-muted',
		});

		const actions = contentEl.createDiv({ cls: 'powerlink-actions' });

		const closeBtn = actions.createEl('button', { text: 'Close' });
		closeBtn.addEventListener('click', () => this.close());

		const openBtn = actions.createEl('button', { text: 'Open' });
		openBtn.addEventListener('click', () => {
			this.close();
			this.onOpenNote();
		});

		const insertBtn = actions.createEl('button', {
			text: 'Insert link',
			cls: 'mod-cta',
		});
		insertBtn.addEventListener('click', () => {
			this.close();
			this.onInsertLink();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
