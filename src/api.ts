import { requestUrl } from 'obsidian';

export interface Idea {
	id: number;
	title: string;
	description: string;
	starred: boolean;
	created_at: string;
	updated_at: string;
}

export interface GenerateResult {
	filename: string;
	body: string;
}

export interface FetchedPage {
	title: string;
	text: string;
}

const SYSTEM_PROMPT = `You help turn a URL into an Obsidian note.
You will be given the URL, a page title hint (when available), and extracted page text.

Return ONLY a JSON object with exactly these keys:
- "filename": a clear, human-readable note title used as the markdown filename (no path, no .md extension, no quotes). Prefer the real article/page title. Clean site suffixes like " | Site Name" or " - Site Name". Keep it specific and useful in a vault (roughly 3–12 words). Use spaces and normal capitalization, not kebab-case or slug-case. Never use generic names like "article", "untitled", "summary", "link", or "powerlink".
- "body": markdown content for the note based on the user's prompt and the page content (do NOT include the URL itself; the app will prepend it)

Do not wrap the JSON in markdown fences.`;

const TRANSCRIPT_SYSTEM_PROMPT = `You help turn a video/audio URL into an Obsidian note.
You will be given the URL, an optional title hint, and a transcript (from captions or speech-to-text).

Return ONLY a JSON object with exactly these keys:
- "filename": a clear, human-readable note title used as the markdown filename (no path, no .md extension, no quotes). Prefer the real video title when provided. Keep it specific and useful in a vault (roughly 3–12 words). Use spaces and normal capitalization, not kebab-case or slug-case. Never use generic names like "article", "untitled", "summary", "link", "video", or "powerlink".
- "body": markdown content for the note based on the user's prompt and the transcript (do NOT include the URL itself; the app will prepend it)

Do not wrap the JSON in markdown fences.`;

/** Cap page text sent to the model (rough character budget). */
const MAX_PAGE_CHARS = 24_000;

function isHttpUrl(value: string): boolean {
	return /^https?:\/\//i.test(value.trim());
}

function decodeEntities(text: string): string {
	return text
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&#(\d+);/g, (_, n: string) =>
			String.fromCharCode(Number(n)),
		)
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
			String.fromCharCode(parseInt(hex, 16)),
		)
		.replace(/&[a-z]+;/gi, ' ');
}

function cleanTitleCandidate(raw: string): string {
	let title = decodeEntities(raw).replace(/\s+/g, ' ').trim();
	// Strip common site-name suffixes
	title = title.replace(/\s+[|\u2013\u2014-]\s+[^|\u2013\u2014-]{1,40}$/u, '').trim();
	return title;
}

/** Prefer og:title / twitter:title / <title> / first h1. */
export function extractPageTitle(html: string): string {
	const metaPatterns = [
		/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
		/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
		/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
		/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["']/i,
	];
	for (const pattern of metaPatterns) {
		const match = html.match(pattern);
		if (match?.[1]?.trim()) {
			return cleanTitleCandidate(match[1]);
		}
	}

	const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (titleTag?.[1]?.trim()) {
		return cleanTitleCandidate(titleTag[1]);
	}

	const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
	if (h1?.[1]) {
		const plain = h1[1].replace(/<[^>]+>/g, ' ');
		if (plain.trim()) {
			return cleanTitleCandidate(plain);
		}
	}

	return '';
}

/** Strip HTML to readable plain text for the model. */
export function htmlToText(html: string): string {
	let text = html;

	// Drop non-content blocks early
	text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
	text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
	text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
	text = text.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
	text = text.replace(/<!--[\s\S]*?-->/g, ' ');

	// Prefer main/article when present
	const mainMatch =
		text.match(/<article[\s\S]*?<\/article>/i) ??
		text.match(/<main[\s\S]*?<\/main>/i);
	if (mainMatch?.[0]) {
		text = mainMatch[0];
	}

	text = text.replace(/<br\s*\/?>/gi, '\n');
	text = text.replace(
		/<\/(p|div|h[1-6]|li|tr|section|header|footer)>/gi,
		'\n',
	);
	text = text.replace(/<li[^>]*>/gi, '- ');
	text = text.replace(/<[^>]+>/g, ' ');
	text = decodeEntities(text);

	text = text.replace(/[ \t]+\n/g, '\n');
	text = text.replace(/\n{3,}/g, '\n\n');
	text = text.replace(/[ \t]{2,}/g, ' ');
	return text.trim();
}

export async function fetchPage(url: string): Promise<FetchedPage> {
	const res = await requestUrl({
		url,
		method: 'GET',
		headers: {
			Accept:
				'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'User-Agent':
				'Mozilla/5.0 (compatible; PowerlinkObsidianPlugin/1.0)',
		},
	});

	const contentType = (res.headers['content-type'] ?? '').toLowerCase();
	const raw =
		typeof res.text === 'string' && res.text.length > 0
			? res.text
			: typeof res.json === 'string'
				? res.json
				: '';

	if (!raw) {
		throw new Error('Fetched page was empty');
	}

	const isHtml =
		contentType.includes('text/html') ||
		/^\s*</.test(raw) ||
		/<html[\s>]/i.test(raw);

	let title = '';
	let text: string;
	if (isHtml) {
		title = extractPageTitle(raw);
		text = htmlToText(raw);
	} else if (
		contentType.includes('application/json') ||
		contentType.includes('text/plain') ||
		contentType.includes('text/markdown')
	) {
		text = raw.trim();
	} else {
		title = extractPageTitle(raw);
		text = htmlToText(raw);
	}

	if (!text) {
		throw new Error('Could not extract readable text from the page');
	}

	if (text.length > MAX_PAGE_CHARS) {
		text =
			text.slice(0, MAX_PAGE_CHARS) +
			'\n\n[Page content truncated for length]';
	}
	return { title, text };
}

export interface IdeaLink {
	id: number;
	url: string;
}

export async function fetchRecentIdeaUrls(
	ideasApiUrl: string,
	limit = 10,
): Promise<IdeaLink[]> {
	const res = await requestUrl({
		url: ideasApiUrl,
		method: 'GET',
	});

	const data = res.json as { ideas?: Idea[] };
	const ideas = Array.isArray(data?.ideas) ? data.ideas : [];

	const links: IdeaLink[] = [];
	const seen = new Set<string>();
	for (const idea of ideas) {
		const title = (idea.title ?? '').trim();
		if (!isHttpUrl(title) || seen.has(title)) continue;
		seen.add(title);
		links.push({ id: idea.id, url: title });
		if (links.length >= limit) break;
	}
	return links;
}

/** DELETE /api/ideas/:id — ideasApiUrl may be the list endpoint or a base. */
export async function deleteIdea(
	ideasApiUrl: string,
	ideaId: number,
): Promise<void> {
	const base = ideasApiUrl.trim().replace(/\/+$/, '');
	const url = /\/ideas\/?\d*$/i.test(base)
		? base.replace(/\/ideas\/?\d*$/i, `/ideas/${ideaId}`)
		: `${base}/ideas/${ideaId}`;

	const res = await requestUrl({
		url,
		method: 'DELETE',
	});

	const data = res.json as { ok?: boolean; error?: string; id?: number };
	if (data?.error) {
		throw new Error(data.error);
	}
	if (data && data.ok === false) {
		throw new Error(`Failed to delete idea ${ideaId}`);
	}
}

function parseGenerateJson(raw: string): GenerateResult {
	let text = raw.trim();
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence?.[1]) {
		text = fence[1].trim();
	}

	const parsed = JSON.parse(text) as Partial<GenerateResult>;
	if (typeof parsed.filename !== 'string' || typeof parsed.body !== 'string') {
		throw new Error('OpenAI response missing filename or body');
	}
	return {
		filename: parsed.filename,
		body: parsed.body,
	};
}

function isWeakFilename(name: string): boolean {
	const n = name.trim().toLowerCase();
	if (!n) return true;
	if (n.length < 3) return true;
	return /^(article|untitled|summary|link|powerlink|note|page|document|new note)(\s+\d{4}-\d{2}-\d{2})?$/.test(
		n,
	);
}

/** Prefer model title; fall back to page title / hostname if weak. */
export function chooseFilename(
	modelFilename: string,
	pageTitle: string,
	url: string,
): string {
	const fromModel = sanitizeFilename(modelFilename);
	if (!isWeakFilename(fromModel)) {
		return fromModel;
	}

	const fromPage = sanitizeFilename(pageTitle);
	if (!isWeakFilename(fromPage)) {
		return fromPage;
	}

	try {
		const host = new URL(url).hostname.replace(/^www\./, '');
		return sanitizeFilename(host);
	} catch {
		return sanitizeFilename('powerlink');
	}
}

export async function generateFromUrl(options: {
	apiKey: string;
	model: string;
	prompt: string;
	url: string;
}): Promise<GenerateResult> {
	const { apiKey, model, prompt, url } = options;
	if (!apiKey) {
		throw new Error('OpenAI API key is not set in Powerlink settings');
	}

	const page = await fetchPage(url.trim());

	const res = await requestUrl({
		url: 'https://api.openai.com/v1/chat/completions',
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model: model || 'gpt-4o-mini',
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{
					role: 'user',
					content: [
						prompt.trim(),
						'',
						`URL: ${url.trim()}`,
						page.title
							? `Page title: ${page.title}`
							: 'Page title: (unknown — invent a specific title from the content)',
						'',
						'Page content:',
						page.text,
					].join('\n'),
				},
			],
		}),
	});

	const data = res.json as {
		choices?: Array<{ message?: { content?: string } }>;
		error?: { message?: string };
	};

	if (data.error?.message) {
		throw new Error(data.error.message);
	}

	const content = data.choices?.[0]?.message?.content;
	if (!content) {
		throw new Error('Empty response from OpenAI');
	}

	const parsed = parseGenerateJson(content);
	return {
		filename: chooseFilename(parsed.filename, page.title, url),
		body: parsed.body,
	};
}

export async function generateFromTranscript(options: {
	apiKey: string;
	model: string;
	prompt: string;
	url: string;
	transcript: string;
	titleHint?: string;
}): Promise<GenerateResult> {
	const { apiKey, model, prompt, url, transcript, titleHint } = options;
	if (!apiKey) {
		throw new Error('OpenAI API key is not set in Powerlink settings');
	}

	const res = await requestUrl({
		url: 'https://api.openai.com/v1/chat/completions',
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model: model || 'gpt-4o-mini',
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: TRANSCRIPT_SYSTEM_PROMPT },
				{
					role: 'user',
					content: [
						prompt.trim(),
						'',
						`URL: ${url.trim()}`,
						titleHint
							? `Title: ${titleHint}`
							: 'Title: (unknown — invent a specific title from the transcript)',
						'',
						'Transcript:',
						transcript.trim(),
					].join('\n'),
				},
			],
		}),
	});

	const data = res.json as {
		choices?: Array<{ message?: { content?: string } }>;
		error?: { message?: string };
	};

	if (data.error?.message) {
		throw new Error(data.error.message);
	}

	const content = data.choices?.[0]?.message?.content;
	if (!content) {
		throw new Error('Empty response from OpenAI');
	}

	const parsed = parseGenerateJson(content);
	return {
		filename: chooseFilename(parsed.filename, titleHint ?? '', url),
		body: parsed.body,
	};
}

export function sanitizeFilename(raw: string): string {
	let name = raw.trim();
	name = name.replace(/\.md$/i, '');
	name = name.replace(/[/\\:*?"<>|]/g, '');
	name = name.replace(/\s+/g, ' ').trim();
	// Soft length cap so filenames stay usable in Obsidian
	if (name.length > 120) {
		name = name.slice(0, 120).trim();
	}
	if (!name) {
		const stamp = new Date().toISOString().slice(0, 10);
		name = `powerlink ${stamp}`;
	}
	return name;
}

export function formatNoteContent(url: string, body: string): string {
	const trimmedBody = body.trim();
	return trimmedBody ? `${url.trim()}\n\n${trimmedBody}\n` : `${url.trim()}\n`;
}
