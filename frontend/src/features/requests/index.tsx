import { useCallback, useMemo } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAutoRefreshInterval } from '@/hooks/use-auto-refresh-interval';
import { type DateTimeRangeValue } from '@/utils/date-range';
import { useDebounce } from '@/hooks/use-debounce';
import { usePaginationSearch } from '@/hooks/use-pagination-search';
import useInterval from '@/hooks/useInterval';
import { Main } from '@/components/layout/main';
import { PageHeader } from '@/components/layout/page-header';
import { RequestsTable, type RequestTableFilters } from './components';
import { RequestsProvider } from './context';
import { useRequests } from './data';
import {
  DEFAULT_END_TIME,
  DEFAULT_START_TIME,
  REQUEST_FILTER_SEARCH_KEYS,
  buildRequestWhereClause,
  clearRequestCursorSearch,
  clearRequestFilterSearch,
  formatSearchDate,
  formatSearchTime,
  isSameTime,
  normalizeDateTimeRangeValue,
  parseRequestSearchFilters,
  setSearchString,
  setSearchStringArray,
} from './request-search';

function RequestsContent() {
  const navigate = useNavigate();
  const currentSearch = useRouterState({
    select: (state) => (state.location.search ?? {}) as Record<string, unknown>,
  });
  const { pageSize, setCursors, setPageSize, resetCursor, paginationArgs, cursorHistory } = usePaginationSearch({
    defaultPageSize: 20,
    pageSizeStorageKey: 'requests-table-page-size',
  });
  const { statusFilter, sourceFilter, channelFilter, apiKeyFilter, modelIDFilter, dateRange } = useMemo(
    () => parseRequestSearchFilters(currentSearch),
    [currentSearch]
  );
  const debouncedModelIDFilter = useDebounce(modelIDFilter, 300);
  const [autoRefreshInterval, setAutoRefreshInterval] = useAutoRefreshInterval('requests-auto-refresh-interval-ms');

  const whereClause = buildRequestWhereClause(
    { statusFilter, sourceFilter, channelFilter, apiKeyFilter, modelIDFilter, dateRange },
    debouncedModelIDFilter
  );

  const { data, isLoading, refetch } = useRequests({
    ...paginationArgs,
    where: whereClause,
    orderBy: {
      field: 'CREATED_AT',
      direction: 'DESC',
    },
  });

  const requests = data?.edges?.map((edge) => edge.node) || [];
  const pageInfo = data?.pageInfo;

  const isFirstPage = !paginationArgs.after && cursorHistory.length === 0;

  const autoRefreshResumeKey = useInterval(
    () => {
      refetch();
    },
    isFirstPage ? autoRefreshInterval : null,
    { refreshOnResume: true }
  );

  const handleNextPage = () => {
    if (data?.pageInfo?.hasNextPage && data?.pageInfo?.endCursor) {
      setCursors(data.pageInfo.startCursor ?? undefined, data.pageInfo.endCursor ?? undefined, 'after');
    }
  };

  const handlePreviousPage = () => {
    if (data?.pageInfo?.hasPreviousPage) {
      setCursors(data.pageInfo.startCursor ?? undefined, data.pageInfo.endCursor ?? undefined, 'before');
    }
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    resetCursor();
  };

  const updateRequestSearch = useCallback(
    (apply: (draft: Record<string, unknown>) => void) => {
      navigate({
        search: (prev: Record<string, unknown> | undefined) => {
          const draft = { ...((prev ?? {}) as Record<string, unknown>) };
          apply(draft);
          clearRequestCursorSearch(draft);
          return draft;
        },
        replace: true,
      });
    },
    [navigate]
  );

  const handleFiltersChange = useCallback(
    (filters: RequestTableFilters) => {
      updateRequestSearch((draft) => {
        setSearchStringArray(draft, REQUEST_FILTER_SEARCH_KEYS.status, filters.statusFilter);
        setSearchStringArray(draft, REQUEST_FILTER_SEARCH_KEYS.source, filters.sourceFilter);
        setSearchStringArray(draft, REQUEST_FILTER_SEARCH_KEYS.channel, filters.channelFilter);
        setSearchStringArray(draft, REQUEST_FILTER_SEARCH_KEYS.apiKey, filters.apiKeyFilter);
        setSearchString(draft, REQUEST_FILTER_SEARCH_KEYS.modelID, filters.modelIDFilter);
      });
    },
    [updateRequestSearch]
  );

  const handleDateRangeChange = useCallback(
    (range: DateTimeRangeValue | undefined) => {
      updateRequestSearch((draft) => {
        const normalizedRange = range ? normalizeDateTimeRangeValue(range) : undefined;

        if (!normalizedRange || (!normalizedRange.from && !normalizedRange.to)) {
          delete draft[REQUEST_FILTER_SEARCH_KEYS.createdAtFrom];
          delete draft[REQUEST_FILTER_SEARCH_KEYS.createdAtTo];
          delete draft[REQUEST_FILTER_SEARCH_KEYS.createdAtStartTime];
          delete draft[REQUEST_FILTER_SEARCH_KEYS.createdAtEndTime];
          return;
        }

        if (normalizedRange.from) {
          draft[REQUEST_FILTER_SEARCH_KEYS.createdAtFrom] = formatSearchDate(normalizedRange.from);
          if (isSameTime(normalizedRange.startTime, DEFAULT_START_TIME)) {
            delete draft[REQUEST_FILTER_SEARCH_KEYS.createdAtStartTime];
          } else {
            draft[REQUEST_FILTER_SEARCH_KEYS.createdAtStartTime] = formatSearchTime(normalizedRange.startTime);
          }
        } else {
          delete draft[REQUEST_FILTER_SEARCH_KEYS.createdAtFrom];
          delete draft[REQUEST_FILTER_SEARCH_KEYS.createdAtStartTime];
        }

        if (normalizedRange.to) {
          draft[REQUEST_FILTER_SEARCH_KEYS.createdAtTo] = formatSearchDate(normalizedRange.to);
          if (isSameTime(normalizedRange.endTime, DEFAULT_END_TIME)) {
            delete draft[REQUEST_FILTER_SEARCH_KEYS.createdAtEndTime];
          } else {
            draft[REQUEST_FILTER_SEARCH_KEYS.createdAtEndTime] = formatSearchTime(normalizedRange.endTime);
          }
        } else {
          delete draft[REQUEST_FILTER_SEARCH_KEYS.createdAtTo];
          delete draft[REQUEST_FILTER_SEARCH_KEYS.createdAtEndTime];
        }
      });
    },
    [updateRequestSearch]
  );

  const handleResetFilters = useCallback(() => {
    updateRequestSearch(clearRequestFilterSearch);
  }, [updateRequestSearch]);

  const handleViewDetail = useCallback(
    (requestId: string) => {
      navigate({
        to: '/project/requests/$requestId',
        params: { requestId },
        search: currentSearch,
      });
    },
    [navigate, currentSearch]
  );

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <RequestsTable
        data={requests}
        loading={isLoading}
        pageInfo={pageInfo}
        pageSize={pageSize}
        totalCount={data?.totalCount}
        statusFilter={statusFilter}
        sourceFilter={sourceFilter}
        channelFilter={channelFilter}
        apiKeyFilter={apiKeyFilter}
        modelIDFilter={modelIDFilter}
        dateRange={dateRange}
        queryWhere={whereClause}
        onNextPage={handleNextPage}
        onPreviousPage={handlePreviousPage}
        onPageSizeChange={handlePageSizeChange}
        onFiltersChange={handleFiltersChange}
        onDateRangeChange={handleDateRangeChange}
        onResetFilters={handleResetFilters}
        onViewDetail={handleViewDetail}
        onRefresh={refetch}
        showRefresh={isFirstPage}
        autoRefreshInterval={autoRefreshInterval}
        autoRefreshResumeKey={autoRefreshResumeKey}
        onAutoRefreshIntervalChange={setAutoRefreshInterval}
      />
    </div>
  );
}

export default function RequestsManagement() {
  const { t } = useTranslation();

  return (
    <RequestsProvider>
      <PageHeader title={t('requests.title')} description={t('requests.description')} />

      <Main fixed className='py-2 sm:py-6'>
        <RequestsContent />
      </Main>
    </RequestsProvider>
  );
}
