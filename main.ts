import { 
    App, 
    Plugin, 
    PluginSettingTab, 
    Setting, 
    normalizePath, 
    Notice, 
    requestUrl,
    addIcon,
    TFile
} from 'obsidian';
import { Logger } from './utils/logger';

interface BeeObsidianSettings{
	apiKey: string;
	folderPath: string;
	startDate: string;
}

const DEFAULT_SETTINGS: BeeObsidianSettings = {
	apiKey: '',
	folderPath: 'Bee Daily',
	startDate: '2025-02-09'
}

interface BeeMessage {
    role: string;
    content: string;
}

interface BeeConversation {
    id: string;
    created_at: string;
    messages: BeeMessage[];
}

export default class BeePlugin extends Plugin {
	settings: BeeObsidianSettings;
	api: BeeAPI;

	async onload() {
		Logger.setApp(this.app);
		await Logger.log('Plugin loading...');
		await this.loadSettings();
		this.api = new BeeAPI(this.settings.apiKey, this.app);

		// Add settings tab
		this.addSettingTab(new BeeObsidianSettingTab(this.app, this));

		// Add ribbon icon for syncing
		this.addRibbonIcon('sync', 'Sync Bee Daily', async () => {
			await this.syncBeeDaily();
		});

		this.addRibbonIcon('messages', 'Sync Bee Conversations', async () => {
			await this.syncBeeConversations();
		});

		// Add command for syncing
		this.addCommand({
			id: 'sync-bee-daily',
			name: 'Sync Bee Daily',
			callback: async () => {
				await this.syncBeeDaily();
			}
		});

		this.addCommand({
			id: 'sync-bee-conversations',
			name: 'Sync Bee Conversations',
			callback: async () => {
				await this.syncBeeConversations();
			}
		});
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		if (this.api) {
			this.api.setApiKey(this.settings.apiKey);
		}
	}

	async syncBeeDaily() {
		if (!this.settings.apiKey) {
			new Notice('Please set your Bee API key in settings');
			return;
		}

		try {
			const folderPath = normalizePath(this.settings.folderPath);
			await this.ensureFolderExists(folderPath);

			new Notice('Starting Bee Daily sync...');
			
			// Get all entries without date filtering
			const logs = await this.api.getBeeDaily();

			if (logs && logs.length > 0) {
				// Group entries by date
				const entriesByDate = new Map<string, any[]>();
				
				logs.forEach(log => {
					const dateStr = new Date(log.date).toISOString().split('T')[0];
					if (!entriesByDate.has(dateStr)) {
						entriesByDate.set(dateStr, []);
					}
					entriesByDate.get(dateStr)?.push(log);
				});

				// Write files for each date
				for (const [dateStr, dateEntries] of entriesByDate) {
					const content = `# ${dateStr}\n\n${dateEntries.map(entry => entry.content).join('\n\n')}`;
					const filePath = `${folderPath}/${dateStr}.md`;
					await this.app.vault.adapter.write(filePath, content);
					new Notice(`Synced entries for ${dateStr}`);
				}
			}

			new Notice('Bee Daily sync complete!');
		} catch (error) {
			console.error('Error syncing Bee Days:', error);
			new Notice('Error syncing Bee Days. Check console for details.');
		}
	}

	async syncBeeConversations() {
		if (!this.settings.apiKey) {
			new Notice('Please set your Bee API key in settings');
			return;
		}

		try {
			const folderPath = normalizePath(this.settings.folderPath);
			await this.ensureFolderExists(folderPath);

			new Notice('Starting Bee Conversations sync...');
			
			const conversations = await this.api.getBeeConversations();

			if (conversations && conversations.length > 0) {
				const content = conversations.map((conv: BeeConversation) => `
## ${new Date(conv.created_at).toISOString()}

### Conversation ID: ${conv.id}

${conv.messages.map((msg: BeeMessage) => `- **${msg.role}**: ${msg.content}`).join('\n')}
				`).join('\n---\n');

				const filePath = `${folderPath}/conversations.md`;
				await this.app.vault.adapter.write(filePath, `# Bee Conversations\n\n${content}`);
				new Notice(`Synced ${conversations.length} conversations`);
			}

			new Notice('Bee Conversations sync complete!');
		} catch (error) {
			console.error('Error syncing Bee Conversations:', error);
			new Notice('Error syncing Bee Conversations. Check console for details.');
		}
	}

	private async ensureFolderExists(path: string) {
		const folderExists = await this.app.vault.adapter.exists(path);
		if (!folderExists) {
			await this.app.vault.createFolder(path);
		}
	}

	private async getLastSyncedDate(): Promise<Date | null> {
		const folderPath = normalizePath(this.settings.folderPath);
		try {
			const files = await this.app.vault.adapter.list(folderPath);
			const dates = files.files
				.map(file => file.split('/').pop()?.replace('.md', ''))
				.filter(date => date && /^\d{4}-\d{2}-\d{2}$/.test(date))
				.map(date => new Date(date as string))
				.sort((a, b) => b.getTime() - a.getTime());

			return dates.length > 0 ? dates[0] : null;
		} catch {
			return null;
		}
	}
}

// Rename SettingTab to BeeObsidianSettingTab
class BeeObsidianSettingTab extends PluginSettingTab {
	plugin: BeePlugin;

	constructor(app: App, plugin: BeePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Your Bee AI API key')
			.addText(text => text
				.setPlaceholder('Enter your BeeAPI key')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Folder Path')
			.setDesc('Where to store the Bee Daily files')
			.addText(text => text
				.setPlaceholder('Folder path')
				.setValue(this.plugin.settings.folderPath)
				.onChange(async (value) => {
					this.plugin.settings.folderPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Start Date')
			.setDesc('Default start date for initial sync (YYYY-MM-DD)')
			.addText(text => text
				.setPlaceholder('YYYY-MM-DD')
				.setValue(this.plugin.settings.startDate)
				.onChange(async (value) => {
					this.plugin.settings.startDate = value;
					await this.plugin.saveSettings();
				}));
	}
}

class BeeAPI {
	private apiKey: string;
	private baseUrl = 'https://api.bee.computer';
	private batchSize = 10;
	private app: App;

	constructor(apiKey: string, app: App) {
		this.apiKey = apiKey;
		this.app = app;
	}

	setApiKey(apiKey: string) {
		this.apiKey = apiKey;
	}

	// Add this method to the BeeAPI class
	private async logToFile(message: string) {
		try {
			const logFolderPath = 'Bee Daily';
			const logFilePath = `${logFolderPath}/api-logs.md`;
			
			// First ensure the folder exists
			const folderExists = await this.app.vault.adapter.exists(logFolderPath);
			if (!folderExists) {
				console.log('Creating log folder:', logFolderPath);
				await this.app.vault.createFolder(logFolderPath);
			}

			const timestamp = new Date().toISOString();
			const logMessage = `\n## ${timestamp}\n${message}\n`;
			
			console.log('Writing to log file:', logFilePath);
			console.log('Log message:', logMessage);
			
			// Append to existing log file or create new one
			const exists = await this.app.vault.adapter.exists(logFilePath);
			if (exists) {
				console.log('Log file exists, appending content');
				const currentContent = await this.app.vault.adapter.read(logFilePath);
				await this.app.vault.adapter.write(logFilePath, currentContent + logMessage);
			} else {
				console.log('Creating new log file');
				await this.app.vault.adapter.write(logFilePath, logMessage);
			}
			
			console.log('Successfully wrote to log file');
		} catch (error) {
			console.error('Failed to write to log file:', error);
			console.error('Error details:', {
				name: error.name,
				message: error.message,
				stack: error.stack
			});
		}
	}

	async getBeeDaily(): Promise<any[]> {
		const allBeeDaily: any[] = [];
		let currentPage = 1;
		let totalPages = 1;

		do {
			const params = new URLSearchParams({
				page: currentPage.toString(),
				limit: this.batchSize.toString()
			});

			const apiUrl = `${this.baseUrl}/v1/me/conversations?${params.toString()}`;
			await this.logToFile(`
=== BEE API REQUEST ===
URL: ${apiUrl}
Page: ${currentPage}
Batch Size: ${this.batchSize}
			`);

			try {
				const response = await requestUrl({
					url: apiUrl,
					method: 'GET',
					headers: {
						'X-API-Key': this.apiKey,
						'Content-Type': 'application/json'
					}
				});

				await this.logToFile(`
=== BEE API RESPONSE ===
Status: ${response.status}
Response: ${JSON.stringify(response.json, null, 2)}
				`);

				if (!response.json) {
					throw new Error('Invalid response format');
				}

				const data = response.json;
				const dailyinfo = data.data || [];
				allBeeDaily.push(...dailyinfo);

				// Update pagination info
				currentPage = data.meta?.currentPage || 1;
				totalPages = data.meta?.totalPages || 1;
				currentPage++;

			} catch (error) {
				await this.logToFile(`
=== BEE API ERROR ===
Error: ${error.message}
Stack: ${error.stack}
				`);
				throw error;
			}
		} while (currentPage <= totalPages);

		return allBeeDaily;
	}

	async getBeeConversations(): Promise<BeeConversation[]> {
		const apiUrl = `${this.baseUrl}/v1/me/conversations`;
		
		await this.logToFile(`
=== BEE API REQUEST ===
URL: ${apiUrl}
Method: GET
Headers:
  Accept: application/json
  X-API-Key: [REDACTED]
		`);

		try {
			const response = await requestUrl({
				url: apiUrl,
				method: 'GET',
				headers: {
					'X-API-Key': this.apiKey,
					'Accept': 'application/json'
				}
			});

			await this.logToFile(`
=== BEE API RESPONSE ===
Status: ${response.status}
Response: ${JSON.stringify(response.json, null, 2)}
			`);

			if (!response.json) {
				throw new Error('Invalid response format');
			}

			return response.json as BeeConversation[];

		} catch (error) {
			await this.logToFile(`
=== BEE API ERROR ===
Error: ${error.message}
Stack: ${error.stack}
			`);
			throw error;
		}
	}
}
