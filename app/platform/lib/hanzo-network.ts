/**
 * Hanzo Network - EVM Chain Integration
 *
 * Single-purpose service for deploying applications to Hanzo's EVM blockchain
 * Endpoint: api.hanzo.network
 * Node Software: ~/work/hanzo/node
 *
 * Uses dynamic import for ethers.js to avoid SSR issues during Next.js build.
 */

import type { ComposeSpec } from "./compose-spec";

export class HanzoNetwork {
  private endpoint: string;

  constructor() {
    this.endpoint = process.env.HANZO_NETWORK_ENDPOINT || "https://api.hanzo.network";
  }

  private async getEthers() {
    const { ethers } = await import("ethers");
    return ethers;
  }

  async deploy(spec: ComposeSpec): Promise<string> {
    const ethers = await this.getEthers();
    const provider = new ethers.JsonRpcProvider(this.endpoint);
    const deploymentData = this.specToContract(spec);

    const wallet = new ethers.Wallet(process.env.HANZO_NETWORK_PRIVATE_KEY!, provider);
    const contract = new ethers.ContractFactory(
      deploymentData.abi,
      deploymentData.bytecode,
      wallet
    );

    const deployment = await contract.deploy(...deploymentData.args);
    await deployment.waitForDeployment();
    return deployment.target as string;
  }

  async getStatus(deploymentId: string): Promise<"running" | "stopped" | "failed"> {
    const ethers = await this.getEthers();
    const provider = new ethers.JsonRpcProvider(this.endpoint);
    const contract = new ethers.Contract(
      deploymentId,
      ["function status() view returns (uint8)"],
      provider
    );

    const status = await contract.status!();
    return ["stopped", "running", "failed"][status] as any;
  }

  private specToContract(spec: ComposeSpec) {
    return {
      abi: [],
      bytecode: "0x",
      args: [spec.name, JSON.stringify(spec.services)]
    };
  }
}

export const hanzoNetwork = new HanzoNetwork();
