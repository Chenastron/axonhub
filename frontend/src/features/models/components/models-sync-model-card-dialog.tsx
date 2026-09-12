import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/utils/format-number';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useModels } from '../context/models-context';
import { useUpdateModel } from '../data/models';
import { findProviderModel, buildModelCardFromProviderModel, isModelCardEqual } from '../data/providers';
import { useDevelopersData } from '../data/providers';
import { ModelCard } from '../data/schema';

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '-';
  if (Array.isArray(value)) return value.length === 0 ? '-' : value.join(', ');
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  return String(value);
}

function buildRows(card: ModelCard | undefined) {
  if (!card) return [];
  return [
    { label: 'models.modelCard.reasoning', value: `${card.reasoning?.supported ? '✓' : '✗'}${card.reasoning?.default ? ' (default)' : ''}` },
    { label: 'models.modelCard.toolCall', value: formatValue(card.toolCall) },
    { label: 'models.modelCard.vision', value: formatValue(card.vision) },
    { label: 'models.modelCard.temperature', value: formatValue(card.temperature) },
    { label: 'models.modelCard.input', value: formatValue(card.modalities?.input) },
    { label: 'models.modelCard.output', value: formatValue(card.modalities?.output) },
    { label: 'models.modelCard.cost', value: card.cost ? `$${card.cost.input}/${card.cost.output}` : '-' },
    { label: 'models.modelCard.context', value: formatValue(card.limit?.context) },
    { label: 'models.modelCard.maxOutput', value: formatValue(card.limit?.output) },
    { label: 'models.modelCard.knowledge', value: formatValue(card.knowledge) },
    { label: 'models.modelCard.releaseDate', value: formatValue(card.releaseDate) },
    { label: 'models.modelCard.lastUpdated', value: formatValue(card.lastUpdated) },
  ];
}

export function ModelsSyncModelCardDialog() {
  const { t } = useTranslation();
  const { open, setOpen, currentRow } = useModels();
  const updateModel = useUpdateModel();
  const { data: developersData } = useDevelopersData();

  const isOpen = open === 'sync';

  const providerModel = useMemo(() => {
    if (!isOpen || !currentRow) return null;
    return findProviderModel(developersData, currentRow.developer, currentRow.modelID);
  }, [isOpen, currentRow, developersData]);

  const newModelCard = useMemo(() => {
    if (!providerModel) return undefined;
    return buildModelCardFromProviderModel(providerModel);
  }, [providerModel]);

  const hasChanges = useMemo(() => {
    if (!currentRow || !newModelCard) return false;
    return !isModelCardEqual(currentRow.modelCard, newModelCard);
  }, [currentRow, newModelCard]);

  const currentRows = useMemo(() => buildRows(currentRow?.modelCard), [currentRow]);
  const newRows = useMemo(() => buildRows(newModelCard), [newModelCard]);

  const handleSync = async () => {
    if (!currentRow || !newModelCard) return;
    try {
      await updateModel.mutateAsync({
        id: currentRow.id,
        input: {
          developer: currentRow.developer,
          modelID: currentRow.modelID,
          type: currentRow.type,
          name: currentRow.name,
          icon: currentRow.icon,
          group: currentRow.group,
          modelCard: newModelCard,
          settings: currentRow.settings,
          remark: currentRow.remark,
        },
      });
      setOpen(null);
    } catch {
      // Error handled by mutation
    }
  };

  const handleClose = () => setOpen(null);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{t('models.dialogs.syncModelCard.title')}</DialogTitle>
          <DialogDescription>
            {t('models.dialogs.syncModelCard.description', { name: currentRow?.name })}
          </DialogDescription>
        </DialogHeader>

        {!providerModel ? (
          <div className='rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'>
            {t('models.dialogs.syncModelCard.noProviderData', { developer: currentRow?.developer })}
          </div>
        ) : (
          <>
            <div className='rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-200'>
              {t('models.dialogs.syncModelCard.warning')}
            </div>

            <div className='max-h-[50vh] overflow-auto rounded-md border'>
              <table className='w-full text-sm'>
                <thead className='sticky top-0 bg-muted'>
                  <tr>
                    <th className='p-2 text-left font-medium'>{t('models.modelCard.title')}</th>
                    <th className='p-2 text-left font-medium'>{t('models.dialogs.syncModelCard.currentSection')}</th>
                    <th className='p-2 text-left font-medium'>{t('models.dialogs.syncModelCard.newSection')}</th>
                  </tr>
                </thead>
                <tbody>
                  {currentRows.map((row, idx) => {
                    const newVal = newRows[idx]?.value;
                    const changed = row.value !== newVal;
                    return (
                      <tr key={row.label} className='border-t'>
                        <td className='p-2 text-muted-foreground'>{t(row.label)}</td>
                        <td className='p-2'>{row.value}</td>
                        <td className='p-2'>
                          {changed ? (
                            <Badge variant='secondary' className='bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'>
                              {newVal}
                            </Badge>
                          ) : (
                            newVal
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant='outline' onClick={handleClose}>
            {t('common.buttons.cancel')}
          </Button>
          <Button
            onClick={handleSync}
            disabled={!providerModel || !hasChanges || updateModel.isPending}
          >
            {t('common.buttons.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
