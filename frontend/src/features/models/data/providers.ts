import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { graphqlRequest } from '@/gql/graphql';
import i18n from '@/lib/i18n';
import providersDataRaw from './providers.json';
import { providersDataSchema, type ProvidersData, type ProviderModel, resolveVision } from './providers.schema';
import type { ModelCard } from './schema';

const fallbackProvidersData = providersDataSchema.parse(providersDataRaw);

const PROVIDERS_CATALOG_QUERY = `
  query ProvidersCatalog($filtered: Boolean) {
    providersCatalog(filtered: $filtered) {
      data
      fetchedAt
      source
      filtered
    }
  }
`;

const REFRESH_PROVIDERS_CATALOG_MUTATION = `
  mutation RefreshProvidersCatalog {
    refreshProvidersCatalog {
      data
      fetchedAt
      source
      filtered
    }
  }
`;

export type ProvidersCatalogInfo = {
  data: ProvidersData;
  source: string;
  fetchedAt?: string | null;
  filtered: boolean;
};

async function loadProvidersCatalog(filtered: boolean): Promise<ProvidersCatalogInfo> {
  try {
    const result = await graphqlRequest<{
      providersCatalog: {
        data: unknown;
        fetchedAt?: string | null;
        source: string;
        filtered: boolean;
      };
    }>(PROVIDERS_CATALOG_QUERY, { filtered });

    return {
      data: providersDataSchema.parse(result.providersCatalog.data),
      source: result.providersCatalog.source,
      fetchedAt: result.providersCatalog.fetchedAt,
      filtered: result.providersCatalog.filtered,
    };
  } catch (error) {
    console.error('Failed to load providers catalog, falling back to bundled data:', error);
    return {
      data: fallbackProvidersData,
      source: 'fallback',
      fetchedAt: null,
      filtered,
    };
  }
}

export function useProvidersCatalog(filtered: boolean) {
  return useQuery({
    queryKey: ['providers-catalog', filtered],
    queryFn: () => loadProvidersCatalog(filtered),
    staleTime: 5 * 60 * 1000,
    placeholderData: {
      data: fallbackProvidersData,
      source: 'fallback',
      fetchedAt: null,
      filtered,
    },
  });
}

export function useProvidersData() {
  const query = useProvidersCatalog(false);
  return {
    ...query,
    data: query.data?.data ?? fallbackProvidersData,
    source: query.data?.source ?? 'fallback',
    fetchedAt: query.data?.fetchedAt ?? null,
  };
}

export function useDevelopersData() {
  const query = useProvidersCatalog(true);
  return {
    ...query,
    data: query.data?.data ?? fallbackProvidersData,
    source: query.data?.source ?? 'fallback',
    fetchedAt: query.data?.fetchedAt ?? null,
  };
}

export function useRefreshProvidersCatalog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const result = await graphqlRequest<{
        refreshProvidersCatalog: {
          data: unknown;
          fetchedAt?: string | null;
          source: string;
          filtered: boolean;
        };
      }>(REFRESH_PROVIDERS_CATALOG_MUTATION);

      return {
        data: providersDataSchema.parse(result.refreshProvidersCatalog.data),
        source: result.refreshProvidersCatalog.source,
        fetchedAt: result.refreshProvidersCatalog.fetchedAt,
        filtered: result.refreshProvidersCatalog.filtered,
      } satisfies ProvidersCatalogInfo;
    },
    onSuccess: (catalog) => {
      queryClient.setQueryData(['providers-catalog', true], catalog);
      queryClient.invalidateQueries({ queryKey: ['providers-catalog'] });
      toast.success(i18n.t('models.catalog.refreshSuccess'));
    },
    onError: () => {
      toast.error(i18n.t('models.catalog.refreshFailed'));
    },
  });
}

/**
 * Find a provider model by developer id and model id from providers data.
 * Returns null if not found.
 */
export function findProviderModel(
  providersData: ProvidersData | undefined,
  developer: string,
  modelID: string
): ProviderModel | null {
  if (!providersData) return null;
  const provider = providersData.providers[developer];
  if (!provider?.models?.length) return null;
  return provider.models.find((m) => m.id === modelID) ?? null;
}

/**
 * Build a ModelCard from a ProviderModel, mirroring the logic used when adding
 * a model in ModelsActionDialog. Keeps reasoning, toolCall, temperature,
 * modalities, vision, cost, limit and dates in sync with the upstream provider
 * data.
 */
export function buildModelCardFromProviderModel(
  model: ProviderModel
): ModelCard {
  return {
    reasoning: {
      supported: model.reasoning?.supported || false,
      default: model.reasoning?.default || false,
    },
    toolCall: model.tool_call,
    temperature: model.temperature,
    modalities: {
      input: model.modalities?.input || [],
      output: model.modalities?.output || [],
    },
    vision: resolveVision(model),
    cost: {
      input: model.cost?.input || 0,
      output: model.cost?.output || 0,
      cacheRead: model.cost?.cache_read,
      cacheWrite: model.cost?.cache_write,
    },
    limit: {
      context: model.limit?.context || 0,
      output: model.limit?.output || 0,
    },
    knowledge: model.knowledge,
    releaseDate: model.release_date,
    lastUpdated: model.last_updated,
  };
}

/**
 * Shallow equality check for two ModelCard objects used to detect whether a
 * sync would actually change anything.
 */
export function isModelCardEqual(a?: ModelCard, b?: ModelCard): boolean {
  if (!a || !b) return a === b;

  const normalize = (card: ModelCard) => {
    return {
      reasoning: {
        supported: !!card.reasoning?.supported,
        default: !!card.reasoning?.default,
      },
      toolCall: !!card.toolCall,
      temperature: !!card.temperature,
      modalities: {
        input: [...(card.modalities?.input || [])].sort(),
        output: [...(card.modalities?.output || [])].sort(),
      },
      vision: !!card.vision,
      cost: {
        input: card.cost?.input || 0,
        output: card.cost?.output || 0,
        cacheRead: card.cost?.cacheRead || 0,
        cacheWrite: card.cost?.cacheWrite || 0,
      },
      limit: {
        context: card.limit?.context || 0,
        output: card.limit?.output || 0,
      },
      knowledge: card.knowledge || '',
      releaseDate: card.releaseDate || '',
      lastUpdated: card.lastUpdated || '',
    };
  };

  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
