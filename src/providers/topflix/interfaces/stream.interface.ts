export interface Stream {
  url: string;
  name?: string;
  quality?: string;
  type?: 'iframe' | 'url' | 'torrent' | 'external';
  behaviorHints?: {
    notWebReady?: boolean;
    proxyHeaders?: Record<string, string>;
  };
}
