export class Logger {
    private static logFile = 'Bee Daily/build-logs.md';
    private static app: any;

    static setApp(app: any) {
        this.app = app;
    }

    static async log(message: string, type: 'info' | 'error' | 'debug' = 'info') {
        const timestamp = new Date().toISOString();
        const logMessage = `\n## ${timestamp} - ${type.toUpperCase()}\n${message}\n`;
        
        try {
            const exists = await this.app.vault.adapter.exists(this.logFile);
            if (exists) {
                const currentContent = await this.app.vault.adapter.read(this.logFile);
                await this.app.vault.adapter.write(this.logFile, currentContent + logMessage);
            } else {
                const folder = this.logFile.split('/')[0];
                const folderExists = await this.app.vault.adapter.exists(folder);
                if (!folderExists) {
                    await this.app.vault.createFolder(folder);
                }
                await this.app.vault.adapter.write(this.logFile, logMessage);
            }
            
            // Also log to console for development
            console.log(`[${type.toUpperCase()}] ${message}`);
        } catch (error) {
            console.error('Logging failed:', error);
        }
    }
}