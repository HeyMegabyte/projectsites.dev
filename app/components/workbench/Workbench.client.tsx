import { useStore } from '@nanostores/react';
import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import type { FileHistory } from '~/types/actions';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { IconButton } from '~/components/ui/IconButton';
import { Slider, type SliderOptions } from '~/components/ui/Slider';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { renderLogger } from '~/utils/logger';
import { EditorPanel } from './EditorPanel';
import { Preview } from './Preview';
import useViewport from '~/lib/hooks';

import { usePreviewStore } from '~/lib/stores/previews';
import { chatStore } from '~/lib/stores/chat';
import type { ElementInfo } from './Inspector';
import { ExportChatButton } from '~/components/chat/chatExportAndImport/ExportChatButton';
import { useChatHistory } from '~/lib/persistence';
import { streamingState } from '~/lib/stores/streaming';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

interface WorkspaceProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
  metadata?: {
    gitUrl?: string;
  };
  updateChatMestaData?: (metadata: any) => void;
  setSelectedElement?: (element: ElementInfo | null) => void;
}

const viewTransition = { ease: cubicEasingFn };

const sliderOptions: SliderOptions<WorkbenchViewType> = {
  left: {
    value: 'code',
    text: 'Code',
  },
  right: {
    value: 'preview',
    text: 'Preview',
  },
};

const VIEW_ORDER: WorkbenchViewType[] = ['code', 'preview'];

function getViewX(view: WorkbenchViewType, selectedView: WorkbenchViewType): string {
  const viewIndex = VIEW_ORDER.indexOf(view);
  const selectedIndex = VIEW_ORDER.indexOf(selectedView);

  if (viewIndex < selectedIndex) {
    return '-100%';
  }

  if (viewIndex > selectedIndex) {
    return '100%';
  }

  return '0%';
}

const workbenchVariants = {
  closed: {
    width: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    width: 'var(--workbench-width)',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

export const Workbench = memo(
  ({
    chatStarted,
    isStreaming,
    metadata: _metadata,
    updateChatMestaData: _updateChatMestaData,
    setSelectedElement,
  }: WorkspaceProps) => {
    renderLogger.trace('Workbench');

    const [fileHistory] = useState<Record<string, FileHistory>>({});

    // const modifiedFiles = Array.from(useStore(workbenchStore.unsavedFiles).keys());

    const hasPreview = useStore(computed(workbenchStore.previews, (previews) => previews.length > 0));
    const showWorkbench = useStore(workbenchStore.showWorkbench);
    const selectedFile = useStore(workbenchStore.selectedFile);
    const currentDocument = useStore(workbenchStore.currentDocument);
    const unsavedFiles = useStore(workbenchStore.unsavedFiles);
    const files = useStore(workbenchStore.files);
    const selectedView = useStore(workbenchStore.currentView);
    const { showChat } = useStore(chatStore);
    const canHideChat = showWorkbench || !showChat;

    const isSmallViewport = useViewport(1024);
    const streaming = useStore(streamingState);
    const { exportChat } = useChatHistory();
    const [isSyncing, setIsSyncing] = useState(false);

    const setSelectedView = (view: WorkbenchViewType) => {
      workbenchStore.currentView.set(view);
    };

    useEffect(() => {
      if (hasPreview) {
        setSelectedView('preview');
      }
    }, [hasPreview]);

    useEffect(() => {
      workbenchStore.setDocuments(files);
    }, [files]);

    const onEditorChange = useCallback<OnEditorChange>((update) => {
      workbenchStore.setCurrentDocumentContent(update.content);
    }, []);

    const onEditorScroll = useCallback<OnEditorScroll>((position) => {
      workbenchStore.setCurrentDocumentScrollPosition(position);
    }, []);

    const onFileSelect = useCallback((filePath: string | undefined) => {
      workbenchStore.setSelectedFile(filePath);
    }, []);

    const onFileSave = useCallback(() => {
      workbenchStore
        .saveCurrentDocument()
        .then(() => {
          // Explicitly refresh all previews after a file save
          const previewStore = usePreviewStore();
          previewStore.refreshAllPreviews();
        })
        .catch(() => {
          toast.error('Failed to update file content');
        });
    }, []);

    const onFileReset = useCallback(() => {
      workbenchStore.resetCurrentDocument();
    }, []);

    const handleSyncFiles = useCallback(async () => {
      setIsSyncing(true);

      try {
        const directoryHandle = await window.showDirectoryPicker();
        await workbenchStore.syncFiles(directoryHandle);
        toast.success('Files synced successfully');
      } catch (error) {
        console.error('Error syncing files:', error);
        toast.error('Failed to sync files');
      } finally {
        setIsSyncing(false);
      }
    }, []);

    return (
      chatStarted && (
        <motion.div
          initial="closed"
          animate={showWorkbench ? 'open' : 'closed'}
          variants={workbenchVariants}
          className="z-workbench"
        >
          <div
            className={classNames(
              'fixed top-[calc(var(--header-height)+1.2rem)] bottom-6 w-[var(--workbench-inner-width)] z-0 transition-[left,width] duration-200 bolt-ease-cubic-bezier',
              {
                'w-full': isSmallViewport,
                'left-0': showWorkbench && isSmallViewport,
                'left-[var(--workbench-left)]': showWorkbench,
                'left-[100%]': !showWorkbench,
              },
            )}
          >
            <div className="absolute inset-0 px-2 lg:px-4">
              <div className="h-full flex flex-col bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor shadow-sm rounded-lg overflow-hidden">
                <div className="flex items-center px-3 py-2 border-b border-bolt-elements-borderColor gap-1.5">
                  <button
                    className={`${showChat ? 'i-ph:sidebar-simple-fill' : 'i-ph:sidebar-simple'} text-lg text-bolt-elements-textSecondary mr-1`}
                    disabled={!canHideChat || isSmallViewport}
                    onClick={() => {
                      if (canHideChat) {
                        chatStore.setKey('showChat', !showChat);
                      }
                    }}
                  />
                  <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />
                  <div className="ml-auto" />
                  {selectedView === 'code' && (
                    <div className="flex overflow-y-auto">
                      {/* Export Chat Button */}
                      <ExportChatButton exportChat={exportChat} />

                      {/* Sync Button */}
                      <div className="flex border border-bolt-elements-borderColor rounded-md overflow-hidden ml-1">
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger
                            disabled={isSyncing || streaming}
                            className="rounded-md items-center justify-center [&:is(:disabled,.disabled)]:cursor-not-allowed [&:is(:disabled,.disabled)]:opacity-60 px-3 py-1.5 text-xs bg-accent-500 text-white hover:text-bolt-elements-item-contentAccent [&:not(:disabled,.disabled)]:hover:bg-bolt-elements-button-primary-backgroundHover outline-accent-500 flex gap-1.7"
                          >
                            {isSyncing ? 'Syncing...' : 'Sync'}
                            <span className={classNames('i-ph:caret-down transition-transform')} />
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Content
                            className={classNames(
                              'min-w-[240px] z-[250]',
                              'bg-white dark:bg-[#141414]',
                              'rounded-lg shadow-lg',
                              'border border-gray-200/50 dark:border-gray-800/50',
                              'animate-in fade-in-0 zoom-in-95',
                              'py-1',
                            )}
                            sideOffset={5}
                            align="end"
                          >
                            <DropdownMenu.Item
                              className={classNames(
                                'cursor-pointer flex items-center w-full px-4 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive gap-2 rounded-md group relative',
                              )}
                              onClick={handleSyncFiles}
                              disabled={isSyncing}
                            >
                              <div className="flex items-center gap-2">
                                {isSyncing ? (
                                  <div className="i-ph:spinner" />
                                ) : (
                                  <div className="i-ph:cloud-arrow-down" />
                                )}
                                <span>{isSyncing ? 'Syncing...' : 'Sync Files'}</span>
                              </div>
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Root>
                      </div>
                    </div>
                  )}

                  <IconButton
                    icon="i-ph:x-circle"
                    className="-mr-1"
                    size="xl"
                    onClick={() => {
                      workbenchStore.showWorkbench.set(false);
                    }}
                  />
                </div>
                <div className="relative flex-1 overflow-hidden">
                  <View initial={{ x: '0%' }} animate={{ x: getViewX('code', selectedView) }}>
                    <EditorPanel
                      editorDocument={currentDocument}
                      isStreaming={isStreaming}
                      selectedFile={selectedFile}
                      files={files}
                      unsavedFiles={unsavedFiles}
                      fileHistory={fileHistory}
                      onFileSelect={onFileSelect}
                      onEditorScroll={onEditorScroll}
                      onEditorChange={onEditorChange}
                      onFileSave={onFileSave}
                      onFileReset={onFileReset}
                    />
                  </View>
                  <View initial={{ x: '100%' }} animate={{ x: getViewX('preview', selectedView) }}>
                    <Preview setSelectedElement={setSelectedElement} />
                  </View>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )
    );
  },
);

// View component for rendering content with motion transitions
interface ViewProps extends HTMLMotionProps<'div'> {
  children: JSX.Element;
}

const View = memo(({ children, ...props }: ViewProps) => {
  return (
    <motion.div className="absolute inset-0" transition={viewTransition} {...props}>
      {children}
    </motion.div>
  );
});
