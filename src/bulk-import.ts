import { App, Modal, Notice } from 'obsidian';
import { fetchAllIdeaUrls, type IdeaWithTitle } from './api';

export interface BulkSelection {
	id: number;
	url: string;
	title?: string;
}

export class BulkImportModal extends Modal {
	private ideasApiUrl: string;
	private onSubmit: (selections: BulkSelection[]) => void;
	private ideas: IdeaWithTitle[] = [];
	private selected = new Set<number>();
	private listEl: HTMLElement | null = null;

	constructor(
		app: App,
		ideasApiUrl: string,
		onSubmit: (selections: BulkSelection[]) => void,
	) {
		super(app);
		this.ideasApiUrl = ideasApiUrl;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('powerlink-modal', 'powerlink-bulk-modal');

		contentEl.createEl('h2', { text: 'Bulk import from ideas' });
		contentEl.createEl('p', {
			text: 'Select URLs to import. Each will be processed in sequence.',
			cls: 'powerlink-muted',
		});

		const controls = contentEl.createDiv({ cls: 'powerlink-bulk-controls' });
		const selectAllBtn = controls.createEl('button', { text: 'Select all' });
		selectAllBtn.addEventListener('click', () => this.selectAll());
		const selectNoneBtn = controls.createEl('button', { text: 'Select none' });
		selectNoneBtn.addEventListener('click', () => this.selectNone());

		this.listEl = contentEl.createDiv({ cls: 'powerlink-bulk-list' });
		this.listEl.createEl('p', {
			text: 'Loading ideas…',
			cls: 'powerlink-muted',
		});

		const actions = contentEl.createDiv({ cls: 'powerlink-actions' });
		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const importBtn = actions.createEl('button', {
			text: 'Import selected',
			cls: 'mod-cta',
		});
		importBtn.addEventListener('click', () => this.submit());

		void this.loadIdeas();
	}

	private async loadIdeas(): Promise<void> {
		if (!this.listEl) return;

		try {
			if (!this.ideasApiUrl.trim()) {
				throw new Error('Ideas API URL is not set in settings');
			}
			this.ideas = await fetchAllIdeaUrls(this.ideasApiUrl.trim());
			this.selected.clear();
			this.renderList();
		} catch (err) {
			this.listEl.empty();
			const message = err instanceof Error ? err.message : String(err);
			this.listEl.createEl('p', {
				text: `Failed to load: ${message}`,
				cls: 'powerlink-error',
			});
		}
	}

	private renderList(): void {
		if (!this.listEl) return;
		this.listEl.empty();

		if (this.ideas.length === 0) {
			this.listEl.createEl('p', {
				text: 'No URL-like ideas found.',
				cls: 'powerlink-muted',
			});
			return;
		}

		for (const idea of this.ideas) {
			const row = this.listEl.createDiv({ cls: 'powerlink-bulk-item' });
			const checkbox = row.createEl('input', { type: 'checkbox' });
			checkbox.checked = this.selected.has(idea.id);
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					this.selected.add(idea.id);
				} else {
					this.selected.delete(idea.id);
				}
			});

			const label = row.createDiv({ cls: 'powerlink-bulk-label' });
			label.createSpan({
				text: idea.url,
				cls: 'powerlink-bulk-url',
			});
			if (idea.title) {
				label.createSpan({
					text: idea.title,
					cls: 'powerlink-bulk-title',
				});
			}

			label.addEventListener('click', () => {
				checkbox.checked = !checkbox.checked;
				if (checkbox.checked) {
					this.selected.add(idea.id);
				} else {
					this.selected.delete(idea.id);
				}
			});
		}
	}

	private selectAll(): void {
		this.selected = new Set(this.ideas.map((i) => i.id));
		this.renderList();
	}

	private selectNone(): void {
		this.selected.clear();
		this.renderList();
	}

	private submit(): void {
		if (this.selected.size === 0) {
			new Notice('Select at least one URL to import');
			return;
		}

		const selections = this.ideas
			.filter((i) => this.selected.has(i.id))
			.map((i) => ({ id: i.id, url: i.url, title: i.title }));

		this.close();
		this.onSubmit(selections);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export interface BulkProgressCallbacks {
	onCancel: () => void;
}

export class BulkProgressModal extends Modal {
	private total: number;
	private current = 0;
	private currentUrl = '';
	private cancelled = false;
	private callbacks: BulkProgressCallbacks;
	private progressEl: HTMLElement | null = null;
	private urlEl: HTMLElement | null = null;

	constructor(app: App, total: number, callbacks: BulkProgressCallbacks) {
		super(app);
		this.total = total;
		this.callbacks = callbacks;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('powerlink-modal', 'powerlink-progress-modal');

		contentEl.createEl('h2', { text: 'Bulk import in progress' });

		this.progressEl = contentEl.createEl('p', {
			text: `0 / ${this.total}`,
			cls: 'powerlink-progress-count',
		});

		this.urlEl = contentEl.createEl('p', {
			text: 'Starting…',
			cls: 'powerlink-progress-url',
		});

		const actions = contentEl.createDiv({ cls: 'powerlink-actions' });
		const cancelBtn = actions.createEl('button', {
			text: 'Cancel',
			cls: 'mod-warning',
		});
		cancelBtn.addEventListener('click', () => {
			this.cancelled = true;
			this.callbacks.onCancel();
			cancelBtn.disabled = true;
			cancelBtn.textContent = 'Cancelling…';
		});
	}

	updateProgress(current: number, url: string): void {
		this.current = current;
		this.currentUrl = url;
		if (this.progressEl) {
			this.progressEl.textContent = `${current} / ${this.total}`;
		}
		if (this.urlEl) {
			this.urlEl.textContent = url;
		}
	}

	isCancelled(): boolean {
		return this.cancelled;
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export interface BulkSummary {
	created: number;
	failed: number;
	deleted: number;
	failures: Array<{ url: string; error: string }>;
	cancelled: boolean;
}

export class BulkSummaryModal extends Modal {
	private summary: BulkSummary;

	constructor(app: App, summary: BulkSummary) {
		super(app);
		this.summary = summary;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('powerlink-modal', 'powerlink-summary-modal');

		const title = this.summary.cancelled
			? 'Bulk import cancelled'
			: 'Bulk import complete';
		contentEl.createEl('h2', { text: title });

		const stats = contentEl.createDiv({ cls: 'powerlink-summary-stats' });
		stats.createEl('p', { text: `Created: ${this.summary.created}` });
		stats.createEl('p', { text: `Failed: ${this.summary.failed}` });
		if (this.summary.deleted > 0) {
			stats.createEl('p', { text: `Deleted from Ideas: ${this.summary.deleted}` });
		}

		if (this.summary.failures.length > 0) {
			contentEl.createEl('h3', { text: 'Failures' });
			const list = contentEl.createEl('ul', { cls: 'powerlink-summary-failures' });
			for (const f of this.summary.failures.slice(0, 10)) {
				const li = list.createEl('li');
				li.createSpan({ text: f.url, cls: 'powerlink-bulk-url' });
				li.createSpan({ text: `: ${f.error}`, cls: 'powerlink-error' });
			}
			if (this.summary.failures.length > 10) {
				list.createEl('li', {
					text: `…and ${this.summary.failures.length - 10} more`,
					cls: 'powerlink-muted',
				});
			}
		}

		const actions = contentEl.createDiv({ cls: 'powerlink-actions' });
		const closeBtn = actions.createEl('button', {
			text: 'Close',
			cls: 'mod-cta',
		});
		closeBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
