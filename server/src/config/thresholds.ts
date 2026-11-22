export const THRESHOLDS = {
  /** Strict default (0.75) prevents pharmacy LASA confusion; lower to 0.55 for general retail */
  FUZZY_MATCH_THRESHOLD: 0.75,
  /** Stopwatch lookup time (seconds) above which an item/container is flagged as a bottleneck */
  SLOW_FIND_THRESHOLD_SEC: 15.0,
  /** Minimum distinct containers before a category/medicine triggers a Scatter Alert */
  SCATTER_MIN_SPOTS: 2,
  /** Days since last_verified before a shelf coordinate shows a Stale Warning */
  STALE_DATA_DAYS: 14,
  /** Cap returned search hits to keep mobile viewports scannable */
  MAX_SEARCH_RESULTS: 25,
  /** Rolling CSV snapshots retained in data/backups/ for 1-click Undo */
  UNDO_HISTORY_LIMIT: 10,
} as const;