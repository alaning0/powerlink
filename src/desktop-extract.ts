/**
 * Desktop-only media extraction via yt-dlp + OpenAI Whisper.
 * Call only when Platform.isDesktopApp is true.
 */

export interface ExtractOptions {
	url: string;
	ytDlpPath: string;
	ffmpegLocation: string;
	cookiesFile: string;
	cookiesFromBrowser: string;
	openaiApiKey: string;
	whisperModel: string;
	onStatus?: (message: string) => void;
}

export interface ExtractResult {
	transcript: string;
	source: 'captions' | 'whisper';
	titleHint?: string;
}

const MAX_TRANSCRIPT_CHARS = 24_000;

export function isMediaUrl(url: string): boolean {
	try {
		const host = new URL(url.trim()).hostname.toLowerCase();
		return (
			host === 'youtu.be' ||
			host.endsWith('youtube.com') ||
			host.endsWith('instagram.com')
		);
	} catch {
		return false;
	}
}

function nodeRequire(name: string): unknown {
	// Desktop-only: load Node builtins at runtime so mobile bundles stay safe.
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node require for desktop-only modules
	return require(name);
}

/** Prefer cookies file; fall back to --cookies-from-browser. */
function cookieArgs(cookiesFile: string, cookiesFromBrowser: string): string[] {
	const file = cookiesFile.trim().replace(/^~(?=\/)/, () => {
		const os = nodeRequire('os') as typeof import('os');
		return os.homedir();
	});
	if (file) {
		const fs = nodeRequire('fs') as typeof import('fs');
		if (!fs.existsSync(file)) {
			throw new Error(`Cookies file not found: ${file}`);
		}
		return ['--cookies', file];
	}
	const browser = cookiesFromBrowser.trim();
	return browser ? ['--cookies-from-browser', browser] : [];
}

function ffmpegArgs(ffmpegLocation: string): string[] {
	const loc = ffmpegLocation.trim().replace(/^~(?=\/)/, () => {
		const os = nodeRequire('os') as typeof import('os');
		return os.homedir();
	});
	return loc ? ['--ffmpeg-location', loc] : [];
}

function spawnEnv(): Record<string, string | undefined> {
	const path = nodeRequire('path') as typeof import('path');
	const extras = ['/opt/homebrew/bin', '/usr/local/bin'];
	const current = process.env.PATH ?? '';
	const parts = current.split(path.delimiter).filter(Boolean);
	for (const dir of extras) {
		if (!parts.includes(dir)) parts.unshift(dir);
	}
	return { ...process.env, PATH: parts.join(path.delimiter) };
}

function parseVtt(vttText: string): string {
	const lines: string[] = [];
	const seen = new Set<string>();

	for (const raw of vttText.split(/\r?\n/)) {
		let line = raw.trim();
		if (
			!line ||
			line.startsWith('WEBVTT') ||
			line.startsWith('Kind:') ||
			line.startsWith('Language:')
		) {
			continue;
		}
		if (line.includes('-->') || /^\d+$/.test(line)) {
			continue;
		}

		line = line.replace(/<[^>]+>/g, '');
		line = line.replace(/\s+/g, ' ').trim();
		if (!line || seen.has(line)) continue;

		const last = lines[lines.length - 1];
		if (last && (line.includes(last) || last.includes(line))) {
			if (line.length > last.length) {
				seen.delete(last);
				lines[lines.length - 1] = line;
				seen.add(line);
			}
			continue;
		}

		seen.add(line);
		lines.push(line);
	}

	return lines.join(' ').trim();
}

async function runCommand(
	bin: string,
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	const { spawn } = nodeRequire('child_process') as typeof import('child_process');

	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, {
			shell: false,
			env: spawnEnv(),
		});
		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (chunk: string | Uint8Array) => {
			stdout += chunk.toString();
		});
		child.stderr?.on('data', (chunk: string | Uint8Array) => {
			stderr += chunk.toString();
		});
		child.on('error', (err) => {
			reject(
				new Error(
					`Failed to run ${bin}: ${err.message}. Is yt-dlp installed and on PATH?`,
				),
			);
		});
		child.on('close', (code) => {
			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				const detail = (stderr || stdout).trim().slice(-800);
				reject(
					new Error(
						`${bin} exited with code ${code}${detail ? `: ${detail}` : ''}`,
					),
				);
			}
		});
	});
}

async function dumpTitle(
	ytDlpPath: string,
	url: string,
	ffmpegLocation: string,
	cookiesFile: string,
	cookiesFromBrowser: string,
): Promise<string | undefined> {
	try {
		const { stdout } = await runCommand(ytDlpPath, [
			'--dump-json',
			'--no-download',
			...ffmpegArgs(ffmpegLocation),
			...cookieArgs(cookiesFile, cookiesFromBrowser),
			url,
		]);
		const meta = JSON.parse(stdout) as { title?: string };
		return meta.title?.trim() || undefined;
	} catch {
		return undefined;
	}
}

async function downloadCaptions(
	ytDlpPath: string,
	url: string,
	ffmpegLocation: string,
	cookiesFile: string,
	cookiesFromBrowser: string,
	workDir: string,
): Promise<string | null> {
	const path = nodeRequire('path') as typeof import('path');
	const fs = nodeRequire('fs') as typeof import('fs');
	const outtmpl = path.join(workDir, 'subs');

	try {
		await runCommand(ytDlpPath, [
			'--write-auto-sub',
			'--write-sub',
			'--sub-lang',
			'en.*,en',
			'--skip-download',
			'--convert-subs',
			'vtt',
			...ffmpegArgs(ffmpegLocation),
			...cookieArgs(cookiesFile, cookiesFromBrowser),
			'-o',
			outtmpl,
			url,
		]);
	} catch {
		return null;
	}

	const files = fs
		.readdirSync(workDir)
		.filter((f) => f.startsWith('subs') && f.endsWith('.vtt'))
		.map((f) => path.join(workDir, f))
		.sort();

	if (files.length === 0) return null;

	const first = files[0];
	if (!first) return null;
	const text = fs.readFileSync(first, 'utf8');
	const parsed = parseVtt(text);
	return parsed || null;
}

async function downloadAudio(
	ytDlpPath: string,
	url: string,
	ffmpegLocation: string,
	cookiesFile: string,
	cookiesFromBrowser: string,
	workDir: string,
): Promise<string> {
	const path = nodeRequire('path') as typeof import('path');
	const fs = nodeRequire('fs') as typeof import('fs');
	const audioPath = path.join(workDir, 'audio.mp3');

	await runCommand(ytDlpPath, [
		'-x',
		'--audio-format',
		'mp3',
		'--audio-quality',
		'0',
		...ffmpegArgs(ffmpegLocation),
		...cookieArgs(cookiesFile, cookiesFromBrowser),
		'-o',
		audioPath,
		url,
	]);

	if (fs.existsSync(audioPath)) {
		return audioPath;
	}

	const matches = fs
		.readdirSync(workDir)
		.filter((f) => f.startsWith('audio'))
		.map((f) => path.join(workDir, f));
	if (matches.length === 0) {
		throw new Error('Failed to download audio for transcription');
	}
	return matches[0]!;
}

async function transcribeWithWhisper(
	audioPath: string,
	apiKey: string,
	whisperModel: string,
): Promise<string> {
	const fs = nodeRequire('fs') as typeof import('fs');
	const path = nodeRequire('path') as typeof import('path');

	const buffer = fs.readFileSync(audioPath);
	const filename = path.basename(audioPath);
	const blob = new Blob([new Uint8Array(buffer)], { type: 'audio/mpeg' });

	const form = new FormData();
	form.append('file', blob, filename);
	form.append('model', whisperModel || 'whisper-1');

	const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
		body: form,
	});

	const data = (await res.json()) as { text?: string; error?: { message?: string } };
	if (!res.ok) {
		throw new Error(
			data.error?.message ?? `Whisper request failed (${res.status})`,
		);
	}
	const text = data.text?.trim();
	if (!text) {
		throw new Error('Empty transcript from Whisper');
	}
	return text;
}

function trimTranscript(text: string): string {
	if (text.length <= MAX_TRANSCRIPT_CHARS) return text;
	return (
		text.slice(0, MAX_TRANSCRIPT_CHARS) +
		'\n\n[Transcript truncated for length]'
	);
}

function cleanupDir(workDir: string): void {
	try {
		const fs = nodeRequire('fs') as typeof import('fs');
		fs.rmSync(workDir, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors
	}
}

export async function extractMediaTranscript(
	options: ExtractOptions,
): Promise<ExtractResult> {
	const {
		url,
		ytDlpPath,
		ffmpegLocation,
		cookiesFile,
		cookiesFromBrowser,
		openaiApiKey,
		whisperModel,
		onStatus,
	} = options;

	const fs = nodeRequire('fs') as typeof import('fs');
	const os = nodeRequire('os') as typeof import('os');
	const path = nodeRequire('path') as typeof import('path');

	const bin = ytDlpPath.trim() || 'yt-dlp';
	const workDir = path.join(
		os.tmpdir(),
		`powerlink-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	fs.mkdirSync(workDir, { recursive: true });

	try {
		onStatus?.('Fetching video metadata…');
		const titleHint = await dumpTitle(
			bin,
			url.trim(),
			ffmpegLocation,
			cookiesFile,
			cookiesFromBrowser,
		);

		onStatus?.('Downloading captions…');
		const captions = await downloadCaptions(
			bin,
			url.trim(),
			ffmpegLocation,
			cookiesFile,
			cookiesFromBrowser,
			workDir,
		);
		if (captions) {
			return {
				transcript: trimTranscript(captions),
				source: 'captions',
				titleHint,
			};
		}

		onStatus?.('No captions — downloading audio for Whisper…');
		if (!openaiApiKey.trim()) {
			throw new Error(
				'No captions found and OpenAI API key is missing for Whisper',
			);
		}

		const audioPath = await downloadAudio(
			bin,
			url.trim(),
			ffmpegLocation,
			cookiesFile,
			cookiesFromBrowser,
			workDir,
		);

		onStatus?.('Transcribing with Whisper…');
		const transcript = await transcribeWithWhisper(
			audioPath,
			openaiApiKey.trim(),
			whisperModel,
		);

		return {
			transcript: trimTranscript(transcript),
			source: 'whisper',
			titleHint,
		};
	} finally {
		cleanupDir(workDir);
	}
}
