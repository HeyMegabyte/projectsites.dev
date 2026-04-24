import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts } from '~/lib/hooks';
import { description, useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROMPT_COOKIE_KEY, PROVIDER_LIST } from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';
import Cookies from 'js-cookie';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { useSearchParams } from '@remix-run/react';
import { createSampler } from '~/utils/sampler';
import { getTemplates, selectStarterTemplate } from '~/utils/selectStarterTemplate';
import { logStore } from '~/lib/stores/logs';
import { streamingState } from '~/lib/stores/streaming';
import { filesToArtifacts } from '~/utils/fileUtils';
import { supabaseConnection } from '~/lib/stores/supabase';
import { defaultDesignScheme, type DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';
import type { TextUIPart, FileUIPart, Attachment } from '@ai-sdk/ui-utils';
import { useMCPStore } from '~/lib/stores/mcp';
import type { LlmErrorAlertType } from '~/types/actions';
import { isEmbedded, onParentMessage, postToParent, type ParentToChildMessage } from '~/lib/embed/embedded-mode';

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory, importChat, exportChat } = useChatHistory();
  const title = useStore(description);
  useEffect(() => {
    workbenchStore.setReloadedMessages(initialMessages.map((m) => m.id));
  }, [initialMessages]);

  return (
    <>
      {ready && (
        <ChatImpl
          description={title}
          initialMessages={initialMessages}
          exportChat={exportChat}
          storeMessageHistory={storeMessageHistory}
          importChat={importChat}
        />
      )}
    </>
  );
}

const processSampledMessages = createSampler(
  (options: {
    messages: Message[];
    initialMessages: Message[];
    isLoading: boolean;
    parseMessages: (messages: Message[], isLoading: boolean) => void;
    storeMessageHistory: (messages: Message[]) => Promise<void>;
  }) => {
    const { messages, initialMessages, isLoading, parseMessages, storeMessageHistory } = options;
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  },
  50,
);

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
}

export const ChatImpl = memo(
  ({ description, initialMessages, storeMessageHistory, importChat, exportChat }: ChatProps) => {
    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [imageDataList, setImageDataList] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const importTriggeredRef = useRef(false);
    const [fakeLoading, setFakeLoading] = useState(false);
    const files = useStore(workbenchStore.files);
    const [designScheme, setDesignScheme] = useState<DesignScheme>(defaultDesignScheme);
    const actionAlert = useStore(workbenchStore.alert);
    const deployAlert = useStore(workbenchStore.deployAlert);
    const supabaseConn = useStore(supabaseConnection);
    const selectedProject = supabaseConn.stats?.projects?.find(
      (project) => project.id === supabaseConn.selectedProjectId,
    );
    const supabaseAlert = useStore(workbenchStore.supabaseAlert);
    const { activeProviders, promptId, autoSelectTemplate, contextOptimizationEnabled } = useSettings();
    const [llmErrorAlert, setLlmErrorAlert] = useState<LlmErrorAlertType | undefined>(undefined);
    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return savedModel || DEFAULT_MODEL;
    });
    const [provider, setProvider] = useState(() => {
      const savedProvider = Cookies.get('selectedProvider');
      return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
    });
    const { showChat } = useStore(chatStore);
    const [animationScope, animate] = useAnimate();
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
    const [chatMode, setChatMode] = useState<'discuss' | 'build'>('build');
    const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(null);
    const mcpSettings = useMCPStore((state) => state.settings);

    const {
      messages,
      isLoading,
      input,
      handleInputChange,
      setInput,
      stop,
      append,
      setMessages,
      reload,
      error,
      data: chatData,
      setData,
      addToolResult,
    } = useChat({
      api: '/api/chat',
      body: {
        apiKeys,
        files,
        promptId,
        contextOptimization: contextOptimizationEnabled,
        chatMode,
        designScheme,
        supabase: {
          isConnected: supabaseConn.isConnected,
          hasSelectedProject: !!selectedProject,
          credentials: {
            supabaseUrl: supabaseConn?.credentials?.supabaseUrl,
            anonKey: supabaseConn?.credentials?.anonKey,
          },
        },
        maxLLMSteps: mcpSettings.maxLLMSteps,
      },
      sendExtraMessageFields: true,
      onError: (e) => {
        setFakeLoading(false);
        handleError(e, 'chat');
      },
      onFinish: (message, response) => {
        const usage = response.usage;
        setData(undefined);

        if (usage) {
          console.log('Token usage:', usage);
          logStore.logProvider('Chat response completed', {
            component: 'Chat',
            action: 'response',
            model,
            provider: provider.name,
            usage,
            messageLength: message.content.length,
          });
        }

        logger.debug('Finished streaming');

        // Notify parent frame when generation completes (embedded mode)
        if (isEmbedded) {
          postToParent({
            type: 'PS_GENERATION_STATUS',
            status: 'complete',
            correlationId: '',
          });
        }

        // Auto-deploy to Project Sites if autoSubmit was used (from waiting page redirect)
        const urlParams = new URLSearchParams(window.location.search);

        if (urlParams.get('autoSubmit') === 'true' && urlParams.get('slug')) {
          const slug = urlParams.get('slug')!;
          const siteId = urlParams.get('siteId') || '';
          console.warn('[auto-deploy] Generation complete — deploying to Project Sites:', slug);

          // Give a moment for files to finalize, then deploy
          setTimeout(async () => {
            try {
              toast.info('Deploying to Project Sites...');

              const files = workbenchStore.getTextFiles();
              const fileList = Object.entries(files).map(([path, content]) => ({
                path: path.replace(/^\/home\/project\//, ''),
                content,
              }));

              if (fileList.length === 0) {
                toast.error('No files to deploy');
                return;
              }

              const chatExport = {
                messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
                description: description || slug,
                exportDate: new Date().toISOString(),
              };

              // Use publish-bolt API if we have a siteId
              const publishUrl = siteId
                ? `https://projectsites.dev/api/sites/${siteId}/publish-bolt`
                : 'https://projectsites.dev/api/publish/bolt';

              const res = await fetch(publishUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: fileList, chat: chatExport, slug }),
              });

              if (res.ok) {
                toast.success(`Deployed ${fileList.length} files to ${slug}.projectsites.dev!`);

                // Redirect to the live site after a moment
                setTimeout(() => {
                  window.location.href = `https://${slug}.projectsites.dev`;
                }, 3000);
              } else {
                const err = await res.text();
                toast.error('Deploy failed: ' + err.substring(0, 100));
              }
            } catch (err) {
              console.warn('[auto-deploy] Failed:', err);
              toast.error('Auto-deploy failed');
            }
          }, 2000);
        }
      },
      initialMessages,
      initialInput: Cookies.get(PROMPT_COOKIE_KEY) || '',
    });

    // ── Embedded mode: postMessage bridge ──
    useEffect(() => {
      if (!isEmbedded) {
        return;
      }

      const unsub = onParentMessage((msg: ParentToChildMessage) => {
        if (msg.type === 'PS_SUBMIT_PROMPT') {
          // Auto-submit prompt from parent frame
          postToParent({
            type: 'PS_GENERATION_STATUS',
            status: 'generating',
            correlationId: msg.correlationId,
          });
          runAnimation();
          append({
            role: 'user',
            content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${msg.prompt}`,
          });
        } else if (msg.type === 'PS_IMPORT_FILES') {
          // Import files from parent into the workbench editor
          const fileEntries = Object.entries(msg.files);

          if (fileEntries.length > 0) {
            // Create a synthetic assistant message with boltArtifact to load files
            const fileActions = fileEntries
              .map(([filePath, content]) => `<boltAction type="file" filePath="${filePath}">${content}</boltAction>`)
              .join('\n');

            const artifactMsg = `<boltArtifact id="imported-site" title="Imported Site Files">\n${fileActions}\n</boltArtifact>`;

            setMessages([
              ...messages,
              {
                id: `import-${Date.now()}`,
                role: 'assistant' as const,
                content: artifactMsg,
              },
            ]);
            toast.success(`Imported ${fileEntries.length} files from Project Sites`);
          }
        } else if (msg.type === 'PS_REQUEST_FILES') {
          // Send current files back to parent, optionally including chat export
          const textFiles = workbenchStore.getTextFiles();
          const response: {
            type: 'PS_FILES_READY';
            files: Record<string, string>;
            chat?: { messages: unknown[]; description?: string; exportDate: string };
            correlationId: string;
          } = {
            type: 'PS_FILES_READY',
            files: textFiles,
            correlationId: msg.correlationId,
          };

          if (msg.includeChat) {
            response.chat = {
              messages: messages.map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                createdAt: m.createdAt,
              })),
              description: description || 'bolt.diy session',
              exportDate: new Date().toISOString(),
            };
          }

          postToParent(response);
        } else if (msg.type === 'PS_LOAD_BUILD_CONTEXT') {
          // Fetch build context JSON and auto-generate website
          fetch(msg.contextUrl)
            .then((res) => res.json())
            .then((ctx: any) => {
              // Display the context as a "Project Brief" user message
              const briefLines = [
                `# Project Brief: ${ctx.business?.name || 'Website'}`,
                '',
                ctx.business?.address ? `**Address:** ${ctx.business.address}` : '',
                ctx.business?.phone ? `**Phone:** ${ctx.business.phone}` : '',
                ctx.business?.category ? `**Industry:** ${ctx.business.category}` : '',
                '',
                '## Available Assets',
                ...(ctx.assets || []).map((a: any) => `- ${a.name} (${a.confidence || '?'}% confidence) — ${a.url}`),
                '',
                '## Design Instructions',
                ctx.instructions || 'Build a modern, gorgeous website using the provided assets.',
              ]
                .filter(Boolean)
                .join('\n');

              // Set the brief as a user message, then auto-submit generation prompt
              setMessages([...messages, { id: `brief-${Date.now()}`, role: 'user' as const, content: briefLines }]);

              // After a small delay, submit the generation prompt
              setTimeout(() => {
                postToParent({ type: 'PS_GENERATION_STATUS', status: 'generating', correlationId: msg.correlationId });
                runAnimation();

                const assetList = (ctx.assets || [])
                  .filter((a: any) => a.url)
                  .map((a: any) => `${a.name}: ${a.url}`)
                  .join('\n');
                append({
                  role: 'user',
                  content: [
                    `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n`,
                    `Build a complete, gorgeous, animated portfolio website for "${ctx.business?.name || 'the business'}" using the assets and details in the project brief above.`,
                    '',
                    'Use these asset URLs directly in <img> tags:',
                    assetList,
                    '',
                    ctx.instructions || '',
                    '',
                    'Create index.html, privacy.html, and terms.html. Use modern CSS animations, responsive design, and the exact brand colors from the research.',
                  ].join('\n'),
                });
              }, 500);
            })
            .catch((err) => {
              console.warn('[embed] Failed to load build context:', err);
              toast.error('Failed to load project context');
            });
        }
      });

      // eslint-disable-next-line consistent-return
      return unsub;
    }, [model, provider, append, messages, setMessages]);

    useEffect(() => {
      const prompt = searchParams.get('prompt');

      // console.log(prompt, searchParams, model, provider);

      if (prompt) {
        setSearchParams({});
        runAnimation();
        append({
          role: 'user',
          content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${prompt}`,
        });
      }
    }, [model, provider, searchParams]);

    // Handle importChatFrom URL parameter (used by Project Sites "Edit" button)
    useEffect(() => {
      const importUrl = searchParams.get('importChatFrom');

      if (importUrl && !importTriggeredRef.current) {
        importTriggeredRef.current = true;
        setSearchParams({});

        toast.info('Importing chat from Project Sites...');

        fetch(importUrl)
          .then((res) => {
            if (!res.ok) {
              throw new Error('Failed to fetch chat data');
            }

            return res.json();
          })
          .then((data) => {
            const chatData = data as { messages?: unknown[]; description?: string };

            if (chatData && chatData.messages && Array.isArray(chatData.messages)) {
              importChat(chatData.description || 'Imported from Project Sites', chatData.messages as Message[]);
            } else {
              toast.error('Invalid chat data format');
            }
          })
          .catch((err: Error) => {
            toast.error('Failed to import chat: ' + err.message);
          });
      }
    }, [searchParams]);

    // Handle buildContext URL parameter (used by waiting page to auto-generate from research)
    const buildContextTriggeredRef = useRef(false);
    useEffect(() => {
      const contextUrl = searchParams.get('buildContext');

      if (contextUrl && !buildContextTriggeredRef.current) {
        buildContextTriggeredRef.current = true;
        setSearchParams({});

        toast.info('Loading project context...');

        fetch(contextUrl)
          .then((res) => {
            if (!res.ok) {
              throw new Error(`Failed to fetch build context: ${res.status}`);
            }

            return res.json();
          })
          .then((ctx: any) => {
            const briefLines = [
              `# Project Brief: ${ctx.business?.name || 'Website'}`,
              '',
              ctx.business?.address ? `**Address:** ${ctx.business.address}` : '',
              ctx.business?.phone ? `**Phone:** ${ctx.business.phone}` : '',
              ctx.business?.category ? `**Industry:** ${ctx.business.category}` : '',
              '',
              '## Design Instructions',
              ctx.instructions || 'Build a modern, gorgeous website.',
              '',
              '## Available Assets',
              ...(ctx.assets || []).map((a: any) => `- ${a.name} — ${a.url}`),
            ]
              .filter(Boolean)
              .join('\n');

            // Show brief as context, then auto-submit generation prompt
            const assetList = (ctx.assets || [])
              .filter((a: any) => a.url)
              .map((a: any) => `${a.name}: ${a.url}`)
              .join('\n');

            runAnimation();

            if (isEmbedded) {
              postToParent({ type: 'PS_GENERATION_STATUS', status: 'generating', correlationId: 'auto' });
            }

            append({
              role: 'user',
              content: [
                `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n`,
                `Build a beautiful, gorgeous, easy-to-use concise website using the project details below.\n`,
                briefLines,
                assetList ? `\nAsset URLs to use in <img> tags:\n${assetList}` : '',
              ].join('\n'),
            });

            toast.success('Building website from project brief...');
          })
          .catch((err: Error) => {
            console.warn('[buildContext] Failed to load:', err);
            toast.error('Failed to load project context');
          });
      }
    }, [searchParams, model, provider]);

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
    const { parsedMessages, parseMessages } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    useEffect(() => {
      chatStore.setKey('started', initialMessages.length > 0);
    }, []);

    useEffect(() => {
      processSampledMessages({
        messages,
        initialMessages,
        isLoading,
        parseMessages,
        storeMessageHistory,
      });
    }, [messages, isLoading, parseMessages]);

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      stop();
      chatStore.setKey('aborted', true);
      workbenchStore.abortAllActions();

      logStore.logProvider('Chat response aborted', {
        component: 'Chat',
        action: 'abort',
        model,
        provider: provider.name,
      });
    };

    const handleError = useCallback(
      (error: any, context: 'chat' | 'template' | 'llmcall' = 'chat') => {
        logger.error(`${context} request failed`, error);

        stop();
        setFakeLoading(false);

        let errorInfo = {
          message: 'An unexpected error occurred',
          isRetryable: true,
          statusCode: 500,
          provider: provider.name,
          type: 'unknown' as const,
          retryDelay: 0,
        };

        if (error.message) {
          try {
            const parsed = JSON.parse(error.message);

            if (parsed.error || parsed.message) {
              errorInfo = { ...errorInfo, ...parsed };
            } else {
              errorInfo.message = error.message;
            }
          } catch {
            errorInfo.message = error.message;
          }
        }

        let errorType: LlmErrorAlertType['errorType'] = 'unknown';
        let title = 'Request Failed';

        if (errorInfo.statusCode === 401 || errorInfo.message.toLowerCase().includes('api key')) {
          errorType = 'authentication';
          title = 'Authentication Error';
        } else if (errorInfo.statusCode === 429 || errorInfo.message.toLowerCase().includes('rate limit')) {
          errorType = 'rate_limit';
          title = 'Rate Limit Exceeded';
        } else if (errorInfo.message.toLowerCase().includes('quota')) {
          errorType = 'quota';
          title = 'Quota Exceeded';
        } else if (errorInfo.statusCode >= 500) {
          errorType = 'network';
          title = 'Server Error';
        }

        logStore.logError(`${context} request failed`, error, {
          component: 'Chat',
          action: 'request',
          error: errorInfo.message,
          context,
          retryable: errorInfo.isRetryable,
          errorType,
          provider: provider.name,
        });

        // Create API error alert
        setLlmErrorAlert({
          type: 'error',
          title,
          description: errorInfo.message,
          provider: provider.name,
          errorType,
        });
        setData([]);
      },
      [provider.name, stop],
    );

    const clearApiErrorAlert = useCallback(() => {
      setLlmErrorAlert(undefined);
    }, []);

    useEffect(() => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.style.height = 'auto';

        const scrollHeight = textarea.scrollHeight;

        textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
        textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
      }
    }, [input, textareaRef]);

    const runAnimation = async () => {
      if (chatStarted) {
        return;
      }

      await Promise.all([
        animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
        animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
      ]);

      chatStore.setKey('started', true);

      setChatStarted(true);
    };

    // Helper function to create message parts array from text and images
    const createMessageParts = (text: string, images: string[] = []): Array<TextUIPart | FileUIPart> => {
      // Create an array of properly typed message parts
      const parts: Array<TextUIPart | FileUIPart> = [
        {
          type: 'text',
          text,
        },
      ];

      // Add image parts if any
      images.forEach((imageData) => {
        // Extract correct MIME type from the data URL
        const mimeType = imageData.split(';')[0].split(':')[1] || 'image/jpeg';

        // Create file part according to AI SDK format
        parts.push({
          type: 'file',
          mimeType,
          data: imageData.replace(/^data:image\/[^;]+;base64,/, ''),
        });
      });

      return parts;
    };

    // Helper function to convert File[] to Attachment[] for AI SDK
    const filesToAttachments = async (files: File[]): Promise<Attachment[] | undefined> => {
      if (files.length === 0) {
        return undefined;
      }

      const attachments = await Promise.all(
        files.map(
          (file) =>
            new Promise<Attachment>((resolve) => {
              const reader = new FileReader();

              reader.onloadend = () => {
                resolve({
                  name: file.name,
                  contentType: file.type,
                  url: reader.result as string,
                });
              };
              reader.readAsDataURL(file);
            }),
        ),
      );

      return attachments;
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
      const messageContent = messageInput || input;

      if (!messageContent?.trim()) {
        return;
      }

      if (isLoading) {
        abort();
        return;
      }

      let finalMessageContent = messageContent;

      if (selectedElement) {
        console.log('Selected Element:', selectedElement);

        const elementInfo = `<div class=\"__boltSelectedElement__\" data-element='${JSON.stringify(selectedElement)}'>${JSON.stringify(`${selectedElement.displayText}`)}</div>`;
        finalMessageContent = messageContent + elementInfo;
      }

      runAnimation();

      if (!chatStarted) {
        setFakeLoading(true);

        if (autoSelectTemplate) {
          const { template, title } = await selectStarterTemplate({
            message: finalMessageContent,
            model,
            provider,
          });

          if (template !== 'blank') {
            const temResp = await getTemplates(template, title).catch((e) => {
              if (e.message.includes('rate limit')) {
                toast.warning('Rate limit exceeded. Skipping starter template\n Continuing with blank template');
              } else {
                toast.warning('Failed to import starter template\n Continuing with blank template');
              }

              return null;
            });

            if (temResp) {
              const { assistantMessage, userMessage } = temResp;
              const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

              setMessages([
                {
                  id: `1-${new Date().getTime()}`,
                  role: 'user',
                  content: userMessageText,
                  parts: createMessageParts(userMessageText, imageDataList),
                },
                {
                  id: `2-${new Date().getTime()}`,
                  role: 'assistant',
                  content: assistantMessage,
                },
                {
                  id: `3-${new Date().getTime()}`,
                  role: 'user',
                  content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userMessage}`,
                  annotations: ['hidden'],
                },
              ]);

              const reloadOptions =
                uploadedFiles.length > 0
                  ? { experimental_attachments: await filesToAttachments(uploadedFiles) }
                  : undefined;

              reload(reloadOptions);
              setInput('');
              Cookies.remove(PROMPT_COOKIE_KEY);

              setUploadedFiles([]);
              setImageDataList([]);

              resetEnhancer();

              textareaRef.current?.blur();
              setFakeLoading(false);

              return;
            }
          }
        }

        // If autoSelectTemplate is disabled or template selection failed, proceed with normal message
        const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;
        const attachments = uploadedFiles.length > 0 ? await filesToAttachments(uploadedFiles) : undefined;

        setMessages([
          {
            id: `${new Date().getTime()}`,
            role: 'user',
            content: userMessageText,
            parts: createMessageParts(userMessageText, imageDataList),
            experimental_attachments: attachments,
          },
        ]);
        reload(attachments ? { experimental_attachments: attachments } : undefined);
        setFakeLoading(false);
        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);

        setUploadedFiles([]);
        setImageDataList([]);

        resetEnhancer();

        textareaRef.current?.blur();

        return;
      }

      if (error != null) {
        setMessages(messages.slice(0, -1));
      }

      const modifiedFiles = workbenchStore.getModifiedFiles();

      chatStore.setKey('aborted', false);

      if (modifiedFiles !== undefined) {
        const userUpdateArtifact = filesToArtifacts(modifiedFiles, `${Date.now()}`);
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userUpdateArtifact}${finalMessageContent}`;

        const attachmentOptions =
          uploadedFiles.length > 0 ? { experimental_attachments: await filesToAttachments(uploadedFiles) } : undefined;

        append(
          {
            role: 'user',
            content: messageText,
            parts: createMessageParts(messageText, imageDataList),
          },
          attachmentOptions,
        );

        workbenchStore.resetAllFileModifications();
      } else {
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

        const attachmentOptions =
          uploadedFiles.length > 0 ? { experimental_attachments: await filesToAttachments(uploadedFiles) } : undefined;

        append(
          {
            role: 'user',
            content: messageText,
            parts: createMessageParts(messageText, imageDataList),
          },
          attachmentOptions,
        );
      }

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);

      setUploadedFiles([]);
      setImageDataList([]);

      resetEnhancer();

      textareaRef.current?.blur();
    };

    /**
     * Handles the change event for the textarea and updates the input state.
     * @param event - The change event from the textarea.
     */
    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      handleInputChange(event);
    };

    /**
     * Debounced function to cache the prompt in cookies.
     * Caches the trimmed value of the textarea input after a delay to optimize performance.
     */
    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const trimmedValue = event.target.value.trim();
        Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
      }, 1000),
      [],
    );

    useEffect(() => {
      const storedApiKeys = Cookies.get('apiKeys');

      if (storedApiKeys) {
        setApiKeys(JSON.parse(storedApiKeys));
      }
    }, []);

    const handleModelChange = (newModel: string) => {
      setModel(newModel);
      Cookies.set('selectedModel', newModel, { expires: 30 });
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      setProvider(newProvider);
      Cookies.set('selectedProvider', newProvider.name, { expires: 30 });
    };

    const handleWebSearchResult = useCallback(
      (result: string) => {
        const currentInput = input || '';
        const newInput = currentInput.length > 0 ? `${result}\n\n${currentInput}` : result;

        // Update the input via the same mechanism as handleInputChange
        const syntheticEvent = {
          target: { value: newInput },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        handleInputChange(syntheticEvent);
      },
      [input, handleInputChange],
    );

    return (
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading || fakeLoading}
        onStreamingChange={(streaming) => {
          streamingState.set(streaming);
        }}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        sendMessage={sendMessage}
        model={model}
        setModel={handleModelChange}
        provider={provider}
        setProvider={handleProviderChange}
        providerList={activeProviders}
        handleInputChange={(e) => {
          onTextareaChange(e);
          debouncedCachePrompt(e);
        }}
        handleStop={abort}
        description={description}
        importChat={importChat}
        exportChat={exportChat}
        messages={messages.map((message, i) => {
          if (message.role === 'user') {
            return message;
          }

          return {
            ...message,
            content: parsedMessages[i] || '',
          };
        })}
        enhancePrompt={() => {
          enhancePrompt(
            input,
            (input) => {
              setInput(input);
              scrollTextArea();
            },
            model,
            provider,
            apiKeys,
          );
        }}
        uploadedFiles={uploadedFiles}
        setUploadedFiles={setUploadedFiles}
        imageDataList={imageDataList}
        setImageDataList={setImageDataList}
        actionAlert={actionAlert}
        clearAlert={() => workbenchStore.clearAlert()}
        supabaseAlert={supabaseAlert}
        clearSupabaseAlert={() => workbenchStore.clearSupabaseAlert()}
        deployAlert={deployAlert}
        clearDeployAlert={() => workbenchStore.clearDeployAlert()}
        llmErrorAlert={llmErrorAlert}
        clearLlmErrorAlert={clearApiErrorAlert}
        data={chatData}
        chatMode={chatMode}
        setChatMode={setChatMode}
        append={append}
        designScheme={designScheme}
        setDesignScheme={setDesignScheme}
        selectedElement={selectedElement}
        setSelectedElement={setSelectedElement}
        addToolResult={addToolResult}
        onWebSearchResult={handleWebSearchResult}
      />
    );
  },
);
