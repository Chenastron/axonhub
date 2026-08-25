import { useEffect, useState } from 'react';
import { AlertCircle, Check, Loader2, ChevronDown, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useChannels } from '../context/channels-context';
import { useCleanInvalidChannelModels, useCleanInvalidChannelModelsStatus } from '../data/channels';

export function ChannelsCleanInvalidModelsDialog() {
  const { t } = useTranslation();
  const { open, setOpen } = useChannels();
  const queryClient = useQueryClient();
  
  const isOpen = open === 'cleanInvalidModels';

  // Queries & Mutations
  const cleanMutation = useCleanInvalidChannelModels();
  const { data: status, refetch: refetchStatus } = useCleanInvalidChannelModelsStatus(isOpen);
  
  // Local UI States
  const [failuresOpen, setFailuresOpen] = useState(false);
  
  // Tracking whether we have initiated or inherited an active cleanup task in the current dialog session
  const [hasStartedThisTime, setHasStartedThisTime] = useState(false);

  // Automatically sync with backend task state: if it is already running on open, inherit it
  useEffect(() => {
    if (isOpen && status?.running) {
      setHasStartedThisTime(true);
    }
  }, [isOpen, status?.running]);

  // Periodically poll backend status while dialog is open and task is running
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isOpen && status?.running) {
      timer = setInterval(() => {
        refetchStatus();
      }, 2000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isOpen, status?.running, refetchStatus]);

  // 1. Initial State: No task has been started in this dialog session
  const isInitialState = !hasStartedThisTime;

  // 2. Currently Cleaning State: Mutation is pending, or background job is running
  const isCurrentlyCleaning = hasStartedThisTime && (cleanMutation.isPending || (status?.running ?? false));

  // 3. Finished Results State: Task completed within this session and we have real stats or errors
  const showResults = hasStartedThisTime && !status?.running && status?.finished;

  // Progress Calculations
  const scanned = status?.scanned ?? 0;
  const total = status?.total ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((scanned / total) * 100)) : 0;

  // Expand failures list automatically when results are first shown
  useEffect(() => {
    if (showResults && status?.failures && status.failures.length > 0) {
      setFailuresOpen(true);
    }
  }, [showResults, status?.failures]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !isCurrentlyCleaning) {
      setFailuresOpen(false);
      setHasStartedThisTime(false); // Safely reset session state on close
      
      // Wipe the cached query data to prevent the stale "cleanup completed" screen from showing next time
      queryClient.setQueryData(['cleanInvalidChannelModelsStatus', isOpen], null);
      
      setOpen(null);
    }
  };

  const handleClean = async () => {
    if (isCurrentlyCleaning) return;
    try {
      setHasStartedThisTime(true); // Mark session as started
      
      // Clear any stale cached data from the previous run immediately to prevent instant flashing of old reports
      queryClient.setQueryData(['cleanInvalidChannelModelsStatus', isOpen], null);
      
      // Launch background cleanup task
      await cleanMutation.mutateAsync();
      
      // Instantly refresh current status state
      await refetchStatus();
    } catch (_error) {
      // Handled by global graphql client error-handler
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className='flex max-h-[90vh] flex-col sm:max-w-md' data-testid='clean-invalid-models-dialog'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Trash2 className='h-5 w-5 text-destructive' />
            {t('channels.cleanInvalidModels.title', '清理失效模型')}
          </DialogTitle>
          <DialogDescription>
            {t('channels.cleanInvalidModels.description', '此操作会查询所有渠道上游支持的模型列表，并移除已不存在于上游的失效模型关联。')}
          </DialogDescription>
        </DialogHeader>

        <div className='flex min-h-0 flex-1 flex-col gap-4 py-2'>
          {isCurrentlyCleaning && (
            <div className='text-muted-foreground flex min-h-32 flex-col items-center justify-center gap-4 text-sm text-center px-2 py-4'>
              <div className='relative flex items-center justify-center'>
                <Loader2 className='h-10 w-10 animate-spin text-primary' />
                <span className='absolute text-[10px] font-mono font-bold text-primary/95'>{percent}%</span>
              </div>
              <div className='space-y-1 w-full'>
                <span className='font-semibold text-foreground block'>
                  {t('channels.cleanInvalidModels.cleaning', '正在检测并清理失效模型...')}
                </span>
                <span className='text-xs text-muted-foreground block'>
                  {t('channels.cleanInvalidModels.scanningProgress', '已扫描 {{scanned}} / {{total}} 个渠道', { scanned, total })}
                </span>
              </div>

              {/* High-quality animated progress bar */}
              <div className='w-full bg-muted rounded-full h-2 overflow-hidden border border-muted-foreground/10'>
                <div 
                  className='bg-primary h-full transition-all duration-500 ease-out rounded-full shadow-sm shadow-primary/20'
                  style={{ width: `${percent}%` }}
                />
              </div>

              <div className='text-[10px] text-muted-foreground/75 leading-relaxed bg-muted/30 border border-muted-foreground/5 rounded-lg p-2.5 space-y-1 text-left w-full'>
                <div className='flex items-center gap-1 font-medium text-primary'>
                  <AlertCircle className='h-3.5 w-3.5' />
                  <span>{t('channels.cleanInvalidModels.speedTitle', '速度与高可用保障')}</span>
                </div>
                <div>{t('channels.cleanInvalidModels.timeoutNotice', '系统为每个渠道分配了 5 秒硬超时限制。网络阻塞的失效渠道将被快速跳过，避免长队挂起。')}</div>
                <div className='text-muted-foreground/75'>{t('channels.cleanInvalidModels.asyncNotice', '扫描任务已在后台开启，您可以在当前界面等待，或者关闭窗口稍后查看。')}</div>
              </div>
            </div>
          )}

          {isInitialState && !isCurrentlyCleaning && (
            <div className='bg-muted/30 border-destructive/20 text-muted-foreground rounded-lg border p-3 text-xs leading-relaxed'>
              <div className='mb-1 flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400'>
                <AlertCircle className='h-4 w-4 shrink-0' />
                <span>{t('channels.cleanInvalidModels.warningTitle', '安全清理须知')}</span>
              </div>
              <ul className='list-disc pl-4 space-y-1 text-muted-foreground/90'>
                <li>{t('channels.cleanInvalidModels.warningItem1', '仅对成功拉取到非空模型的渠道进行清理，避免由于网络或密钥欠费而误删。')}</li>
                <li>{t('channels.cleanInvalidModels.warningItem2', '若某个渠道没有拉取成功，其失效模型将被保留以防误删，并在结束后列出失败渠道。')}</li>
              </ul>
            </div>
          )}

          {showResults && status && (
            <div className='flex min-h-0 flex-1 flex-col gap-4'>
              {status.error ? (
                <div className='bg-destructive/10 border-destructive/30 text-destructive flex items-start gap-3 rounded-lg border p-3 text-sm'>
                  <AlertCircle className='h-5 w-5 shrink-0 mt-0.5' />
                  <div>
                    <div className='font-semibold'>{t('channels.cleanInvalidModels.errorTitle', '清理失败')}</div>
                    <div className='text-xs mt-1 leading-relaxed'>{status.error}</div>
                  </div>
                </div>
              ) : (
                <div className='bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800 flex items-start gap-3 rounded-lg border p-3 text-sm'>
                  <Check className='h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5' />
                  <div className='space-y-1.5'>
                    <div className='font-semibold text-emerald-800 dark:text-emerald-400'>
                      {t('channels.cleanInvalidModels.successTitle', '清理完成')}
                    </div>
                    <div className='text-muted-foreground text-xs space-y-1'>
                      <div>
                        {t('channels.cleanInvalidModels.scanned', '已扫描渠道数')}:{' '}
                        <span className='font-mono font-bold text-foreground'>{status.scanned}</span>
                      </div>
                      <div>
                        {t('channels.cleanInvalidModels.cleaned', '已清理渠道数')}:{' '}
                        <span className='font-mono font-bold text-foreground'>{status.cleaned}</span>
                      </div>
                      <div>
                        {t('channels.cleanInvalidModels.removedCount', '删除的模型关联')}:{' '}
                        <span className='font-mono font-bold text-destructive'>{status.removedAssociations}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {status.failures && status.failures.length > 0 && (
                <Collapsible open={failuresOpen} onOpenChange={setFailuresOpen} className='border-destructive/30 rounded-md border min-h-0 flex flex-col'>
                  <CollapsibleTrigger asChild>
                    <Button type='button' variant='ghost' className='text-destructive h-auto w-full justify-between gap-2 px-3 py-2 shrink-0'>
                      <span className='flex min-w-0 items-center gap-2 text-xs font-medium'>
                        <AlertCircle className='h-4 w-4 shrink-0' />
                        {t('channels.cleanInvalidModels.failureCount', '有 {{count}} 个渠道拉取失败，已跳过清理', { count: status.failures.length })}
                      </span>
                      <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${failuresOpen ? 'rotate-180' : ''}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className='min-h-0 flex-1 overflow-y-auto max-h-40 border-t'>
                    <div className='space-y-2 px-3 py-2'>
                      {status.failures.map((failure) => (
                        <div key={failure.channelID} className='text-xs border-b last:border-b-0 pb-1.5 last:pb-0'>
                          <div className='font-medium text-foreground'>{failure.channelName}</div>
                          <div className='text-muted-foreground break-words mt-0.5 text-[10px]'>{failure.error}</div>
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
          {isInitialState && !isCurrentlyCleaning ? (
            <>
              <Button type='button' variant='outline' onClick={() => handleOpenChange(false)}>
                {t('common.buttons.cancel')}
              </Button>
              <Button
                type='button'
                variant='destructive'
                onClick={handleClean}
                data-testid='confirm-clean-invalid-models'
              >
                {t('channels.cleanInvalidModels.confirmAction', '确认清理')}
              </Button>
            </>
          ) : (
            <Button type='button' className='w-full' onClick={() => handleOpenChange(false)} disabled={isCurrentlyCleaning}>
              {t('common.buttons.close', '关闭')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
