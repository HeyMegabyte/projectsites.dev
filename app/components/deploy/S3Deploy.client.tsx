import { toast } from 'react-toastify';
import { useStore } from '@nanostores/react';
import { s3Connection } from '~/lib/stores/s3';
import { workbenchStore } from '~/lib/stores/workbench';
import { webcontainer } from '~/lib/webcontainer';
import { path } from '~/utils/path';
import { useState } from 'react';
import type { ActionCallbackData } from '~/lib/runtime/message-parser';
import { chatId } from '~/lib/persistence/useChatHistory';
import { formatBuildFailureOutput } from './deployUtils';

export function useS3Deploy() {
  const [isDeploying, setIsDeploying] = useState(false);
  const s3Conn = useStore(s3Connection);
  const currentChatId = useStore(chatId);

  const handleS3Deploy = async () => {
    if (!s3Conn.connected || !s3Conn.bucket || !s3Conn.accessKeyId) {
      toast.error('Please configure S3/R2 connection in Settings first!');
      return false;
    }

    if (!currentChatId) {
      toast.error('No active chat found');
      return false;
    }

    try {
      setIsDeploying(true);

      const artifact = workbenchStore.firstArtifact;

      if (!artifact) {
        throw new Error('No active project found');
      }

      // Create a deployment artifact for visual feedback
      const deploymentId = 'deploy-artifact';
      workbenchStore.addArtifact({
        id: deploymentId,
        messageId: deploymentId,
        title: `${s3Conn.provider.toUpperCase()} Deployment`,
        type: 'standalone',
      });

      const deployArtifact = workbenchStore.artifacts.get()[deploymentId];

      // Notify that build is starting
      deployArtifact.runner.handleDeployAction('building', 'running', { source: s3Conn.provider });

      // Set up build action
      const actionId = 'build-' + Date.now();
      const actionData: ActionCallbackData = {
        messageId: `${s3Conn.provider} build`,
        artifactId: artifact.id,
        actionId,
        action: {
          type: 'build' as const,
          content: 'npm run build',
        },
      };

      // Add the action first, then run it
      artifact.runner.addAction(actionData);
      await artifact.runner.runAction(actionData);

      const buildOutput = artifact.runner.buildOutput;

      if (!buildOutput || buildOutput.exitCode !== 0) {
        deployArtifact.runner.handleDeployAction('building', 'failed', {
          error: formatBuildFailureOutput(buildOutput?.output),
          source: s3Conn.provider,
        });
        throw new Error('Build failed');
      }

      // Build succeeded, start deployment
      deployArtifact.runner.handleDeployAction('deploying', 'running', { source: s3Conn.provider });

      const container = await webcontainer;
      const buildPath = buildOutput.path.replace('/home/project', '');

      // Find the build output directory
      let finalBuildPath = buildPath;
      const commonOutputDirs = [buildPath, '/dist', '/build', '/out', '/output', '/.next', '/public'];
      let buildPathExists = false;

      for (const dir of commonOutputDirs) {
        try {
          await container.fs.readdir(dir);
          finalBuildPath = dir;
          buildPathExists = true;
          break;
        } catch {
          continue;
        }
      }

      if (!buildPathExists) {
        throw new Error('Could not find build output directory.');
      }

      // Recursively read all files from build output
      async function getAllFiles(dirPath: string): Promise<Record<string, string>> {
        const files: Record<string, string> = {};
        const entries = await container.fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);

          if (entry.isFile()) {
            const content = await container.fs.readFile(fullPath, 'utf-8');
            const deployPath = fullPath.replace(finalBuildPath, '');
            files[deployPath] = content;
          } else if (entry.isDirectory()) {
            const subFiles = await getAllFiles(fullPath);
            Object.assign(files, subFiles);
          }
        }

        return files;
      }

      const fileContents = await getAllFiles(finalBuildPath);

      // Send files to the S3/R2 deploy API
      const response = await fetch('/api/s3-deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deploy',
          provider: s3Conn.provider,
          endpoint: s3Conn.endpoint,
          bucket: s3Conn.bucket,
          accessKeyId: s3Conn.accessKeyId,
          secretAccessKey: s3Conn.secretAccessKey,
          region: s3Conn.region,
          pathPrefix: s3Conn.pathPrefix,
          files: fileContents,
          chatId: currentChatId,
        }),
      });

      const data = (await response.json()) as { ok: boolean; url?: string; fileCount?: number; error?: string };

      if (!response.ok || !data.ok) {
        deployArtifact.runner.handleDeployAction('deploying', 'failed', {
          error: data.error || 'Deployment failed',
          source: s3Conn.provider,
        });
        throw new Error(data.error || 'Deployment failed');
      }

      // Deployment succeeded
      const siteUrl = s3Conn.customDomain
        ? `https://${s3Conn.customDomain}${s3Conn.pathPrefix ? '/' + s3Conn.pathPrefix : ''}`
        : data.url || `https://${s3Conn.bucket}.${s3Conn.endpoint}`;

      deployArtifact.runner.handleDeployAction('complete', 'complete', {
        url: siteUrl,
        source: s3Conn.provider,
      });

      toast.success(
        `Deployed ${data.fileCount ?? Object.keys(fileContents).length} files to ${s3Conn.provider.toUpperCase()}!`,
      );

      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Deployment failed');
      return false;
    } finally {
      setIsDeploying(false);
    }
  };

  return {
    isDeploying,
    handleS3Deploy,
    isConnected: s3Conn.connected,
  };
}
