import { memo, useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { IconButton } from '~/components/ui/IconButton';
import { workbenchStore } from '~/lib/stores/workbench';

interface DomainEntry {
  domain: string;
  verified: boolean | null;
}

export const DeployPanel = memo(() => {
  const [slug, setSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [domains, setDomains] = useState<DomainEntry[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [isSlugModalOpen, setIsSlugModalOpen] = useState(false);
  const [newSlug, setNewSlug] = useState('');
  const [slugChecking, setSlugChecking] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [slugChanging, setSlugChanging] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  const baseUrl = workbenchStore.getProjectSitesBaseUrl();
  const siteUrl = slug ? `https://${slug}-sites.megabyte.space` : '';

  useEffect(() => {
    const loadMeta = async () => {
      try {
        const meta = await workbenchStore.getProjectSiteMeta();

        if (meta) {
          setSlug(meta.slug);
        }
      } finally {
        setLoading(false);
      }
    };
    loadMeta();
  }, []);

  const checkSlugAvailability = useCallback(
    async (value: string) => {
      if (!value || value === slug) {
        setSlugAvailable(null);
        return;
      }

      setSlugChecking(true);
      setSlugAvailable(null);

      try {
        const res = await fetch(`${baseUrl}/api/sites/check-slug?slug=${encodeURIComponent(value)}`);

        if (res.ok) {
          const data = (await res.json()) as { available: boolean };
          setSlugAvailable(data.available);
        } else {
          setSlugAvailable(null);
        }
      } catch {
        setSlugAvailable(null);
      } finally {
        setSlugChecking(false);
      }
    },
    [baseUrl, slug],
  );

  const handleChangeSlug = useCallback(async () => {
    if (!slug || !newSlug || newSlug === slug || slugAvailable !== true) {
      return;
    }

    setSlugChanging(true);

    try {
      const res = await fetch(`${baseUrl}/api/sites/${encodeURIComponent(slug)}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newSlug }),
      });

      if (res.ok) {
        setSlug(newSlug);
        setIsSlugModalOpen(false);
        setNewSlug('');
        setSlugAvailable(null);
        toast.success(`UUID changed to "${newSlug}"`);
      } else {
        const err = (await res.json().catch(() => ({ error: { message: 'Unknown error' } }))) as {
          error: { message: string };
        };
        toast.error(err.error?.message || 'Failed to change UUID');
      }
    } catch {
      toast.error('Failed to change UUID');
    } finally {
      setSlugChanging(false);
    }
  }, [baseUrl, slug, newSlug, slugAvailable]);

  const addDomain = useCallback(() => {
    const trimmed = newDomain.trim().toLowerCase();

    if (!trimmed) {
      return;
    }

    if (domains.length >= 4) {
      toast.error('Maximum 4 custom domains allowed (5 total including the slug domain)');
      return;
    }

    if (domains.some((d) => d.domain === trimmed)) {
      toast.error('Domain already added');
      return;
    }

    // Basic domain validation
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(trimmed)) {
      toast.error('Invalid domain format');
      return;
    }

    setDomains((prev) => [...prev, { domain: trimmed, verified: null }]);
    setNewDomain('');
  }, [newDomain, domains]);

  const removeDomain = useCallback((domain: string) => {
    setDomains((prev) => prev.filter((d) => d.domain !== domain));
  }, []);

  const verifyDomains = useCallback(async () => {
    if (!slug) {
      return;
    }

    setVerifying(true);

    try {
      const results = await Promise.all(
        domains.map(async (entry) => {
          try {
            const res = await fetch(
              `${baseUrl}/api/sites/${encodeURIComponent(slug)}/domains/verify?domain=${encodeURIComponent(entry.domain)}`,
            );

            if (res.ok) {
              const data = (await res.json()) as { verified: boolean };
              return { ...entry, verified: data.verified };
            }

            return { ...entry, verified: false };
          } catch {
            return { ...entry, verified: false };
          }
        }),
      );

      setDomains(results);

      const allVerified = results.every((d) => d.verified);

      if (allVerified && results.length > 0) {
        toast.success('All domains verified');
      } else if (results.length > 0) {
        toast.warn('Some domains failed verification. Check CNAME records.');
      }
    } finally {
      setVerifying(false);
    }
  }, [baseUrl, slug, domains]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary">
        <div className="i-svg-spinners:90-ring-with-bg text-xl animate-spin mr-2" />
        Loading deploy settings...
      </div>
    );
  }

  if (!slug) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary gap-3">
        <div className="i-ph:cloud-arrow-up text-4xl text-bolt-elements-textTertiary" />
        <p className="text-sm text-bolt-elements-textTertiary">No site published yet</p>
        <p className="text-xs text-bolt-elements-textTertiary">
          Use the <strong>Save</strong> button in the Code view to publish your site first.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* Address bar - matching Preview's structure */}
      <div className="bg-bolt-elements-background-depth-2 p-2 flex items-center gap-2">
        <div className="flex items-center gap-2">
          <IconButton
            icon="i-ph:arrow-clockwise"
            onClick={() => {
              window.open(siteUrl, '_blank');
            }}
            title="Open site in new tab"
          />
        </div>

        <div className="flex-grow flex items-center gap-1 bg-bolt-elements-preview-addressBar-background border border-bolt-elements-borderColor text-bolt-elements-preview-addressBar-text rounded-full px-1 py-1 text-sm hover:bg-bolt-elements-preview-addressBar-backgroundHover hover:focus-within:bg-bolt-elements-preview-addressBar-backgroundActive focus-within:bg-bolt-elements-preview-addressBar-backgroundActive focus-within-border-bolt-elements-borderColorActive focus-within:text-bolt-elements-preview-addressBar-textActive">
          <div className="relative z-port-dropdown" />
          <input title="URL Path" className="w-full bg-transparent outline-none" type="text" value={siteUrl} disabled />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center relative" />
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto border-t border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-4">
        {/* UUID/Slug Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-bolt-elements-textPrimary mb-3 flex items-center gap-2">
            <div className="i-ph:identification-badge text-lg" />
            Site UUID
          </h3>
          <div className="bg-bolt-elements-background-depth-2 rounded-lg border border-bolt-elements-borderColor p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-bolt-elements-textTertiary">UUID: </span>
                <span className="text-sm font-mono font-medium text-bolt-elements-textPrimary">{slug}</span>
                <span className="text-sm text-bolt-elements-textTertiary ml-2">({slug}-sites.megabyte.space)</span>
              </div>
              <button
                onClick={() => {
                  setIsSlugModalOpen(true);
                  setNewSlug(slug);
                  setSlugAvailable(null);
                }}
                className="px-3 py-1.5 text-xs bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover rounded-md transition-colors"
              >
                Change UUID
              </button>
            </div>
          </div>
        </div>

        {/* Domain Management Section */}
        <div>
          <h3 className="text-sm font-semibold text-bolt-elements-textPrimary mb-3 flex items-center gap-2">
            <div className="i-ph:globe text-lg" />
            Custom Domains
            <div className="relative">
              <button
                className="text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary transition-colors bg-transparent"
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                onClick={() => setShowTooltip(!showTooltip)}
              >
                <div className="i-ph:question text-base" />
              </button>
              {showTooltip && (
                <div className="absolute left-6 top-0 z-50 w-80 p-3 bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor rounded-lg shadow-lg text-xs text-bolt-elements-textPrimary">
                  <p className="font-semibold mb-1">CNAME Configuration</p>
                  <p className="mb-2">
                    All custom domains you want to serve your website from should have their DNS CNAME record pointed
                    to:
                  </p>
                  <code className="block bg-bolt-elements-background-depth-1 px-2 py-1 rounded font-mono text-xs mb-2">
                    {slug}-sites.megabyte.space
                  </code>
                  <p>
                    Go to your domain registrar's DNS settings and add a CNAME record for each custom domain pointing to
                    the URL above. Verification may take a few minutes after DNS changes.
                  </p>
                </div>
              )}
            </div>
          </h3>

          <div className="bg-bolt-elements-background-depth-2 rounded-lg border border-bolt-elements-borderColor p-4 space-y-3">
            {/* Primary domain (non-deletable) */}
            <div className="flex items-center gap-2 py-2 px-3 bg-bolt-elements-background-depth-1 rounded-md border border-bolt-elements-borderColor">
              <div className="i-ph:lock-simple text-sm text-bolt-elements-textTertiary" />
              <span className="flex-1 text-sm font-mono text-bolt-elements-textPrimary">
                {slug}-sites.megabyte.space
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20">
                Primary
              </span>
            </div>

            {/* Custom domains */}
            {domains.map((entry) => (
              <div
                key={entry.domain}
                className="flex items-center gap-2 py-2 px-3 bg-bolt-elements-background-depth-1 rounded-md border border-bolt-elements-borderColor"
              >
                <div className="i-ph:globe-simple text-sm text-bolt-elements-textTertiary" />
                <span className="flex-1 text-sm font-mono text-bolt-elements-textPrimary">{entry.domain}</span>
                {entry.verified === true && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20">
                    Verified
                  </span>
                )}
                {entry.verified === false && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20">
                    Not verified
                  </span>
                )}
                {entry.verified === null && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-bolt-elements-background-depth-3 text-bolt-elements-textTertiary border border-bolt-elements-borderColor">
                    Pending
                  </span>
                )}
                <button
                  onClick={() => removeDomain(entry.domain)}
                  className="p-1 text-bolt-elements-textTertiary hover:text-red-500 transition-colors bg-transparent rounded"
                  title="Remove domain"
                >
                  <div className="i-ph:x text-sm" />
                </button>
              </div>
            ))}

            {/* Add domain input */}
            {domains.length < 4 && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="example.com"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      addDomain();
                    }
                  }}
                  className="flex-1 px-3 py-1.5 text-sm bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor rounded-md outline-none focus:ring-2 focus:ring-blue-500/50 text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary"
                />
                <button
                  onClick={addDomain}
                  className="px-3 py-1.5 text-xs bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover rounded-md transition-colors"
                >
                  Add
                </button>
              </div>
            )}

            {/* Verify button */}
            {domains.length > 0 && (
              <div className="pt-2 border-t border-bolt-elements-borderColor">
                <button
                  onClick={verifyDomains}
                  disabled={verifying}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-60 disabled:cursor-not-allowed rounded-md transition-colors"
                >
                  {verifying ? (
                    <>
                      <div className="i-svg-spinners:90-ring-with-bg text-sm animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      <div className="i-ph:check-circle text-sm" />
                      Verify All Domains
                    </>
                  )}
                </button>
              </div>
            )}

            <p className="text-xs text-bolt-elements-textTertiary">
              You can add up to 4 custom domains (5 total). Each must have a CNAME pointing to{' '}
              <code className="font-mono bg-bolt-elements-background-depth-1 px-1 rounded">
                {slug}-sites.megabyte.space
              </code>
            </p>
          </div>
        </div>
      </div>

      {/* Slug Change Modal */}
      {isSlugModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-bolt-elements-borderColor">
              <h3 className="text-sm font-semibold text-bolt-elements-textPrimary">Change UUID</h3>
              <button
                onClick={() => {
                  setIsSlugModalOpen(false);
                  setNewSlug('');
                  setSlugAvailable(null);
                }}
                className="text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary bg-transparent"
              >
                <div className="i-ph:x text-lg" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs text-bolt-elements-textTertiary mb-1">Current UUID</label>
                <div className="text-sm font-mono text-bolt-elements-textPrimary bg-bolt-elements-background-depth-1 px-3 py-2 rounded-md border border-bolt-elements-borderColor">
                  {slug}
                </div>
              </div>
              <div>
                <label className="block text-xs text-bolt-elements-textTertiary mb-1">New UUID</label>
                <input
                  type="text"
                  value={newSlug}
                  onChange={(e) => {
                    const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                    setNewSlug(val);
                    setSlugAvailable(null);
                  }}
                  onBlur={() => checkSlugAvailability(newSlug)}
                  className="w-full px-3 py-2 text-sm bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor rounded-md outline-none focus:ring-2 focus:ring-blue-500/50 text-bolt-elements-textPrimary font-mono"
                  placeholder="my-project"
                />
                {slugChecking && (
                  <p className="text-xs text-bolt-elements-textTertiary mt-1 flex items-center gap-1">
                    <span className="i-svg-spinners:90-ring-with-bg text-xs animate-spin" />
                    Checking availability...
                  </p>
                )}
                {slugAvailable === true && newSlug !== slug && (
                  <p className="text-xs text-green-500 mt-1 flex items-center gap-1">
                    <span className="i-ph:check-circle" />
                    UUID is available
                  </p>
                )}
                {slugAvailable === false && (
                  <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <span className="i-ph:x-circle" />
                    UUID is already taken
                  </p>
                )}
                <p className="text-xs text-bolt-elements-textTertiary mt-1">
                  Your site will be available at <strong>{newSlug || '...'}-sites.megabyte.space</strong>
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-bolt-elements-borderColor">
              <button
                onClick={() => {
                  setIsSlugModalOpen(false);
                  setNewSlug('');
                  setSlugAvailable(null);
                }}
                className="px-4 py-1.5 text-sm text-bolt-elements-textPrimary bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor rounded-md hover:bg-bolt-elements-background-depth-3 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (slugAvailable === null && newSlug !== slug) {
                    checkSlugAvailability(newSlug).then(() => {
                      // Will be called after availability check
                    });
                    return;
                  }

                  handleChangeSlug();
                }}
                disabled={slugChanging || slugChecking || newSlug === slug || slugAvailable === false || !newSlug}
                className="px-4 py-1.5 text-sm bg-accent-500 text-white rounded-md hover:bg-accent-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {slugChanging
                  ? 'Changing...'
                  : slugAvailable === null && newSlug !== slug
                    ? 'Check & Change'
                    : 'Change UUID'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
