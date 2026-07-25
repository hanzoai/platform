/**
 * Hanzo IAM (Identity and Access Management) Integration
 *
 * Provides unified authentication across all Hanzo properties:
 * - cloud.hanzo.ai
 * - platform.hanzo.ai
 * - hanzo.app
 * - Any other Hanzo applications
 *
 * Based on ~/work/hanzo/iam implementation
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@hanzo/platform/db";

export interface HanzoUser {
  id: string;
  email: string;
  name?: string;
  image?: string;
  role: "admin" | "user" | "developer" | "enterprise";
  organizations: HanzoOrganization[];
  permissions: string[];
  metadata: {
    createdAt: Date;
    lastLogin: Date;
    mfaEnabled: boolean;
    emailVerified: boolean;
  };
}

export interface HanzoOrganization {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member" | "viewer";
  plan: "free" | "pro" | "enterprise";
}

export interface HanzoSession {
  token: string;
  user: HanzoUser;
  expiresAt: Date;
  isValid: boolean;
}

class HanzoIAM {
  private iamEndpoint: string;
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor() {
    this.iamEndpoint = process.env.HANZO_IAM_ENDPOINT || "https://iam.hanzo.ai";
    this.clientId = process.env.HANZO_IAM_CLIENT_ID || "";
    this.clientSecret = process.env.HANZO_IAM_CLIENT_SECRET || "";
    this.redirectUri = process.env.HANZO_IAM_REDIRECT_URI || "https://platform.hanzo.ai/auth/callback";
  }

  /**
   * Initialize Better Auth with Hanzo IAM as the provider
   */
  initializeAuth() {
    return betterAuth({
      database: drizzleAdapter(db, {
        provider: "pg",
      }),
      emailAndPassword: {
        enabled: false, // Disabled - use Hanzo IAM instead
      },
      socialProviders: {
        github: {
          clientId: process.env.GITHUB_CLIENT_ID || "disabled",
          clientSecret: process.env.GITHUB_CLIENT_SECRET || "disabled",
          enabled: !!process.env.GITHUB_CLIENT_ID,
        },
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID || "disabled",
          clientSecret: process.env.GOOGLE_CLIENT_SECRET || "disabled",
          enabled: !!process.env.GOOGLE_CLIENT_ID,
        },
      },
      session: {
        expiresIn: 60 * 60 * 24 * 7, // 7 days
        updateAge: 60 * 60 * 24, // Update session every day
      },
      trustedOrigins: [
        "https://cloud.hanzo.ai",
        "https://platform.hanzo.ai",
        "https://hanzo.app",
        "https://iam.hanzo.ai",
        "http://localhost:3000", // Development
      ],
      advanced: {
        generateId: () => {
          // Use Hanzo IAM's ID generation
          return `usr_${crypto.randomUUID()}`;
        },
        crossSubDomainCookies: {
          enabled: true,
          domain: ".hanzo.ai",
        },
      },
    });
  }

  /**
   * Get authentication URL for Hanzo IAM
   */
  getAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "openid profile email organizations",
      state: state || crypto.randomUUID(),
    });

    return `${this.iamEndpoint}/v1/iam/oauth/authorize?${params}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCode(code: string): Promise<HanzoSession> {
    const response = await fetch(`${this.iamEndpoint}/v1/iam/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to exchange code for token");
    }

    const data = await response.json();

    // Get user info
    const userInfo = await this.getUserInfo(data.access_token);

    return {
      token: data.access_token,
      user: userInfo,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      isValid: true,
    };
  }

  /**
   * Get user info from access token
   */
  async getUserInfo(accessToken: string): Promise<HanzoUser> {
    const response = await fetch(`${this.iamEndpoint}/v1/iam/oauth/userinfo`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to get user info");
    }

    const data = await response.json();

    return {
      id: data.sub,
      email: data.email,
      name: data.name,
      image: data.picture,
      role: data.role || "user",
      organizations: data.organizations || [],
      permissions: data.permissions || [],
      metadata: {
        createdAt: new Date(data.created_at),
        lastLogin: new Date(data.last_login),
        mfaEnabled: data.mfa_enabled || false,
        emailVerified: data.email_verified || false,
      },
    };
  }

  /**
   * Validate session with Hanzo IAM.
   *
   * UserInfo is the validation endpoint — IAM has no /oauth/validate, and a
   * bearer that userinfo accepts is by definition a live session.
   */
  async validateSession(token: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.iamEndpoint}/v1/iam/oauth/userinfo`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Logout from Hanzo IAM
   */
  async logout(token: string): Promise<void> {
    await fetch(`${this.iamEndpoint}/v1/iam/oauth/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  /**
   * Sync user data with Hanzo IAM via the canonical bootstrap upsert.
   *
   * POST /v1/iam/admin/users/upsert — idempotent, keyed by (owner, name),
   * gated by a service token (Authorization: Bearer). Best-effort: never
   * throws, so a sync failure cannot break the login flow.
   */
  private async syncUserData(user: any): Promise<void> {
    const serviceToken =
      process.env.IAM_SERVICE_TOKEN ||
      process.env.HANZO_API_KEY ||
      process.env.KMS_SERVICE_TOKEN;
    if (!serviceToken) {
      // No service credential wired — skip rather than send an unauthenticated
      // request that would 401.
      return;
    }

    // Resolve (owner, name): the upsert is keyed by tenant slug + username.
    const primaryOrg = user.organizations?.[0];
    const owner = primaryOrg?.slug || primaryOrg?.name || "hanzo";
    const rawId: string = String(user.id ?? "");
    const name = rawId.includes("/") ? rawId.split("/").pop()! : rawId;
    if (!name) {
      return;
    }

    try {
      const res = await fetch(`${this.iamEndpoint}/v1/iam/admin/users/upsert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify({
          owner,
          name,
          email: user.email,
          displayName: user.name,
          emailVerified: user.metadata?.emailVerified ?? true,
          signupApplication: "platform",
          properties: { lastLogin: new Date().toISOString() },
        }),
      });
      if (!res.ok) {
        console.error(
          `[hanzo-iam] user upsert failed (status ${res.status}) for ${owner}/${name}`,
        );
      }
    } catch (err) {
      console.error("[hanzo-iam] user upsert request failed:", err);
    }
  }

  /**
   * Check if user has permission
   */
  hasPermission(user: HanzoUser, permission: string): boolean {
    return user.permissions.includes(permission) || user.role === "admin";
  }

  /**
   * Check if user has access to organization
   */
  hasOrgAccess(user: HanzoUser, orgId: string, requiredRole?: string): boolean {
    const org = user.organizations.find(o => o.id === orgId);
    if (!org) return false;

    if (!requiredRole) return true;

    const roleHierarchy = ["viewer", "member", "admin", "owner"];
    const userRoleIndex = roleHierarchy.indexOf(org.role);
    const requiredRoleIndex = roleHierarchy.indexOf(requiredRole);

    return userRoleIndex >= requiredRoleIndex;
  }

  /**
   * Get single sign-on URL for other Hanzo apps
   */
  getSSOUrl(targetApp: string, token: string): string {
    const apps: Record<string, string> = {
      cloud: "https://cloud.hanzo.ai",
      platform: "https://platform.hanzo.ai",
      app: "https://hanzo.app",
      docs: "https://docs.hanzo.ai",
      api: "https://api.hanzo.ai",
    };

    const targetUrl = apps[targetApp] || targetApp;

    return `${this.iamEndpoint}/sso?token=${token}&redirect=${encodeURIComponent(targetUrl)}`;
  }

  /**
   * Handle SSO callback
   */
  async handleSSOCallback(ssoToken: string): Promise<HanzoSession> {
    const response = await fetch(`${this.iamEndpoint}/sso/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: ssoToken,
        clientId: this.clientId,
      }),
    });

    if (!response.ok) {
      throw new Error("Invalid SSO token");
    }

    const data = await response.json();
    const userInfo = await this.getUserInfo(data.access_token);

    return {
      token: data.access_token,
      user: userInfo,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      isValid: true,
    };
  }
}

// Export singleton instance
export const hanzoIAM = new HanzoIAM();

// Export auth instance
export const auth = hanzoIAM.initializeAuth();

// Middleware for protecting routes
export async function requireAuth(req: Request): Promise<HanzoUser> {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");

  if (!token) {
    throw new Error("No authorization token provided");
  }

  const isValid = await hanzoIAM.validateSession(token);
  if (!isValid) {
    throw new Error("Invalid or expired token");
  }

  const user = await hanzoIAM.getUserInfo(token);
  return user;
}

// Middleware for requiring specific permissions
export function requirePermission(permission: string) {
  return async (req: Request): Promise<HanzoUser> => {
    const user = await requireAuth(req);

    if (!hanzoIAM.hasPermission(user, permission)) {
      throw new Error(`Missing required permission: ${permission}`);
    }

    return user;
  };
}

// Middleware for requiring organization access
export function requireOrgAccess(orgId: string, role?: string) {
  return async (req: Request): Promise<HanzoUser> => {
    const user = await requireAuth(req);

    if (!hanzoIAM.hasOrgAccess(user, orgId, role)) {
      throw new Error(`Insufficient organization access`);
    }

    return user;
  };
}