import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useStore } from '@nanostores/react';
import { netlifyConnection } from '~/lib/stores/netlify';
import { vercelConnection } from '~/lib/stores/vercel';
import { isGitLabConnected } from '~/lib/stores/gitlabConnection';
import { workbenchStore } from '~/lib/stores/workbench';
import { streamingState } from '~/lib/stores/streaming';
import { classNames } from '~/utils/classNames';
import { useState } from 'react';
import { NetlifyDeploymentLink } from '~/components/chat/NetlifyDeploymentLink.client';
import { VercelDeploymentLink } from '~/components/chat/VercelDeploymentLink.client';
import { useVercelDeploy } from '~/components/deploy/VercelDeploy.client';
import { useNetlifyDeploy } from '~/components/deploy/NetlifyDeploy.client';
import { useGitHubDeploy } from '~/components/deploy/GitHubDeploy.client';
import { useGitLabDeploy } from '~/components/deploy/GitLabDeploy.client';
import { useS3Deploy } from '~/components/deploy/S3Deploy.client';
import { GitHubDeploymentDialog } from '~/components/deploy/GitHubDeploymentDialog';
import { GitLabDeploymentDialog } from '~/components/deploy/GitLabDeploymentDialog';
import { s3Connection } from '~/lib/stores/s3';
import { toast } from 'react-toastify';
import { db, chatId, description as chatDescription } from '~/lib/persistence/useChatHistory';
import { getMessages } from '~/lib/persistence/db';

interface DeployButtonProps {
  onVercelDeploy?: () => Promise<void>;
  onNetlifyDeploy?: () => Promise<void>;
  onGitHubDeploy?: () => Promise<void>;
  onGitLabDeploy?: () => Promise<void>;
  onS3Deploy?: () => Promise<void>;
  onProjectSitesDeploy?: () => Promise<void>;
}

export const DeployButton = ({
  onVercelDeploy,
  onNetlifyDeploy,
  onGitHubDeploy,
  onGitLabDeploy,
  onS3Deploy,
  onProjectSitesDeploy,
}: DeployButtonProps) => {
  const netlifyConn = useStore(netlifyConnection);
  const vercelConn = useStore(vercelConnection);
  const gitlabIsConnected = useStore(isGitLabConnected);
  const s3Conn = useStore(s3Connection);
  const [activePreviewIndex] = useState(0);
  const previews = useStore(workbenchStore.previews);
  const activePreview = previews[activePreviewIndex];
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployingTo, setDeployingTo] = useState<'netlify' | 'vercel' | 'github' | 'gitlab' | 's3' | null>(null);
  const isStreaming = useStore(streamingState);
  const { handleVercelDeploy } = useVercelDeploy();
  const { handleNetlifyDeploy } = useNetlifyDeploy();
  const { handleGitHubDeploy } = useGitHubDeploy();
  const { handleGitLabDeploy } = useGitLabDeploy();
  const { handleS3Deploy } = useS3Deploy();
  const [showGitHubDeploymentDialog, setShowGitHubDeploymentDialog] = useState(false);
  const [showGitLabDeploymentDialog, setShowGitLabDeploymentDialog] = useState(false);
  const [githubDeploymentFiles, setGithubDeploymentFiles] = useState<Record<string, string> | null>(null);
  const [gitlabDeploymentFiles, setGitlabDeploymentFiles] = useState<Record<string, string> | null>(null);
  const [githubProjectName, setGithubProjectName] = useState('');
  const [gitlabProjectName, setGitlabProjectName] = useState('');

  const handleVercelDeployClick = async () => {
    setIsDeploying(true);
    setDeployingTo('vercel');

    try {
      if (onVercelDeploy) {
        await onVercelDeploy();
      } else {
        await handleVercelDeploy();
      }
    } finally {
      setIsDeploying(false);
      setDeployingTo(null);
    }
  };

  const handleNetlifyDeployClick = async () => {
    setIsDeploying(true);
    setDeployingTo('netlify');

    try {
      if (onNetlifyDeploy) {
        await onNetlifyDeploy();
      } else {
        await handleNetlifyDeploy();
      }
    } finally {
      setIsDeploying(false);
      setDeployingTo(null);
    }
  };

  const handleGitHubDeployClick = async () => {
    setIsDeploying(true);
    setDeployingTo('github');

    try {
      if (onGitHubDeploy) {
        await onGitHubDeploy();
      } else {
        const result = await handleGitHubDeploy();

        if (result && result.success && result.files) {
          setGithubDeploymentFiles(result.files);
          setGithubProjectName(result.projectName);
          setShowGitHubDeploymentDialog(true);
        }
      }
    } finally {
      setIsDeploying(false);
      setDeployingTo(null);
    }
  };

  const handleGitLabDeployClick = async () => {
    setIsDeploying(true);
    setDeployingTo('gitlab');

    try {
      if (onGitLabDeploy) {
        await onGitLabDeploy();
      } else {
        const result = await handleGitLabDeploy();

        if (result && result.success && result.files) {
          setGitlabDeploymentFiles(result.files);
          setGitlabProjectName(result.projectName);
          setShowGitLabDeploymentDialog(true);
        }
      }
    } finally {
      setIsDeploying(false);
      setDeployingTo(null);
    }
  };

  const handleS3DeployClick = async () => {
    setIsDeploying(true);
    setDeployingTo('s3');

    try {
      if (onS3Deploy) {
        await onS3Deploy();
      } else {
        await handleS3Deploy();
      }
    } finally {
      setIsDeploying(false);
      setDeployingTo(null);
    }
  };

  const [showProjectSitesDialog, setShowProjectSitesDialog] = useState(false);
  const [projectSitesSlug, setProjectSitesSlug] = useState('');
  const [projectSitesBuildFolder, setProjectSitesBuildFolder] = useState('dist/');

  const handleProjectSitesDeployClick = async () => {
    if (onProjectSitesDeploy) {
      setIsDeploying(true);
      setDeployingTo(null);

      try {
        await onProjectSitesDeploy();
      } finally {
        setIsDeploying(false);
        setDeployingTo(null);
      }
    } else {
      setShowProjectSitesDialog(true);
    }
  };

  const handleProjectSitesDeployConfirm = async () => {
    if (!projectSitesSlug.trim()) {
      toast.error('Please enter a site slug');
      return;
    }

    setShowProjectSitesDialog(false);
    setIsDeploying(true);
    setDeployingTo(null);

    try {
      toast.info('Packaging site for Project Sites...');

      // Get the project files and create a ZIP
      const zip = await workbenchStore.getZipBlob(projectSitesBuildFolder || undefined);

      if (!zip) {
        toast.error('Failed to package project files');
        return;
      }

      // Get actual chat messages from current session
      let chatMessages: unknown[] = [];
      let chatDesc = 'Deployed from Bolt';

      try {
        const currentChatId = chatId.get();

        if (db && currentChatId) {
          const chat = await getMessages(db, currentChatId);

          if (chat && chat.messages && chat.messages.length > 0) {
            chatMessages = chat.messages;
            chatDesc = chat.description || chatDescription.get() || 'Deployed from Bolt';
          }
        }
      } catch {
        // Fall back to empty messages if chat retrieval fails
      }

      const chatData = {
        messages: chatMessages,
        description: chatDesc,
        exportDate: new Date().toISOString(),
      };

      const formData = new FormData();
      formData.append('zip', zip, 'site.zip');
      formData.append('chat', new Blob([JSON.stringify(chatData)], { type: 'application/json' }), 'chat.json');
      formData.append('dist_path', projectSitesBuildFolder || 'dist/');

      // Find or create the site, then deploy
      const siteBaseUrl = 'https://sites.megabyte.space';
      const lookupRes = await fetch(`${siteBaseUrl}/api/sites/lookup?slug=${encodeURIComponent(projectSitesSlug)}`);

      let siteId: string | null = null;

      if (lookupRes.ok) {
        const lookupData = (await lookupRes.json()) as { data?: { id: string } };
        siteId = lookupData.data?.id || null;
      }

      if (!siteId) {
        toast.info('Site not found. Please create the site at sites.megabyte.space first, then deploy.');
        window.open(`${siteBaseUrl}/?create=${encodeURIComponent(projectSitesSlug)}`, '_blank');

        return;
      }

      toast.info('Deploying to Project Sites...');

      const deployRes = await fetch(`${siteBaseUrl}/api/sites/${siteId}/deploy`, {
        method: 'POST',
        body: formData,
      });

      if (!deployRes.ok) {
        const errText = await deployRes.text();
        toast.error('Deploy failed: ' + errText);

        return;
      }

      toast.success(`Deployed to ${projectSitesSlug}-sites.megabyte.space!`);
    } catch (err) {
      toast.error('Deploy failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsDeploying(false);
      setDeployingTo(null);
    }
  };

  return (
    <>
      <div className="flex border border-bolt-elements-borderColor rounded-md overflow-hidden text-sm">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            disabled={isDeploying || !activePreview || isStreaming}
            className="rounded-md items-center justify-center [&:is(:disabled,.disabled)]:cursor-not-allowed [&:is(:disabled,.disabled)]:opacity-60 px-3 py-1.5 text-xs bg-accent-500 text-white hover:text-bolt-elements-item-contentAccent [&:not(:disabled,.disabled)]:hover:bg-bolt-elements-button-primary-backgroundHover outline-accent-500 flex gap-1.7"
          >
            {isDeploying ? `Deploying to ${deployingTo}...` : 'Deploy'}
            <span className={classNames('i-ph:caret-down transition-transform')} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content
            className={classNames(
              'z-[250]',
              'bg-bolt-elements-background-depth-2',
              'rounded-lg shadow-lg',
              'border border-bolt-elements-borderColor',
              'animate-in fade-in-0 zoom-in-95',
              'py-1',
            )}
            sideOffset={5}
            align="end"
          >
            <DropdownMenu.Item
              className={classNames(
                'cursor-pointer flex items-center w-full px-4 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive gap-2 rounded-md group relative',
                {
                  'opacity-60 cursor-not-allowed': isDeploying || !activePreview || !netlifyConn.user,
                },
              )}
              disabled={isDeploying || !activePreview || !netlifyConn.user}
              onClick={handleNetlifyDeployClick}
            >
              <img
                className="w-5 h-5"
                height="24"
                width="24"
                crossOrigin="anonymous"
                src="https://cdn.simpleicons.org/netlify"
              />
              <span className="mx-auto">
                {!netlifyConn.user ? 'No Netlify Account Connected' : 'Deploy to Netlify'}
              </span>
              {netlifyConn.user && <NetlifyDeploymentLink />}
            </DropdownMenu.Item>

            <DropdownMenu.Item
              className={classNames(
                'cursor-pointer flex items-center w-full px-4 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive gap-2 rounded-md group relative',
                {
                  'opacity-60 cursor-not-allowed': isDeploying || !activePreview || !vercelConn.user,
                },
              )}
              disabled={isDeploying || !activePreview || !vercelConn.user}
              onClick={handleVercelDeployClick}
            >
              <img
                className="w-5 h-5 bg-black p-1 rounded"
                height="24"
                width="24"
                crossOrigin="anonymous"
                src="https://cdn.simpleicons.org/vercel/white"
                alt="vercel"
              />
              <span className="mx-auto">{!vercelConn.user ? 'No Vercel Account Connected' : 'Deploy to Vercel'}</span>
              {vercelConn.user && <VercelDeploymentLink />}
            </DropdownMenu.Item>

            <DropdownMenu.Item
              className={classNames(
                'cursor-pointer flex items-center w-full px-4 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive gap-2 rounded-md group relative',
                {
                  'opacity-60 cursor-not-allowed': isDeploying || !activePreview,
                },
              )}
              disabled={isDeploying || !activePreview}
              onClick={handleGitHubDeployClick}
            >
              <img
                className="w-5 h-5"
                height="24"
                width="24"
                crossOrigin="anonymous"
                src="https://cdn.simpleicons.org/github"
                alt="github"
              />
              <span className="mx-auto">Deploy to GitHub</span>
            </DropdownMenu.Item>

            <DropdownMenu.Item
              className={classNames(
                'cursor-pointer flex items-center w-full px-4 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive gap-2 rounded-md group relative',
                {
                  'opacity-60 cursor-not-allowed': isDeploying || !activePreview || !gitlabIsConnected,
                },
              )}
              disabled={isDeploying || !activePreview || !gitlabIsConnected}
              onClick={handleGitLabDeployClick}
            >
              <img
                className="w-5 h-5"
                height="24"
                width="24"
                crossOrigin="anonymous"
                src="https://cdn.simpleicons.org/gitlab"
                alt="gitlab"
              />
              <span className="mx-auto">{!gitlabIsConnected ? 'No GitLab Account Connected' : 'Deploy to GitLab'}</span>
            </DropdownMenu.Item>

            <DropdownMenu.Item
              className={classNames(
                'cursor-pointer flex items-center w-full px-4 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive gap-2 rounded-md group relative',
                {
                  'opacity-60 cursor-not-allowed': isDeploying || !activePreview || !s3Conn.connected,
                },
              )}
              disabled={isDeploying || !activePreview || !s3Conn.connected}
              onClick={handleS3DeployClick}
            >
              <img
                className="w-5 h-5"
                height="24"
                width="24"
                crossOrigin="anonymous"
                src="https://cdn.simpleicons.org/amazons3"
                alt="s3"
              />
              <span className="mx-auto">
                {!s3Conn.connected
                  ? 'No S3/R2 Connection Configured'
                  : `Deploy to ${s3Conn.provider === 'r2' ? 'Cloudflare R2' : 'AWS S3'}`}
              </span>
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="h-px bg-bolt-elements-borderColor my-1" />

            <DropdownMenu.Item
              className={classNames(
                'cursor-pointer flex items-center w-full px-4 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive gap-2 rounded-md group relative',
                {
                  'opacity-60 cursor-not-allowed': isDeploying || !activePreview,
                },
              )}
              disabled={isDeploying || !activePreview}
              onClick={handleProjectSitesDeployClick}
            >
              <div className="w-5 h-5 flex items-center justify-center">
                <div className="i-ph:globe-simple-duotone text-lg text-purple-500" />
              </div>
              <span className="mx-auto">Deploy to Project Sites</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>

      {/* GitHub Deployment Dialog */}
      {showGitHubDeploymentDialog && githubDeploymentFiles && (
        <GitHubDeploymentDialog
          isOpen={showGitHubDeploymentDialog}
          onClose={() => setShowGitHubDeploymentDialog(false)}
          projectName={githubProjectName}
          files={githubDeploymentFiles}
        />
      )}

      {/* GitLab Deployment Dialog */}
      {showGitLabDeploymentDialog && gitlabDeploymentFiles && (
        <GitLabDeploymentDialog
          isOpen={showGitLabDeploymentDialog}
          onClose={() => setShowGitLabDeploymentDialog(false)}
          projectName={gitlabProjectName}
          files={gitlabDeploymentFiles}
        />
      )}

      {/* Project Sites Deployment Dialog */}
      {showProjectSitesDialog && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-semibold text-bolt-elements-textPrimary mb-4 flex items-center gap-2">
              <div className="i-ph:globe-simple-duotone text-xl text-purple-500" />
              Deploy to Project Sites
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-bolt-elements-textSecondary mb-1.5 font-medium">
                  Site Slug <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={projectSitesSlug}
                  onChange={(e) => setProjectSitesSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="my-site"
                  className="w-full bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor rounded-lg px-3 py-2 text-sm text-bolt-elements-textPrimary focus:outline-none focus:border-purple-500"
                />
                <p className="text-xs text-bolt-elements-textTertiary mt-1">
                  Your site will be at{' '}
                  <span className="text-purple-400">{projectSitesSlug || 'slug'}-sites.megabyte.space</span>
                </p>
              </div>

              <div>
                <label className="block text-xs text-bolt-elements-textSecondary mb-1.5 font-medium">
                  Build Folder
                </label>
                <input
                  type="text"
                  value={projectSitesBuildFolder}
                  onChange={(e) => setProjectSitesBuildFolder(e.target.value)}
                  placeholder="dist/"
                  className="w-full bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor rounded-lg px-3 py-2 text-sm text-bolt-elements-textPrimary focus:outline-none focus:border-purple-500"
                />
                <p className="text-xs text-bolt-elements-textTertiary mt-1">
                  The folder containing your built site (e.g. dist/, build/, public/)
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6 justify-end">
              <button
                onClick={() => setShowProjectSitesDialog(false)}
                className="px-4 py-2 text-sm rounded-lg border border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-3 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleProjectSitesDeployConfirm}
                className="px-4 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors font-medium"
              >
                Deploy
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
