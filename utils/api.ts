import { projectId } from './supabase/info';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const defaultApiBaseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-09672449`;

export const API_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_API_BASE_URL || defaultApiBaseUrl
);

export const CHAT_API_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_CHAT_API_BASE_URL || API_BASE_URL
);

export const AUTH_API_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_AUTH_API_BASE_URL || defaultApiBaseUrl
);

export const API_BACKEND_LABEL = API_BASE_URL.includes('supabase.co')
  ? 'Supabase'
  : 'AWS';

export const AUTH_PROVIDER = (
  import.meta.env.VITE_AUTH_PROVIDER || (AUTH_API_BASE_URL.includes('supabase.co') ? 'supabase' : 'aws')
).toLowerCase();

export const USE_AWS_AUTH = AUTH_PROVIDER === 'aws';
