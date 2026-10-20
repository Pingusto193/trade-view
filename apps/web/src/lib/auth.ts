import { create } from 'zustand';
import { api } from './api';

export interface User {
  id: number;
  email: string;
  totpEnabled: boolean;
}

interface AuthState {
  loaded: boolean;
  needsSetup: boolean;
  /** A primeira conta exige o código de instalação (servidor público). */
  setupCodeRequired: boolean;
  devNoAuth: boolean;
  user: User | null;
  refresh(): Promise<void>;
  setUser(u: User | null): void;
}

export const useAuth = create<AuthState>()((set) => ({
  loaded: false,
  needsSetup: false,
  setupCodeRequired: false,
  devNoAuth: false,
  user: null,
  async refresh() {
    try {
      const s = await api<{
        needsSetup: boolean;
        setupCodeRequired?: boolean;
        devNoAuth: boolean;
        user: User | null;
      }>('/api/auth/state');
      set({ loaded: true, ...s, setupCodeRequired: Boolean(s.setupCodeRequired) });
    } catch {
      set({ loaded: true, user: null });
    }
  },
  setUser: (user) => set({ user, needsSetup: false, setupCodeRequired: false }),
}));

export const login = (email: string, password: string, totp?: string) =>
  api<{ user?: User; needTotp?: boolean }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) }),
  });

export const register = (email: string, password: string, invite?: string, setupCode?: string) =>
  api<{ user: User }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      ...(invite ? { invite } : {}),
      ...(setupCode ? { setupCode } : {}),
    }),
  });

export const logout = () => api('/api/auth/logout', { method: 'POST', body: '{}' });
