// zzz841 — the minimal feed-event shape the Multibagger Radar reads. A local
// structural interface so the Special Situations page's private CanonicalEvent
// never has to be exported (Next.js page-export rule). Any object with these
// fields fits; extra fields (catalyst scores etc.) are ignored on purpose.

export interface RadarFeedItem {
  id?: string;
  title: string;
  link?: string;
  source?: string;
  region?: 'IN' | 'US' | 'GLOBAL';
  pub_date?: string;
  age_hours?: number;
  category?: string;
  tickers?: string[];
  description?: string;
}

export interface RadarFeedEvent {
  event_id: string;
  event_type: string;
  category?: string;
  target_name?: string;
  primary_filing: RadarFeedItem;
  filings?: RadarFeedItem[];
  tier?: 'TIER_1' | 'TIER_2' | 'WATCHLIST' | 'NOISE' | string;
  why_tradable?: { what_happened?: string; what_matters?: string; what_to_watch?: string; what_breaks_thesis?: string };
  region?: 'IN' | 'US' | 'GLOBAL';
  tickers?: string[];
  is_fund?: boolean;
  primary_source?: boolean;
  age_hours?: number;
}
