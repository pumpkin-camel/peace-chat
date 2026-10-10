interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_VERDENT_OAUTH_INITIATE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
