import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useModels } from '../context/models-context';
import { useUpdateModel, useQueryAllModels } from '../data/models';
import { useDevelopersData, findProviderModel, buildModelCardFromProviderModel, isModelCardEqual } from '../data/providers';
import { Model, ModelCard } from '../data/schema';
import { formatNumber } from '@/utils/format-number';

interface SyncItem {
  model: Model;
  newCard: ModelCard;
  changes: string[];
}

function getChangesSummary(oldCard: ModelCard, newCard: ModelCard, t: any): string[] {
  const changes: string[] = [];

  const oldLimit = oldCard.limit?.context || 0;
  const newLimit = newCard.limit?.context || 0;
  if (oldLimit !== newLimit) {
    changes.push(`Context: ${formatNumber(oldLimit)} → ${formatNumber(newLimit)}`);
  }

  const oldCostIn = oldCard.cost?.input || 0;
  const newCostIn = newCard.cost?.input || 0;
  if (oldCostIn !== newCostIn) {
    changes.push(`Cost In: $${oldCostIn} → $${newCostIn}`);
  }

  const oldCostOut = oldCard.cost?.output || 0;
  const newCostOut = newCard.cost?.output || 0;
  if (oldCostOut !== newCostOut) {
    changes.push(`Cost Out: $${oldCostOut} → $${newCostOut}`);
  }

  const oldVision = !!oldCard.vision;
  const newVision = !!newCard.vision;
  if (oldVision !== newVision) {
    changes.push(`Vision: ${oldVision ? '✓' : '✗'} → ${newVision ? '✓' : '✗'}`);
  }

  const oldTool = !!oldCard.toolCall;
  const newTool = !!newCard.toolCall;
  if (oldTool !== newTool) {
    changes.push(`Tool Call: ${oldTool ? '✓' : '✗'} → ${newTool ? '✓' : '✗'}`);
  }

  const oldReasoning = !!oldCard.reasoning?.supported;
  const newReasoning = !!newCard.reasoning?.supported;
  if (oldReasoning !== newReasoning) {
    changes.push(`Reasoning: ${oldReasoning ? '✓' : '✗'} → ${newReasoning ? '✓' : '✗'}`);
  }

  return changes;
}

export function ModelsSyncAllDialog() {
  const { t } = useTranslation();
  const { open, setOpen } = useModels();
  const updateModel = useUpdateModel();
  const { data: developersData } = useDevelopersData();
  const { data: allModelsData, refetch: refetchAllModels } = useQueryAllModels({});

  const [syncing, setSyncing] = useState(false);
  const [current, setCurrent] = useState(0);
  const [syncStatus, setSyncStatus] = useState<Record<string, 'pending' | 'success' | 'failed'>>({});

  const logEndRef = useRef<HTMLDivElement>(null);

  const isOpen = open === 'syncAll';

  // Compute which models need sync
  const modelsToSync = useMemo<SyncItem[]>(() => {
    if (!isOpen || !allModelsData || !developersData) return [];

    const list: SyncItem[] = [];

    allModelsData.edges.forEach((edge) => {
      const model = edge.node;
      const providerModel = findProviderModel(developersData, model.developer, model.modelID);
      if (providerModel) {
        const newCard = buildModelCardFromProviderModel(providerModel);
        if (!isModelCardEqual(model.modelCard, newCard)) {
          const changes = getChangesSummary(model.modelCard, newCard, t);
          list.push({ model, newCard, changes });
        }
      }
    });

    return list;
  }, [isOpen, allModelsData, developersData, t]);

  // Reset local state when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      setSyncing(false);
      setCurrent(0);
      setSyncStatus({});
    }
  }, [isOpen]);

  // Auto-scroll logs to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [current, syncStatus]);

  const handleSyncAll = async () => {
    if (modelsToSync.length === 0) return;

    setSyncing(true);
    setCurrent(0);

    const initialStatus: Record<string, 'pending' | 'success' | 'failed'> = {};
    modelsToSync.forEach((item) => {
      initialStatus[item.model.id] = 'pending';
    });
    setSyncStatus(initialStatus);

    let successCount = 0;

    for (let i = 0; i < modelsToSync.length; i++) {
      const item = modelsToSync[i];
      try {
        await updateModel.mutateAsync({
          id: item.model.id,
          input: {
            developer: item.model.developer,
            modelID: item.model.modelID,
            type: item.model.type,
            name: item.model.name,
            icon: item.model.icon,
            group: item.model.group,
            modelCard: item.newCard,
            settings: item.model.settings,
            remark: item.model.remark,
          },
          silent: true, // Prevent 27 successful Toast alerts
        } as any);

        setSyncStatus((prev) => ({ ...prev, [item.model.id]: 'success' }));
        successCount++;
      } catch (err) {
        console.error(`Failed to sync parameters for model ${item.model.name}:`, err);
        setSyncStatus((prev) => ({ ...prev, [item.model.id]: 'failed' }));
      }
      setCurrent(i + 1);
    }

    setSyncing(false);
    // Explicitly refetch to make sure the state is updated
    await refetchAllModels();
    toast.success(t('models.messages.syncAllSuccess', { count: successCount }));
    setOpen(null);
  };

  const handleClose = () => {
    if (syncing) return; // Prevent closing mid-sync
    setOpen(null);
  };

  const hasNoChanges = modelsToSync.length === 0;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className='sm:max-w-xl flex flex-col max-h-[85vh] overflow-hidden'>
        <DialogHeader className='flex-shrink-0'>
          <DialogTitle>{t('models.dialogs.syncAllModelCards.title')}</DialogTitle>
          <DialogDescription>
            {t('models.dialogs.syncAllModelCards.description')}
          </DialogDescription>
        </DialogHeader>

        <div className='flex-1 min-h-0 space-y-4 py-2 overflow-hidden flex flex-col'>
          {hasNoChanges && !syncing ? (
            <div className='rounded-md bg-muted p-4 text-sm text-muted-foreground text-center'>
              {t('models.dialogs.syncAllModelCards.noChanges')}
            </div>
          ) : (
            <>
              {!syncing && (
                <div className='rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-200 flex-shrink-0'>
                  {t('models.dialogs.syncAllModelCards.confirm', { count: modelsToSync.length })}
                </div>
              )}

              {syncing && (
                <div className='space-y-2 flex-shrink-0'>
                  <div className='flex justify-between text-sm font-medium'>
                    <span>{t('models.dialogs.syncAllModelCards.syncing', { current, total: modelsToSync.length })}</span>
                    <span>{Math.round((current / modelsToSync.length) * 100)}%</span>
                  </div>
                  <Progress value={(current / modelsToSync.length) * 100} className='w-full' />
                </div>
              )}

              {/* Models to Sync Log Area */}
              <div className='flex-1 min-h-0 border rounded-md flex flex-col overflow-hidden'>
                <div className='bg-muted p-2 text-xs font-semibold text-muted-foreground border-b flex-shrink-0'>
                  {syncing ? 'Sync Log' : 'Detected Parameter Changes'}
                </div>
                <ScrollArea className='flex-1 p-2'>
                  <div className='space-y-3'>
                    {modelsToSync.map((item) => {
                      const status = syncStatus[item.model.id];
                      return (
                        <div key={item.model.id} className='text-sm flex flex-col border-b pb-2 last:border-0 last:pb-0'>
                          <div className='flex items-center justify-between'>
                            <div className='font-medium flex items-center gap-2'>
                              <Badge variant='outline'>{item.model.developer}</Badge>
                              <span>{item.model.modelID}</span>
                            </div>
                            <div>
                              {status === 'pending' && <Loader2 className='h-4 w-4 animate-spin text-blue-500' />}
                              {status === 'success' && <Check className='h-4 w-4 text-green-500' />}
                              {status === 'failed' && <IconX className='h-4 w-4 text-red-500' />}
                              {!status && (
                                <Badge variant='secondary' className='bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'>
                                  Pending
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className='text-xs text-muted-foreground mt-1 space-y-0.5 pl-2 border-l-2 ml-1'>
                            {item.changes.map((change) => (
                              <div key={change}>{change}</div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    <div ref={logEndRef} />
                  </div>
                </ScrollArea>
              </div>
            </>
          )}
        </div>

        <DialogFooter className='flex-shrink-0'>
          <Button variant='outline' onClick={handleClose} disabled={syncing}>
            {t('common.buttons.cancel')}
          </Button>
          <Button
            onClick={handleSyncAll}
            disabled={hasNoChanges || syncing}
          >
            {syncing ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                {t('common.buttons.confirm')}
              </>
            ) : (
              t('common.buttons.confirm')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
