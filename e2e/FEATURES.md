# bolt.diy Feature Inventory

> **Purpose**: Authoritative feature list for E2E coverage tracking.
> Every feature listed here MUST have at least one Playwright E2E test mapped in `COVERAGE.yml`.

## Project Purpose Summary

**bolt.diy** is an open-source, AI-powered full-stack web development IDE that runs in the browser. It lets developers chat with AI models to generate, edit, and deploy web applications — all within an integrated environment featuring a code editor, terminal, file manager, and live preview.

- **Primary users**: Web developers, indie hackers, and learners who want AI-assisted code generation
- **First value**: User types a prompt, AI generates a working web app they can preview and deploy
- **Primary entities**: Chats, Files/Projects, Providers/Models, Deployments, Settings

---

## Product Area 1: App Shell & Navigation

| ID | Feature | Goal | Main UI Path | Edge States | Permissions |
|----|---------|------|-------------|-------------|-------------|
| A01 | Homepage renders | Landing page loads with chat interface | `/` → see logo, example prompts, chat input | Empty state, slow load | Public |
| A02 | Global navigation | Sidebar opens/closes with chat history | Click hamburger → sidebar slides in | No chat history, many chats | Public |
| A03 | Theme toggle | Switch between light and dark mode | Settings icon → theme switch | Persists across reload | Public |
| A04 | Not found UX | 404 page for invalid routes | Navigate to `/nonexistent` | Deep-linked invalid chat ID | Public |
| A05 | Loading skeletons | Skeleton UI while content loads | Page load → see skeleton → content | Slow network | Public |
| A06 | Responsive layout | App works on different viewport sizes | Resize browser | Mobile, tablet, desktop breakpoints | Public |
| A07 | Keyboard shortcuts | Theme toggle shortcut works | Press Ctrl+Alt+Shift+D | Focus in editor vs outside | Public |

## Product Area 2: Chat Interface

| ID | Feature | Goal | Main UI Path | Edge States | Permissions |
|----|---------|------|-------------|-------------|-------------|
| B01 | Send message | User sends a chat message | Type in chat box → press Enter or click send | Empty message, very long message | Public |
| B02 | Example prompts | Click starter prompts on landing | Click example prompt card | All templates available | Public |
| B03 | Chat streaming | AI response streams in real-time | Send message → see tokens appear | Network interruption, abort | Public |
| B04 | Chat history | Previous chats listed in sidebar | Open sidebar → see chat list | No history, hundreds of chats | Public |
| B05 | Delete chat | Remove a chat from history | Sidebar → hover chat → delete icon | Last chat, bulk delete | Public |
| B06 | Duplicate chat | Clone an existing chat | Sidebar → hover chat → duplicate | Large chat with many files | Public |
| B07 | Search chat history | Filter chats by keyword | Sidebar → search input → type keyword | No results, special characters | Public |
| B08 | Chat modes | Switch between Build and Discuss mode | Mode toggle button in chat | Mode persistence across messages | Public |
| B09 | Message rewind | Rewind to a previous message | Click rewind icon on a message | First message, last message | Public |
| B10 | Message fork | Create alternate conversation branch | Click fork icon on a message | Deep conversation, single message | Public |
| B11 | Chat persistence | Chat survives page reload | Send messages → reload → chats persist | Browser storage full | Public |
| B12 | Chat import/export | Import and export chat sessions | Settings → export/import | Invalid import file, large export | Public |

## Product Area 3: Provider & Model Configuration

| ID | Feature | Goal | Main UI Path | Edge States | Permissions |
|----|---------|------|-------------|-------------|-------------|
| C01 | Provider selection | Choose AI provider from dropdown | Provider dropdown → select provider | No providers configured | Public |
| C02 | Model selection | Choose specific model for provider | Model dropdown → select model | Provider with many models | Public |
| C03 | API key entry | Configure API key for a provider | Settings → Cloud Providers → enter key | Invalid key, empty key | Public |
| C04 | Provider enable/disable | Toggle providers on/off | Settings → Cloud Providers → toggle | Disable active provider | Public |
| C05 | Local provider setup | Configure Ollama/LMStudio | Settings → Local Providers → configure | Provider not running | Public |
| C06 | Connection test | Verify provider connectivity | Settings → provider → test connection | Timeout, invalid credentials | Public |
| C07 | Model context display | Show context window size | Model dropdown → see token count | Model with unknown context | Public |

## Product Area 4: File Management

| ID | Feature | Goal | Main UI Path | Edge States | Permissions |
|----|---------|------|-------------|-------------|-------------|
| D01 | File tree display | Show project files in tree | Workbench → file tree panel | Empty project, deeply nested | Public |
| D02 | File selection | Click file to open in editor | Click file in tree → opens in editor | Binary file, very large file | Public |
| D03 | Create file | AI creates new files via chat | Chat generates code → file appears in tree | Duplicate filename | Public |
| D04 | File tabs | Multiple files open in tabs | Open several files → see tabs | Many tabs, close tab | Public |
| D05 | Unsaved indicator | Show dot for modified files | Edit file → see unsaved dot | Multiple unsaved files | Public |
| D06 | Import folder | Drag-and-drop a folder | Import button → select folder | Large folder, binary files | Public |
| D07 | Git clone | Clone repo from GitHub/GitLab | Git clone button → enter URL | Invalid URL, private repo | Public |
| D08 | File search | Search within project files | Search input in file tree | No results, regex patterns | Public |

## Product Area 5: Code Editor

| ID | Feature | Goal | Main UI Path | Edge States | Permissions |
|----|---------|------|-------------|-------------|-------------|
| E01 | Syntax highlighting | Code has language-aware colors | Open .js/.ts/.html file → colored syntax | Unknown file type | Public |
| E02 | Breadcrumb nav | Show file path breadcrumbs | Open file → see path above editor | Deeply nested path | Public |
| E03 | Diff view | Compare original and modified | Click diff toggle → side-by-side view | No changes, large diff | Public |
| E04 | Editor tabs | Switch between open files | Click different tabs | Close last tab | Public |

## Product Area 6: Preview & Terminal

| ID | Feature | Goal | Main UI Path | Edge States | Permissions |
|----|---------|------|-------------|-------------|-------------|
| F01 | Live preview | See running app in iframe | Workbench → preview panel | App crash, no server running | Public |
| F02 | Device frames | Test in different device sizes | Device dropdown → select device | Landscape/portrait toggle | Public |
| F03 | Preview reload | Refresh the preview | Click reload button | During server restart | Public |
| F04 | Terminal output | See build/run command output | Terminal panel → see output | Long output, errors | Public |
| F05 | Multiple terminals | Open several terminal tabs | Terminal → add tab | Max tabs | Public |
| F06 | Fullscreen preview | Expand preview to full screen | Click fullscreen button | Return from fullscreen | Public |

## Product Area 7: Deployment

| ID | Feature | Goal | Main UI Path | Edge States | Permissions |
|----|---------|------|-------------|-------------|-------------|
| G01 | Deploy menu | Open deployment options | Click deploy button → see dropdown | No deployments configured | Public |
| G02 | GitHub deploy | Push to GitHub repository | Deploy → GitHub → enter details | Auth required, existing repo | Public |
| G03 | Netlify deploy | Deploy to Netlify | Deploy → Netlify → configure | Not authenticated | Public |
| G04 | Vercel deploy | Deploy to Vercel | Deploy → Vercel → configure | Not authenticated | Public |

## Product Area 8: Settings & Configuration

| ID | Feature | Goal | Main UI Path | Edge States | Permissions |
|----|---------|------|-------------|-------------|-------------|
| H01 | Settings panel | Open settings interface | Click settings icon → see tabs | All tabs render | Public |
| H02 | Profile settings | Update user profile | Settings → Profile → edit | Empty profile | Public |
| H03 | Feature toggles | Enable beta features | Settings → Features → toggle | Feature dependency | Public |
| H04 | Event logs | View activity history | Settings → Event Logs | Empty logs, many logs | Public |
| H05 | Data management | View usage statistics | Settings → Data | No data | Public |
| H06 | MCP configuration | Configure MCP servers | Settings → MCP → add server | Invalid server config | Public |

## Product Area 9: Starter Templates

| ID | Feature | Goal | Main UI Path | Edge States | Permissions |
|----|---------|------|-------------|-------------|-------------|
| I01 | Template selection | Choose a starter template | Example prompts → click template | Template load failure | Public |
| I02 | Template variety | Multiple framework options | See React, Vue, Angular, Svelte, etc. | Less common frameworks | Public |

## Product Area 10: Error Handling & Edge Cases

| ID | Feature | Goal | Main UI Path | Edge States | Permissions |
|----|---------|------|-------------|-------------|-------------|
| J01 | API error display | Show friendly error messages | Trigger API error → see toast | Rate limit, auth failure | Public |
| J02 | Stream recovery | Recover from broken AI stream | Network drops during stream | Mid-message, start of message | Public |
| J03 | Empty states | Show helpful empty state UI | New app → no files, no chats | All entity types | Public |
| J04 | Large file handling | Handle files beyond size limits | Try to import 100KB+ file | Various file types | Public |

---

## Project Sites Worker Features (apps/project-sites)

| ID | Feature | Goal | Main UI Path | Edge States | Permissions |
|----|---------|------|-------------|-------------|-------------|
| PS01 | Marketing homepage | Marketing page loads | `sites.megabyte.space/` | Slow CDN, blocked resources | Public |
| PS02 | Business search | Search for a business | Search input → type name → see results | No results, API timeout | Public |
| PS03 | Search result selection | Select from dropdown | Click result → navigate to details | Multiple similar results | Public |
| PS04 | Email sign-in | Magic link authentication | Sign in → enter email → receive link | Invalid email, expired link | Public |
| PS05 | Google OAuth | Sign in with Google | Sign in → Google button | OAuth failure | Public |
| PS06 | AI site generation | Trigger website build | Provide details → click build | Long generation, failure | Authenticated |
| PS07 | Site preview | View generated website | Build complete → see preview | Large site, missing assets | Authenticated |
| PS08 | Custom domains | Add custom domain | Dashboard → domains → add | Invalid domain, DNS not configured | Paid |
| PS09 | Billing/Stripe | Subscribe to paid plan | Upgrade → Stripe checkout | Card declined, webhook delay | Authenticated |
| PS10 | Site serving | Customer site accessible | Visit `slug-sites.megabyte.space` | Unpaid top bar, 404 | Public |
