/**
 * Hanzo Cloud Integration Configuration
 *
 * This module configures the platform to work as a project launcher
 * for Hanzo Cloud, allowing seamless deployment of applications
 * to the Hanzo Cloud infrastructure.
 */

export const HANZO_CLOUD_CONFIG = {
  // API endpoint for Hanzo Cloud console
  apiEndpoint: process.env.HANZO_CLOUD_API_URL || "https://api.hanzo.ai",

  // Console URL for management interface
  consoleUrl: process.env.HANZO_CLOUD_CONSOLE_URL || "https://console.hanzo.ai",

  // Deployment targets
  deploymentTargets: {
    local: {
      name: "Local Docker",
      description: "Deploy to local Docker environment",
      enabled: !process.env.IS_CLOUD,
      type: "docker" as const,
    },
    hanzoCloud: {
      name: "Hanzo Cloud",
      description: "Deploy to Hanzo Cloud infrastructure",
      enabled: true,
      type: "cloud" as const,
      regions: [
        { id: "us-west-1", name: "US West", endpoint: "https://us-west-1.hanzo.ai" },
        { id: "us-east-1", name: "US East", endpoint: "https://us-east-1.hanzo.ai" },
        { id: "eu-west-1", name: "EU West", endpoint: "https://eu-west-1.hanzo.ai" },
      ],
    },
  },

  // Project templates optimized for Hanzo Cloud
  projectTemplates: {
    nextjs: {
      name: "Next.js Application",
      description: "Full-stack React application with Next.js",
      repository: "https://github.com/hanzoai/nextjs-template",
      buildpack: "nodejs",
      defaultEnv: {
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
    api: {
      name: "API Service",
      description: "RESTful API service with Express/Fastify",
      repository: "https://github.com/hanzoai/api-template",
      buildpack: "nodejs",
      defaultEnv: {
        NODE_ENV: "production",
      },
    },
    python: {
      name: "Python Application",
      description: "Python web application with FastAPI/Django",
      repository: "https://github.com/hanzoai/python-template",
      buildpack: "python",
      defaultEnv: {
        PYTHONUNBUFFERED: "1",
      },
    },
    static: {
      name: "Static Site",
      description: "Static website with CDN optimization",
      repository: "https://github.com/hanzoai/static-template",
      buildpack: "static",
      defaultEnv: {},
    },
  },

  // Features specific to Hanzo Cloud deployment
  cloudFeatures: {
    autoScaling: {
      enabled: true,
      minReplicas: 1,
      maxReplicas: 10,
      targetCPU: 70,
    },
    cdn: {
      enabled: true,
      provider: "cloudflare",
    },
    monitoring: {
      enabled: true,
      provider: "datadog",
    },
    backup: {
      enabled: true,
      schedule: "0 2 * * *", // Daily at 2 AM
      retention: 30, // days
    },
  },

  // Integration settings
  integration: {
    // Use shared authentication with Hanzo Cloud console
    sharedAuth: {
      enabled: process.env.HANZO_SHARED_AUTH === "true",
      authUrl: process.env.BETTER_AUTH_URL || "https://auth.hanzo.ai",
      clientId: process.env.IAM_CLIENT_ID,
      clientSecret: process.env.IAM_CLIENT_SECRET,
    },

    // Webhook endpoints for deployment events
    webhooks: {
      deploymentStarted: "/v1/webhooks/deployment-started",
      deploymentCompleted: "/v1/webhooks/deployment-completed",
      deploymentFailed: "/v1/webhooks/deployment-failed",
    },
  },
};

// Helper function to check if Hanzo Cloud integration is enabled
export const isHanzoCloudEnabled = () => {
  return process.env.HANZO_CLOUD_ENABLED === "true" || process.env.IS_CLOUD === "true";
};

// Helper function to get deployment target
export const getDeploymentTarget = () => {
  if (isHanzoCloudEnabled()) {
    return HANZO_CLOUD_CONFIG.deploymentTargets.hanzoCloud;
  }
  return HANZO_CLOUD_CONFIG.deploymentTargets.local;
};