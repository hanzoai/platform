/**
 * IAM Client
 *
 * Single-purpose authentication client
 * Connects to ~/work/hanzo/iam
 */

export class IAMClient {
  private endpoint: string;

  constructor() {
    this.endpoint = process.env.IAM_ENDPOINT || "https://iam.hanzo.ai";
  }

  async authenticate(token: string): Promise<User> {
    const response = await fetch(`${this.endpoint}/validate`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) throw new Error("Invalid token");
    return response.json();
  }

  async login(email: string, password: string): Promise<Session> {
    const response = await fetch(`${this.endpoint}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) throw new Error("Login failed");
    return response.json();
  }

  async logout(token: string): Promise<void> {
    await fetch(`${this.endpoint}/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
  }
}

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface Session {
  token: string;
  user: User;
  expiresAt: string;
}

export const iamClient = new IAMClient();