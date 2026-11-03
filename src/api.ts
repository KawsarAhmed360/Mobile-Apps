const baseUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api${path}`, { ...options, headers });
  } catch {
    throw new ApiError('Could not connect to SmartShop. Check your connection and keep the development server running on your Mac.', 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : 'Something went wrong. Please try again.';
    throw new ApiError(message, response.status);
  }
  if (data === null) throw new ApiError('The shop server returned an unexpected response. Check your API connection.', 0);
  return data as T;
}

export function subscribeToChanges(onChange: () => void) {
  const events = new EventSource(`${baseUrl}/api/events`);
  events.addEventListener('change', onChange);
  return () => events.close();
}

export const post = <T,>(path: string, value: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(value) });
