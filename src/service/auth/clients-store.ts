import { randomUUID } from "node:crypto";
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { Storage } from "../storage/interface.ts";

export class ReviewDeckClientsStore implements OAuthRegisteredClientsStore {
  constructor(private storage: Storage) {}

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.storage.getOAuthClient(clientId);
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): Promise<OAuthClientInformationFull> {
    const full: OAuthClientInformationFull = {
      ...(client as OAuthClientMetadata),
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    await this.storage.saveOAuthClient(full);
    return full;
  }
}
