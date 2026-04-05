const KEY = "qas_server_api_token";

export function saveServerApiToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(KEY, token);
    } else {
      localStorage.removeItem(KEY);
    }
  } catch {
    /* ignore */
  }
}

export function readServerApiToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearServerApiToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
