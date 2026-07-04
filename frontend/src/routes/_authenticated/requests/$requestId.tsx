import { createFileRoute } from '@tanstack/react-router';
import RequestDetailGlobalPage from '@/features/requests/components/request-detail-global-page';

export const Route = createFileRoute('/_authenticated/requests/$requestId')({
  validateSearch: (search: Record<string, unknown>) => search,
  component: RequestDetailGlobalPage,
});
