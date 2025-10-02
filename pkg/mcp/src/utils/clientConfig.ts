interface Config {
  platformUrl: string;
  authToken: string;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
}

class ConfigManager {
  private static instance: ConfigManager;
  private config: Config | null = null;

  private constructor() {}

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  getConfig(): Config {
    if (!this.config) {
      this.config = this.loadConfig();
    }
    return this.config;
  }

  private loadConfig(): Config {
    const platformUrl = process.env.PLATFORM_URL;
    const authToken = process.env.PLATFORM_API_KEY;

    if (!platformUrl) {
      throw new Error("Environment variable PLATFORM_URL is not defined");
    }
    if (!authToken) {
      throw new Error("Environment variable PLATFORM_API_KEY is not defined");
    }

    return {
      platformUrl,
      authToken,
      timeout: parseInt(process.env.PLATFORM_TIMEOUT || "30000", 10),
      retryAttempts: parseInt(process.env.PLATFORM_RETRY_ATTEMPTS || "3", 10),
      retryDelay: parseInt(process.env.PLATFORM_RETRY_DELAY || "1000", 10),
    };
  }
}

export function getClientConfig(): Config {
  return ConfigManager.getInstance().getConfig();
}
