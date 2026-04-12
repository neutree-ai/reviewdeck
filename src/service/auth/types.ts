export interface User {
  id: string;
  username: string;
  passwordHash?: string;
  externalProvider?: string;
  externalId?: string;
  displayName?: string;
  email?: string;
  createdAt: Date;
}

export interface IdentityProvider {
  id: string;
  displayName: string;
  type: "oidc" | "oauth2";
  issuerUrl?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  userinfoUrl?: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  userIdClaim: string;
  usernameClaim: string;
  enabled: boolean;
  createdAt: Date;
}

export interface AuthCode {
  code: string;
  clientId: string;
  userId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  resource?: string;
  /** Epoch seconds */
  expiresAt: number;
}

export interface RefreshTokenRecord {
  token: string;
  clientId: string;
  userId: string;
  scopes: string[];
  resource?: string;
  /** Epoch seconds */
  expiresAt: number;
}
