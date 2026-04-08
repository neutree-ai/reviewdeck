export interface User {
  id: string;
  username: string;
  passwordHash: string;
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
