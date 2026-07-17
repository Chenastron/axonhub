import { useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Loader2, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useChannels } from '../context/channels-context';
import { useBulkAddChannelModels, useDiscoverChannelModelCandidates } from '../data/channels';
import type { ChannelModelAddSelectionInput, ChannelModelCandidate, ChannelModelDiscoveryResult } from '../data/schema';

function statusClassName(status: string) {
  switch (status) {
    case 'enabled':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400';
    case 'archived':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400';
    default:
      return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400';
  }
}

interface CandidateRowProps {
  candidate: ChannelModelCandidate;
  selectedChannelIDs?: ReadonlySet<string>;
  onToggleAll: () => void;
  onToggleChannel: (channelID: string) => void;
}

function CandidateRow({ candidate, selectedChannelIDs, onToggleAll, onToggleChannel }: CandidateRowProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const selectedCount = candidate.channels.filter((channel) => selectedChannelIDs?.has(channel.id)).length;
  const allSelected = selectedCount === candidate.channels.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className='border-b last:border-b-0'>
      <div className='flex min-w-0 items-center gap-3 px-3 py-2.5'>
        <Checkbox
          checked={allSelected || (someSelected && 'indeterminate')}
          onCheckedChange={onToggleAll}
          aria-label={t('channels.bulkAddModels.selectModel', { model: candidate.modelID })}
          data-testid={`bulk-add-model-checkbox-${candidate.modelID}`}
        />
        <button type='button' className='min-w-0 flex-1 text-left' onClick={onToggleAll}>
          <span className='block font-mono text-sm font-medium break-all'>{candidate.modelID}</span>
          <span className='text-muted-foreground text-xs'>
            {t('channels.bulkAddModels.selectedChannelCount', { selected: selectedCount, count: candidate.channels.length })}
          </span>
        </button>
        <CollapsibleTrigger asChild>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='h-8 w-8 shrink-0'
            title={t('channels.bulkAddModels.channelDetails')}
            data-testid={`bulk-add-model-channels-${candidate.modelID}`}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className='bg-muted/35 border-t px-3 py-2 pl-11'>
          <div className='space-y-1.5'>
            {candidate.channels.map((channel) => (
              <div key={channel.id} className='flex min-w-0 items-center gap-2'>
                <Checkbox
                  checked={selectedChannelIDs?.has(channel.id) ?? false}
                  onCheckedChange={() => onToggleChannel(channel.id)}
                  aria-label={t('channels.bulkAddModels.selectChannel', { channel: channel.name, model: candidate.modelID })}
                  data-testid={`bulk-add-channel-checkbox-${candidate.modelID}-${channel.id}`}
                />
                <button
                  type='button'
                  className='min-w-0 flex-1 truncate text-left text-sm'
                  title={channel.name}
                  onClick={() => onToggleChannel(channel.id)}
                >
                  {channel.name}
                </button>
                <Badge variant='outline' className={`shrink-0 text-[10px] ${statusClassName(channel.status)}`}>
                  {t(`channels.status.${channel.status}`)}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ChannelsBulkAddModelsDialog() {
  const { t } = useTranslation();
  const { open, setOpen } = useChannels();
  const discoverModels = useDiscoverChannelModelCandidates();
  const bulkAddModels = useBulkAddChannelModels();
  const [modelName, setModelName] = useState('');
  const [result, setResult] = useState<ChannelModelDiscoveryResult | null>(null);
  const [selectedChannelsByModel, setSelectedChannelsByModel] = useState<Map<string, Set<string>>>(new Map());
  const [failuresOpen, setFailuresOpen] = useState(false);

  const isOpen = open === 'bulkAddModels';
  const isBusy = discoverModels.isPending || bulkAddModels.isPending;

  const selectedCandidates = useMemo<ChannelModelAddSelectionInput[]>(() => {
    return (
      result?.candidates.flatMap((candidate) => {
        const selectedChannelIDs = selectedChannelsByModel.get(candidate.modelID);
        if (!selectedChannelIDs?.size) return [];

        return [
          {
            modelID: candidate.modelID,
            channelIDs: candidate.channels.filter((channel) => selectedChannelIDs.has(channel.id)).map((channel) => channel.id),
          },
        ];
      }) ?? []
    );
  }, [result, selectedChannelsByModel]);

  const affectedChannelCount = useMemo(() => {
    const channelIDs = new Set<string>();
    selectedCandidates.forEach((candidate) => candidate.channelIDs.forEach((channelID) => channelIDs.add(channelID)));
    return channelIDs.size;
  }, [selectedCandidates]);

  const reset = () => {
    setModelName('');
    setResult(null);
    setSelectedChannelsByModel(new Map());
    setFailuresOpen(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !isBusy) {
      reset();
      setOpen(null);
    }
  };

  const handleDiscover = async () => {
    const query = modelName.trim();
    if (!query) return;

    try {
      const discoveryResult = await discoverModels.mutateAsync(query);
      setResult(discoveryResult);
      setSelectedChannelsByModel(new Map());
      setFailuresOpen(discoveryResult.failures.length > 0);
    } catch (_error) {
      setResult(null);
    }
  };

  const toggleCandidate = (candidate: ChannelModelCandidate) => {
    setSelectedChannelsByModel((current) => {
      const next = new Map(current);
      const selectedChannelIDs = current.get(candidate.modelID);
      const allSelected = candidate.channels.every((channel) => selectedChannelIDs?.has(channel.id));

      if (allSelected) next.delete(candidate.modelID);
      else next.set(candidate.modelID, new Set(candidate.channels.map((channel) => channel.id)));

      return next;
    });
  };

  const toggleChannel = (modelID: string, channelID: string) => {
    setSelectedChannelsByModel((current) => {
      const next = new Map(current);
      const selectedChannelIDs = new Set(current.get(modelID));

      if (selectedChannelIDs.has(channelID)) selectedChannelIDs.delete(channelID);
      else selectedChannelIDs.add(channelID);

      if (selectedChannelIDs.size === 0) next.delete(modelID);
      else next.set(modelID, selectedChannelIDs);

      return next;
    });
  };

  const handleAdd = async () => {
    if (selectedCandidates.length === 0) return;
    try {
      await bulkAddModels.mutateAsync(selectedCandidates);
      reset();
      setOpen(null);
    } catch (_error) {
      // The mutation hook reports the error and keeps the selection available for retry.
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className='flex max-h-[90vh] flex-col sm:max-w-2xl' data-testid='bulk-add-channel-models-dialog'>
        <DialogHeader>
          <DialogTitle>{t('channels.bulkAddModels.title')}</DialogTitle>
          <DialogDescription>{t('channels.bulkAddModels.description')}</DialogDescription>
        </DialogHeader>

        <div className='flex min-h-0 flex-1 flex-col gap-4'>
          <div className='flex flex-col gap-2 sm:flex-row'>
            <Input
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && modelName.trim() && !isBusy) void handleDiscover();
              }}
              placeholder={t('channels.bulkAddModels.placeholder')}
              disabled={isBusy}
              autoFocus
              data-testid='bulk-add-channel-model-input'
            />
            <Button
              type='button'
              onClick={handleDiscover}
              disabled={!modelName.trim() || isBusy}
              className='shrink-0'
              data-testid='bulk-add-channel-model-search'
            >
              {discoverModels.isPending ? <Loader2 className='h-4 w-4 animate-spin' /> : <Search className='h-4 w-4' />}
              {t('channels.bulkAddModels.search')}
            </Button>
          </div>

          {discoverModels.isPending && (
            <div className='text-muted-foreground flex min-h-40 items-center justify-center gap-2 text-sm'>
              <Loader2 className='h-5 w-5 animate-spin' />
              {t('channels.bulkAddModels.searching')}
            </div>
          )}

          {!discoverModels.isPending && result && (
            <div className='flex min-h-0 flex-1 flex-col gap-3'>
              <div className='text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs'>
                <span>{t('channels.bulkAddModels.scanned', { count: result.scanned })}</span>
                <span>{t('channels.bulkAddModels.succeeded', { count: result.succeeded })}</span>
                <span>{t('channels.bulkAddModels.candidateCount', { count: result.candidates.length })}</span>
              </div>

              {result.candidates.length > 0 ? (
                <div className='min-h-0 overflow-y-auto rounded-md border' data-testid='bulk-add-channel-model-results'>
                  {result.candidates.map((candidate) => (
                    <CandidateRow
                      key={candidate.modelID}
                      candidate={candidate}
                      selectedChannelIDs={selectedChannelsByModel.get(candidate.modelID)}
                      onToggleAll={() => toggleCandidate(candidate)}
                      onToggleChannel={(channelID) => toggleChannel(candidate.modelID, channelID)}
                    />
                  ))}
                </div>
              ) : (
                <div className='text-muted-foreground flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 text-center text-sm'>
                  <Check className='h-5 w-5' />
                  {t('channels.bulkAddModels.noCandidates')}
                </div>
              )}

              {result.failures.length > 0 && (
                <Collapsible open={failuresOpen} onOpenChange={setFailuresOpen} className='border-destructive/30 rounded-md border'>
                  <CollapsibleTrigger asChild>
                    <Button type='button' variant='ghost' className='text-destructive h-auto w-full justify-between gap-2 px-3 py-2'>
                      <span className='flex min-w-0 items-center gap-2 text-sm'>
                        <AlertCircle className='h-4 w-4 shrink-0' />
                        {t('channels.bulkAddModels.failureCount', { count: result.failures.length })}
                      </span>
                      <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${failuresOpen ? 'rotate-180' : ''}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className='max-h-36 space-y-2 overflow-y-auto border-t px-3 py-2'>
                      {result.failures.map((failure) => (
                        <div key={failure.channelID} className='text-xs'>
                          <div className='font-medium'>{failure.channelName}</div>
                          <div className='text-muted-foreground break-words'>{failure.error}</div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => handleOpenChange(false)} disabled={isBusy}>
            {t('common.buttons.cancel')}
          </Button>
          <Button
            type='button'
            onClick={handleAdd}
            disabled={selectedCandidates.length === 0 || isBusy}
            data-testid='bulk-add-channel-model-confirm'
          >
            {bulkAddModels.isPending && <Loader2 className='h-4 w-4 animate-spin' />}
            {t('channels.bulkAddModels.confirm', {
              models: selectedCandidates.length,
              channels: affectedChannelCount,
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
