import {
  DEFAULT_END_TIME,
  DEFAULT_START_TIME,
  buildDateRangeWhereClause,
  isSameTime,
  normalizeDateTimeRangeValue,
  type DateTimeRangeValue,
  type TimeValue,
} from '@/utils/date-range';

export const REQUEST_FILTER_SEARCH_KEYS = {
  status: 'status',
  source: 'source',
  channel: 'channel',
  apiKey: 'apiKey',
  modelID: 'modelID',
  createdAtFrom: 'createdAtFrom',
  createdAtTo: 'createdAtTo',
  createdAtStartTime: 'createdAtStartTime',
  createdAtEndTime: 'createdAtEndTime',
} as const;

export const REQUEST_CURSOR_SEARCH_KEYS = ['startCursor', 'endCursor', 'cursorDirection', 'cursorHistory'] as const;

export type RequestSearchFilters = {
  statusFilter: string[];
  sourceFilter: string[];
  channelFilter: string[];
  apiKeyFilter: string[];
  modelIDFilter: string;
  dateRange?: DateTimeRangeValue;
};

function getSearchString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value.find((item): item is string => typeof item === 'string');
    return first ?? '';
  }
  return '';
}

function getSearchStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }

  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
    }
  } catch {
    // Fall through to comma-separated search values.
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function setSearchStringArray(draft: Record<string, unknown>, key: string, value: string[]) {
  if (value.length > 0) {
    draft[key] = value;
  } else {
    delete draft[key];
  }
}

export function setSearchString(draft: Record<string, unknown>, key: string, value: string) {
  const normalized = value.trim();
  if (normalized) {
    draft[key] = normalized;
  } else {
    delete draft[key];
  }
}

function pad2(value: number) {
  return value.toString().padStart(2, '0');
}

export function formatSearchDate(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseSearchDate(value: unknown): Date | undefined {
  const raw = getSearchString(value);
  if (!raw) return undefined;

  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const year = Number.parseInt(dateOnly[1], 10);
    const month = Number.parseInt(dateOnly[2], 10);
    const day = Number.parseInt(dateOnly[3], 10);
    const date = new Date(year, month - 1, day);

    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
      return date;
    }
    return undefined;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function clampTimePart(value: string | undefined, max: number, fallback: string) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return pad2(Math.min(Math.max(parsed, 0), max));
}

export function formatSearchTime(time: TimeValue) {
  return `${time.hh}:${time.mm}:${time.ss}`;
}

function parseSearchTime(value: unknown, fallback: TimeValue): TimeValue {
  const raw = getSearchString(value);
  if (!raw) return fallback;

  const [hh, mm, ss] = raw.split(':');
  return {
    hh: clampTimePart(hh, 23, fallback.hh),
    mm: clampTimePart(mm, 59, fallback.mm),
    ss: clampTimePart(ss, 59, fallback.ss),
  };
}

export function parseRequestSearchFilters(search: Record<string, unknown>): RequestSearchFilters {
  const from = parseSearchDate(search[REQUEST_FILTER_SEARCH_KEYS.createdAtFrom]);
  const to = parseSearchDate(search[REQUEST_FILTER_SEARCH_KEYS.createdAtTo]);
  const hasDateRange = !!from || !!to;

  return {
    statusFilter: getSearchStringArray(search[REQUEST_FILTER_SEARCH_KEYS.status]),
    sourceFilter: getSearchStringArray(search[REQUEST_FILTER_SEARCH_KEYS.source]),
    channelFilter: getSearchStringArray(search[REQUEST_FILTER_SEARCH_KEYS.channel]),
    apiKeyFilter: getSearchStringArray(search[REQUEST_FILTER_SEARCH_KEYS.apiKey]),
    modelIDFilter: getSearchString(search[REQUEST_FILTER_SEARCH_KEYS.modelID]),
    dateRange: hasDateRange
      ? normalizeDateTimeRangeValue({
          from,
          to,
          startTime: parseSearchTime(search[REQUEST_FILTER_SEARCH_KEYS.createdAtStartTime], DEFAULT_START_TIME),
          endTime: parseSearchTime(search[REQUEST_FILTER_SEARCH_KEYS.createdAtEndTime], DEFAULT_END_TIME),
        })
      : undefined,
  };
}

export function buildRequestWhereClause(filters: RequestSearchFilters, modelIDFilter = filters.modelIDFilter) {
  const where: { [key: string]: any } = {
    ...buildDateRangeWhereClause(filters.dateRange),
  };
  if (filters.statusFilter.length > 0) {
    where.statusIn = filters.statusFilter;
  }
  if (filters.sourceFilter.length > 0) {
    where.sourceIn = filters.sourceFilter;
  }
  if (filters.channelFilter.length > 0) {
    where.channelIDIn = filters.channelFilter;
  }
  if (filters.apiKeyFilter.length > 0) {
    where.apiKeyIDIn = filters.apiKeyFilter;
  }
  if (modelIDFilter) {
    where.modelIDContainsFold = modelIDFilter;
  }
  return Object.keys(where).length > 0 ? where : undefined;
}

export function clearRequestCursorSearch(draft: Record<string, unknown>) {
  REQUEST_CURSOR_SEARCH_KEYS.forEach((key) => {
    delete draft[key];
  });
}

export function clearRequestFilterSearch(draft: Record<string, unknown>) {
  Object.values(REQUEST_FILTER_SEARCH_KEYS).forEach((key) => {
    delete draft[key];
  });
}

export { DEFAULT_END_TIME, DEFAULT_START_TIME, isSameTime, normalizeDateTimeRangeValue };
