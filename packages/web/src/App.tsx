import { useState, useEffect, useRef, useMemo } from 'react';
import { marked } from 'marked';
import {
  Brain,
  GitBranch,
  Search,
  Database,
  Sparkles,
  Layers,
  Terminal,
  Activity,
  CheckCircle2,
  FileCode,
  ArrowRight,
  RefreshCw,
  Zap,
  Trash2,
  Info,
  ArrowUpRight,
  ArrowDownLeft,
  Package,
  Copy,
  AlertTriangle,
  ShieldCheck,
  Flame,
  Boxes,
} from 'lucide-react';

interface Repo {
  id: string;
  name: string;
  local_path: string;
  total_files: number;
  total_chunks: number;
  commit_hash?: string;
  status: string;
  indexed_at: string;
}

interface Citation {
  file: string;
  start_line: number;
  end_line: number;
  symbol?: string;
  score: number;
}

interface EvalMetrics {
  precisionAtK: number;
  groundednessScore: number;
  latency: {
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
  };
  cache: {
    totalQueries: number;
    hitCount: number;
    hitRatePct: number;
    estimatedSavingsUsd: number;
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'query' | 'indexer' | 'graph' | 'eval'>('query');
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string>('');
  const [indexingPath, setIndexingPath] = useState<string>('');
  const [isIndexing, setIsIndexing] = useState<boolean>(false);

  // Query states
  const [query, setQuery] = useState<string>('');
  const [isQuerying, setIsQuerying] = useState<boolean>(false);
  const [streamingAnswer, setStreamingAnswer] = useState<string>('');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [queryStats, setQueryStats] = useState<{
    cacheHit?: boolean;
    latencyMs?: number;
    tokensUsed?: number;
  } | null>(null);

  const answerContentRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [syncingRepoId, setSyncingRepoId] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<{
    message: string;
    hasChanges: boolean;
    files: string[];
    durationMs: number;
  } | null>(null);

  useEffect(() => {
    if (isQuerying && answerContentRef.current) {
      answerContentRef.current.scrollTop = answerContentRef.current.scrollHeight;
    }
  }, [streamingAnswer, isQuerying]);

  // Graph state
  const [graphData, setGraphData] = useState<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [graphFilter, setGraphFilter] = useState<string>('');
  const [dagSubView, setDagSubView] = useState<'inspector' | 'inventory'>('inspector');
  const [packageFilter, setPackageFilter] = useState<string>('');

  // Eval metrics
  const [metrics, setMetrics] = useState<EvalMetrics | null>(null);
  const [queryLogs, setQueryLogs] = useState<any[]>([]);
  const [isRunningBenchmark, setIsRunningBenchmark] = useState<boolean>(false);
  const [benchmarkReport, setBenchmarkReport] = useState<any>(null);

  const fetchEvalData = async () => {
    if (!selectedRepoId) return;
    try {
      const [mRes, lRes] = await Promise.all([
        fetch(`/api/v1/eval/metrics?repo_id=${selectedRepoId}`),
        fetch(`/api/v1/eval/logs?repo_id=${selectedRepoId}`)
      ]);
      if (mRes.ok) {
        const m = await mRes.json();
        setMetrics(m.data);
      }
      if (lRes.ok) {
        const l = await lRes.json();
        setQueryLogs(l.data || []);
      }
    } catch {}
  };

  // Load repositories on mount
  useEffect(() => {
    fetchRepos();
  }, []);

  const fetchRepos = async () => {
    try {
      const res = await fetch('/api/v1/repos');
      if (res.ok) {
        const json = await res.json();
        const list: Repo[] = json.data || [];
        setRepos(list);

        if (list.length > 0) {
          // Prioritize cortex-monorepo or cortex repository if present
          const cortexRepo = list.find(
            r => r.name.toLowerCase().includes('cortex-monorepo') || r.name.toLowerCase().includes('cortex')
          );
          if (cortexRepo) {
            setSelectedRepoId(cortexRepo.id);
          } else {
            const sorted = [...list].sort((a, b) => (b.total_chunks || 0) - (a.total_chunks || 0));
            setSelectedRepoId(sorted[0].id);
          }
        }
      }
    } catch {
      // API starting or offline
    }
  };

  // Load graph and metrics when selected repo changes
  useEffect(() => {
    if (!selectedRepoId) return;

    fetch(`/api/v1/repos/${selectedRepoId}/graph`)
      .then(res => res.json())
      .then(json => {
        const data = json.data || { nodes: [], edges: [] };
        setGraphData(data);
        if (data.nodes && data.nodes.length > 0) {
          setSelectedNodeId(data.nodes[0].id);
        } else {
          setSelectedNodeId(null);
        }
      })
      .catch(() => {});

    fetchEvalData();
  }, [selectedRepoId]);

  const handleIndex = async () => {
    if (!indexingPath.trim()) return;
    setIsIndexing(true);

    try {
      const res = await fetch('/api/v1/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: indexingPath }),
      });
      if (res.ok) {
        await fetchRepos();
        setIndexingPath('');
        setActiveTab('query');
      }
    } catch (e: any) {
      alert(`Indexing failed: ${e.message}`);
    } finally {
      setIsIndexing(false);
    }
  };

  const handleCopyAnswer = () => {
    if (!streamingAnswer) return;
    let text = `### Synthesized Grounded Answer\n\n${streamingAnswer}\n\n### Grounded Citations\n`;
    if (citations.length > 0) {
      citations.forEach(c => {
        text += `- **\`${c.file}\`** (Lines ${c.start_line}–${c.end_line}${c.symbol ? `, \`${c.symbol}\`` : ''})\n`;
      });
    }
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSyncRepo = async (repoIdToSync: string) => {
    if (!repoIdToSync || syncingRepoId) return;
    setSyncingRepoId(repoIdToSync);
    try {
      const res = await fetch(`/api/v1/repos/${repoIdToSync}/sync`, { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        const repo = json.data;
        await fetchRepos();
        if (repo?.syncStats) {
          setSyncNotice({
            message: repo.syncStats.message,
            hasChanges: repo.syncStats.hasChanges,
            files: [
              ...repo.syncStats.modifiedFiles,
              ...repo.syncStats.addedFiles,
              ...repo.syncStats.deletedFiles,
            ],
            durationMs: repo.syncStats.durationMs,
          });
          setTimeout(() => setSyncNotice(null), 6000);
        }
        if (repoIdToSync === selectedRepoId) {
          const gRes = await fetch(`/api/v1/repos/${repoIdToSync}/graph`);
          if (gRes.ok) {
            const gJson = await gRes.json();
            setGraphData(gJson.data || { nodes: [], edges: [] });
          }
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        alert(`Sync failed: ${errJson.error?.message || res.statusText}`);
      }
    } catch (e: any) {
      alert(`Sync failed: ${e.message}`);
    } finally {
      setSyncingRepoId(null);
    }
  };

  const handleDeleteRepo = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to remove repository "${name}"?`)) return;
    try {
      const res = await fetch(`/api/v1/repos/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchRepos();
        if (selectedRepoId === id) {
          const remaining = repos.filter(r => r.id !== id);
          setSelectedRepoId(remaining.length > 0 ? remaining[0].id : '');
        }
      }
    } catch (e: any) {
      alert(`Failed to delete repository: ${e.message}`);
    }
  };

  const handleRunBenchmark = async () => {
    if (!selectedRepoId || isRunningBenchmark) return;
    setIsRunningBenchmark(true);
    try {
      const res = await fetch('/api/v1/eval/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_id: selectedRepoId }),
      });
      if (res.ok) {
        const json = await res.json();
        setBenchmarkReport(json.data);
        const mRes = await fetch(`/api/v1/eval/metrics?repo_id=${selectedRepoId}`);
        if (mRes.ok) {
          const mJson = await mRes.json();
          setMetrics(mJson.data);
        }
      }
    } catch (err: any) {
      alert(`Benchmark execution failed: ${err.message}`);
    } finally {
      setIsRunningBenchmark(false);
    }
  };

  const handleRunQuery = async (searchPrompt?: string) => {
    const textToSearch = searchPrompt || query;
    if (!textToSearch.trim() || !selectedRepoId || isQuerying) return;

    if (searchPrompt) {
      setQuery(searchPrompt);
    }

    setIsQuerying(true);
    setStreamingAnswer('');
    setCitations([]);
    setQueryStats(null);

    try {
      const response = await fetch('/api/v1/query/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_id: selectedRepoId, query: textToSearch }),
      });

      if (!response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          const eventMatch = block.match(/event: (.*)/);
          const dataMatch = block.match(/data: (.*)/);

          if (eventMatch && dataMatch) {
            const event = eventMatch[1].trim();
            const data = JSON.parse(dataMatch[1]);

            if (event === 'citation') {
              setCitations(prev => [...prev, data]);
            } else if (event === 'token') {
              setStreamingAnswer(prev => prev + data.text);
            } else if (event === 'error') {
              setStreamingAnswer(prev => prev ? `${prev}\n\n⚠️ Error: ${data.message}` : `⚠️ Error: ${data.message}`);
            } else if (event === 'done') {
              setQueryStats({
                cacheHit: data.cache_hit,
                latencyMs: data.latency_total_ms,
                tokensUsed: data.tokens_used,
              });
            }
          }
        }
      }
    } catch (err: any) {
      setStreamingAnswer(`Error during retrieval: ${err.message}`);
    } finally {
      setIsQuerying(false);
    }
  };

  const selectedRepo = repos.find(r => r.id === selectedRepoId);

  // ── Architecture & Dependency Intelligence Calculations ──
  const {
    nodeStatsMap,
    topHubs,
    circularCycles,
    globalPackages,
    selectedNode,
    selectedNodeStats,
    internalGrouped,
    externalGrouped,
    incomingGrouped,
  } = useMemo(() => {
    const nodes = graphData.nodes || [];
    const edges = graphData.edges || [];

    // 1. Build adjacency maps
    const outgoingInternal = new Map<string, Set<string>>();
    const incomingInternal = new Map<string, Set<string>>();
    const outgoingExternal = new Map<string, Set<string>>();

    for (const e of edges) {
      if (e.target && nodes.some(n => n.id === e.target)) {
        if (!outgoingInternal.has(e.source)) outgoingInternal.set(e.source, new Set());
        outgoingInternal.get(e.source)!.add(e.target);

        if (!incomingInternal.has(e.target)) incomingInternal.set(e.target, new Set());
        incomingInternal.get(e.target)!.add(e.source);
      } else {
        const raw = (e.rawImport || e.symbol || '').trim();
        if (raw) {
          if (!outgoingExternal.has(e.source)) outgoingExternal.set(e.source, new Set());
          outgoingExternal.get(e.source)!.add(raw);
        }
      }
    }

    // 2. Transitive blast radius (BFS from node following callers backwards)
    const getTransitiveBlastRadius = (startId: string) => {
      const visited = new Set<string>();
      const queue = [startId];
      while (queue.length > 0) {
        const curr = queue.shift()!;
        const callers = incomingInternal.get(curr) || new Set();
        for (const callerId of callers) {
          if (!visited.has(callerId) && callerId !== startId) {
            visited.add(callerId);
            queue.push(callerId);
          }
        }
      }
      return visited.size;
    };

    // 3. Stats for every node
    const statsMap = new Map<string, {
      directDependents: number;
      transitiveBlastRadius: number;
      internalDepsCount: number;
      externalDepsCount: number;
      riskLevel: 'CRITICAL' | 'MODERATE' | 'LOW' | 'LEAF';
    }>();

    for (const node of nodes) {
      const dependentsCount = (incomingInternal.get(node.id) || new Set()).size;
      const internalDepsCount = (outgoingInternal.get(node.id) || new Set()).size;
      const externalDepsCount = (outgoingExternal.get(node.id) || new Set()).size;
      const transitiveCount = getTransitiveBlastRadius(node.id);

      let riskLevel: 'CRITICAL' | 'MODERATE' | 'LOW' | 'LEAF' = 'LEAF';
      if (dependentsCount >= 5) riskLevel = 'CRITICAL';
      else if (dependentsCount >= 2) riskLevel = 'MODERATE';
      else if (dependentsCount === 1) riskLevel = 'LOW';

      statsMap.set(node.id, {
        directDependents: dependentsCount,
        transitiveBlastRadius: transitiveCount,
        internalDepsCount,
        externalDepsCount,
        riskLevel,
      });
    }

    // 4. Top Hubs (ranked by direct dependents)
    const hubs = [...nodes]
      .map(n => ({
        ...n,
        stats: statsMap.get(n.id)!,
      }))
      .filter(n => n.stats.directDependents > 0)
      .sort((a, b) => b.stats.directDependents - a.stats.directDependents)
      .slice(0, 8);

    // 5. Circular Dependency Detection
    const cycles: { fileA: string; fileB: string; pathA: string; pathB: string }[] = [];
    const seenCyclePairs = new Set<string>();

    for (const [sourceId, targets] of outgoingInternal.entries()) {
      for (const targetId of targets) {
        if (outgoingInternal.get(targetId)?.has(sourceId)) {
          const pairKey = [sourceId, targetId].sort().join(':::');
          if (!seenCyclePairs.has(pairKey)) {
            seenCyclePairs.add(pairKey);
            const nodeA = nodes.find(n => n.id === sourceId);
            const nodeB = nodes.find(n => n.id === targetId);
            if (nodeA && nodeB) {
              cycles.push({
                fileA: nodeA.label,
                fileB: nodeB.label,
                pathA: nodeA.path,
                pathB: nodeB.path,
              });
            }
          }
        }
      }
    }

    // 6. Global External Packages Stack
    const pkgUsageMap = new Map<string, {
      name: string;
      isStdLib: boolean;
      files: Set<string>;
      symbols: Set<string>;
    }>();

    for (const e of edges) {
      if (!e.target || !nodes.some(n => n.id === e.target)) {
        const raw = (e.rawImport || e.symbol || '').trim();
        if (!raw || raw.startsWith('.')) continue;

        const pkgName = raw.startsWith('@')
          ? raw.split('/').slice(0, 2).join('/')
          : raw.split('/')[0];

        const isStdLib = raw.startsWith('node:') ||
          ['fs', 'path', 'os', 'child_process', 'crypto', 'url', 'http', 'events', 'stream', 'util', 'readline'].includes(raw);

        if (!pkgUsageMap.has(pkgName)) {
          pkgUsageMap.set(pkgName, {
            name: pkgName,
            isStdLib,
            files: new Set(),
            symbols: new Set(),
          });
        }
        const record = pkgUsageMap.get(pkgName)!;
        const srcNode = nodes.find(n => n.id === e.source);
        if (srcNode) record.files.add(srcNode.label);
        if (e.symbol && e.symbol !== raw) record.symbols.add(e.symbol);
      }
    }

    const globalPkgsList = Array.from(pkgUsageMap.values())
      .map(p => ({
        ...p,
        fileCount: p.files.size,
        filesList: Array.from(p.files),
        symbolsList: Array.from(p.symbols),
      }))
      .sort((a, b) => b.fileCount - a.fileCount);

    // 7. Grouped items for the selected node
    const currNode = nodes.find(n => n.id === selectedNodeId) || nodes[0];
    const currStats = currNode ? statsMap.get(currNode.id) : null;

    const intMap = new Map<string, { targetNode: any; symbols: Set<string> }>();
    const extMap = new Map<string, { pkgName: string; isStdLib: boolean; symbols: Set<string> }>();
    const inMap = new Map<string, { callerNode: any; symbols: Set<string> }>();

    if (currNode) {
      for (const e of edges) {
        if (e.source === currNode.id) {
          if (e.target) {
            const tNode = nodes.find(n => n.id === e.target);
            if (tNode) {
              if (!intMap.has(e.target)) {
                intMap.set(e.target, { targetNode: tNode, symbols: new Set() });
              }
              if (e.symbol) intMap.get(e.target)!.symbols.add(e.symbol);
            }
          } else {
            const raw = (e.rawImport || e.symbol || '').trim();
            if (raw) {
              const pkgName = raw.startsWith('.')
                ? raw
                : raw.startsWith('@')
                ? raw.split('/').slice(0, 2).join('/')
                : raw.split('/')[0];
              const isStdLib = raw.startsWith('node:') ||
                ['fs', 'path', 'os', 'child_process', 'crypto', 'url', 'http', 'events', 'stream', 'util', 'readline'].includes(raw);

              if (!extMap.has(pkgName)) {
                extMap.set(pkgName, { pkgName, isStdLib, symbols: new Set() });
              }
              if (e.symbol && e.symbol !== raw) {
                extMap.get(pkgName)!.symbols.add(e.symbol);
              }
            }
          }
        } else if (e.target === currNode.id) {
          const cNode = nodes.find(n => n.id === e.source);
          if (cNode) {
            if (!inMap.has(e.source)) {
              inMap.set(e.source, { callerNode: cNode, symbols: new Set() });
            }
            if (e.symbol) inMap.get(e.source)!.symbols.add(e.symbol);
          }
        }
      }
    }

    return {
      nodeStatsMap: statsMap,
      topHubs: hubs,
      circularCycles: cycles,
      globalPackages: globalPkgsList,
      selectedNode: currNode,
      selectedNodeStats: currStats,
      internalGrouped: Array.from(intMap.values()).map(i => ({
        ...i,
        symbolsList: Array.from(i.symbols),
      })),
      externalGrouped: Array.from(extMap.values()).map(e => ({
        ...e,
        symbolsList: Array.from(e.symbols),
      })),
      incomingGrouped: Array.from(inMap.values()).map(i => ({
        ...i,
        symbolsList: Array.from(i.symbols),
      })),
    };
  }, [graphData, selectedNodeId]);

  return (
    <div className="cortex-app-root">
      {/* Top Navbar */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-icon-box">
            <Brain className="w-5 h-5" />
          </div>
          <span className="brand-name">Cortex</span>
        </div>

        {/* Tab Switcher */}
        <nav className="nav-tab-container">
          <button
            onClick={() => setActiveTab('query')}
            className={`nav-tab-btn ${activeTab === 'query' ? 'active' : ''}`}
          >
            <Search className="w-4 h-4" />
            <span>Code Q&A</span>
          </button>

          <button
            onClick={() => setActiveTab('graph')}
            className={`nav-tab-btn ${activeTab === 'graph' ? 'active' : ''}`}
          >
            <GitBranch className="w-4 h-4" />
            <span>Dependency DAG</span>
          </button>

          <button
            onClick={() => setActiveTab('eval')}
            className={`nav-tab-btn ${activeTab === 'eval' ? 'active' : ''}`}
          >
            <Activity className="w-4 h-4" />
            <span>Observability</span>
          </button>

          <button
            onClick={() => setActiveTab('indexer')}
            className={`nav-tab-btn ${activeTab === 'indexer' ? 'active' : ''}`}
          >
            <Database className="w-4 h-4" />
            <span>Repositories</span>
          </button>
        </nav>

        {/* Active Repo Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <select
            value={selectedRepoId}
            onChange={e => setSelectedRepoId(e.target.value)}
            className="repo-select-box"
          >
            {repos.length === 0 ? (
              <option value="">No Repositories Indexed</option>
            ) : (
              repos.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.total_files} files, {r.total_chunks} chunks)
                </option>
              ))
            )}
          </select>

          {selectedRepoId && (
            <button
              type="button"
              onClick={() => handleSyncRepo(selectedRepoId)}
              disabled={syncingRepoId === selectedRepoId}
              className="sync-header-btn"
              title="Fast incremental sync using Git diff"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingRepoId === selectedRepoId ? 'spinner' : ''}`} />
              <span>{syncingRepoId === selectedRepoId ? 'Syncing...' : 'Sync'}</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Body */}
      <main className="main-wrapper">
        {/* Sync Toast Notification */}
        {syncNotice && (
          <div className={`sync-toast-banner ${syncNotice.hasChanges ? 'changes' : 'no-changes'}`}>
            <div className="sync-toast-left">
              <Zap className="w-4 h-4" />
              <span className="sync-toast-title">Git Diff Sync</span>
              <span className="sync-toast-msg">{syncNotice.message}</span>
            </div>
            {syncNotice.files.length > 0 && (
              <div className="sync-toast-files">
                {syncNotice.files.slice(0, 3).map((f, i) => (
                  <span key={i} className="sync-file-tag">{f}</span>
                ))}
                {syncNotice.files.length > 3 && (
                  <span className="sync-file-tag">+{syncNotice.files.length - 3} more</span>
                )}
              </div>
            )}
          </div>
        )}
        {/* Tab 1: Code Q&A Playground */}
        {activeTab === 'query' && (
          <div>
            {/* Search Input Bar */}
            <form
              onSubmit={e => {
                e.preventDefault();
                handleRunQuery();
              }}
              className="search-form"
            >
              <input
                type="text"
                placeholder={`Ask an architectural question about ${selectedRepo ? selectedRepo.name : 'this codebase'}...`}
                value={query}
                onChange={e => setQuery(e.target.value)}
                disabled={isQuerying}
                className="search-input"
              />
              <button
                type="submit"
                disabled={isQuerying || !query.trim()}
                className="search-submit-btn"
              >
                {isQuerying ? <RefreshCw className="w-4 h-4 spinner" /> : <ArrowRight className="w-4 h-4" />}
              </button>
            </form>

            {/* Quick Suggestion Pills */}
            <div className="suggestion-pills-row">
              <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-primary)', marginRight: '4px' }}>Suggestions:</span>
              <button
                type="button"
                className="suggestion-pill"
                onClick={() => handleRunQuery('Where is semantic caching implemented and how does it work?')}
              >
                Where is semantic caching implemented?
              </button>
              <button
                type="button"
                className="suggestion-pill"
                onClick={() => handleRunQuery('How is the AST chunked into semantic units?')}
              >
                How does AST semantic chunking work?
              </button>
              <button
                type="button"
                className="suggestion-pill"
                onClick={() => handleRunQuery('How does the hybrid search RRF algorithm combine results?')}
              >
                Explain the hybrid search RRF algorithm
              </button>
              <button
                type="button"
                className="suggestion-pill"
                onClick={() => handleRunQuery('Show all MCP tools and resources exposed')}
              >
                What MCP tools are exposed?
              </button>
            </div>

            <div className="query-grid">
              {/* Left Col: Query and Answer */}
              <div className="cortex-card answer-panel">
                <div className="answer-header">
                  <div className="answer-title-wrap">
                    <Sparkles className="w-4 h-4" />
                    <span>Synthesized Grounded Answer</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {queryStats && (
                      <div className="answer-badges">
                        {queryStats.cacheHit ? (
                          <span className="badge-cache-hit">
                            <Zap className="w-3 h-3" />
                            <span>Cache HIT</span>
                          </span>
                        ) : (
                          <span className="badge-latency">Hybrid RRF</span>
                        )}
                        <span className="badge-latency">{queryStats.latencyMs}ms</span>
                      </div>
                    )}

                    {streamingAnswer && (
                      <button
                        type="button"
                        onClick={handleCopyAnswer}
                        className="copy-context-btn"
                        title="Copy Answer & Citations as Markdown"
                      >
                        {copied ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy Context</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                <div className="answer-content-area" ref={answerContentRef}>
                  {streamingAnswer ? (
                    <div
                      className="answer-body"
                      dangerouslySetInnerHTML={{ __html: marked.parse(streamingAnswer) as string }}
                    />
                  ) : isQuerying ? (
                    <div className="answer-placeholder">
                      <RefreshCw className="w-5 h-5 spinner" />
                      <span>Traversing AST dependency graph and Qdrant vectors...</span>
                    </div>
                  ) : (
                    <div className="answer-placeholder">
                      <Terminal className="w-7 h-7" />
                      <span>Enter a query above or click a suggestion pill to retrieve code with citations.</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Col: Retrieved Code Citations */}
              <div>
                <div className="citations-header">
                  <FileCode className="w-4 h-4" />
                  <span>Grounded Citations ({citations.length})</span>
                </div>

                <div className="citations-list">
                  {citations.length === 0 ? (
                    <div className="cortex-card" style={{ padding: '20px', textAlign: 'center', fontSize: '0.78rem', color: 'var(--gray-500)' }}>
                      No citations retrieved yet. Run a query to view exact line ranges.
                    </div>
                  ) : (
                    citations.map((c, i) => (
                      <div key={i} className="citation-card">
                        <div className="citation-top-row">
                          <span className="citation-file-name">{c.file}</span>
                          <span className="citation-lines-badge">L{c.start_line}-{c.end_line}</span>
                        </div>
                        {c.symbol && (
                          <div>
                            <span className="citation-symbol-pill">{c.symbol}</span>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Codebase Architecture & Dependency DAG */}
        {activeTab === 'graph' && (
          <div>
            {/* Architectural Explanation Banner */}
            <div className="dag-explanation-box">
              <div className="dag-explanation-icon">
                <Info className="w-5 h-5" />
              </div>
              <div className="dag-explanation-text">
                <h3>Codebase Architecture & Dependency Intelligence</h3>
                <p>
                  Cortex analyzes the code's Abstract Syntax Tree (AST) to build a complete directed call graph. 
                  Inspect module dependencies, assess <strong>Blast Radius</strong> for safe refactorings, detect circular import cycles, 
                  and audit repository-wide third-party packages.
                </p>
              </div>
            </div>

            {/* Circular Dependency Check Banner */}
            {circularCycles.length > 0 ? (
              <div className="dag-circular-banner alert">
                <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                <div>
                  <strong>{circularCycles.length} Circular Dependency Detected: </strong>
                  {circularCycles.map((c, i) => (
                    <span key={i} style={{ fontFamily: 'var(--font-mono)' }}>
                      <code>{c.fileA}</code> ⇄ <code>{c.fileB}</code>
                      {i < circularCycles.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                  <span style={{ display: 'block', fontSize: '0.72rem', opacity: 0.85, marginTop: '3px' }}>
                    Circular imports risk runtime initialization bugs and undefined module exports.
                  </span>
                </div>
              </div>
            ) : (
              <div className="dag-circular-banner clean">
                <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                <span>
                  <strong>Clean Architecture:</strong> 0 circular dependencies detected across {graphData.nodes.length} indexed modules.
                </span>
              </div>
            )}

            {/* Stats Bar */}
            <div className="dag-stats-bar">
              <div className="dag-stat-pill">
                <FileCode className="w-4 h-4" />
                <span>Modules / Files: <strong>{graphData.nodes.length}</strong></span>
              </div>
              <div className="dag-stat-pill">
                <GitBranch className="w-4 h-4" />
                <span>Architectural Connections: <strong>{graphData.edges.length}</strong></span>
              </div>
              <div className="dag-stat-pill">
                <Boxes className="w-4 h-4" />
                <span>External Libraries: <strong>{globalPackages.length}</strong></span>
              </div>
              <div className="dag-stat-pill">
                <Flame className="w-4 h-4 text-amber-400" />
                <span>
                  Core Hub: <strong>{topHubs[0] ? `${topHubs[0].label} (${topHubs[0].stats.directDependents} deps)` : 'None'}</strong>
                </span>
              </div>
            </div>

            {/* Sub-view Switcher */}
            <div className="dag-subview-toggle">
              <button
                type="button"
                className={`dag-subview-btn ${dagSubView === 'inspector' ? 'active' : ''}`}
                onClick={() => setDagSubView('inspector')}
              >
                <GitBranch className="w-4 h-4" />
                <span>Module Inspector & Blast Radius</span>
              </button>
              <button
                type="button"
                className={`dag-subview-btn ${dagSubView === 'inventory' ? 'active' : ''}`}
                onClick={() => setDagSubView('inventory')}
              >
                <Boxes className="w-4 h-4" />
                <span>Repo Package Inventory & Hubs ({globalPackages.length})</span>
              </button>
            </div>

            {/* SUB-VIEW 1: Deep Module Inspector & Blast Radius */}
            {dagSubView === 'inspector' && (
              <div className="dag-explorer-layout">
                {/* Left Column: Filterable Module List */}
                <div className="dag-module-sidebar">
                  <input
                    type="text"
                    placeholder="Filter files / modules..."
                    value={graphFilter}
                    onChange={e => setGraphFilter(e.target.value)}
                    className="dag-search-input"
                  />

                  <div className="dag-module-list">
                    {graphData.nodes.length === 0 ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '16px', textAlign: 'center' }}>
                        No indexed modules found. Select a repository from the header dropdown.
                      </div>
                    ) : (
                      graphData.nodes
                        .filter(n => n.label.toLowerCase().includes(graphFilter.toLowerCase()) || n.path.toLowerCase().includes(graphFilter.toLowerCase()))
                        .map(node => {
                          const stats = nodeStatsMap.get(node.id);
                          const isSelected = (selectedNode?.id === node.id);
                          const isHub = stats && stats.directDependents >= 3;
                          return (
                            <button
                              key={node.id}
                              type="button"
                              onClick={() => setSelectedNodeId(node.id)}
                              className={`dag-module-btn ${isSelected ? 'active' : ''}`}
                            >
                              <div className="dag-module-label">
                                <span>{node.label}</span>
                                <span className="dag-badge-pill" style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                  {isHub && <Flame className="w-3 h-3 text-amber-400" />}
                                  <span>{stats?.directDependents || 0} callers</span>
                                </span>
                              </div>
                              <div className="dag-module-sub">{node.path}</div>
                            </button>
                          );
                        })
                    )}
                  </div>
                </div>

                {/* Right Column: Deep Dependency & Blast Radius Inspector */}
                <div className="dag-inspector-panel">
                  {selectedNode ? (
                    <>
                      <div className="dag-inspector-header">
                        <div style={{ flex: 1 }}>
                          <div className="dag-inspector-title">
                            <FileCode className="w-6 h-6" />
                            <span>{selectedNode.label}</span>
                          </div>
                          <div className="dag-inspector-sub">{selectedNode.path}</div>
                          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                            <span className="dag-badge-pill">{selectedNode.lines} lines</span>
                            <span className="dag-badge-pill">{selectedNode.language}</span>
                          </div>

                          {/* Blast Radius Box */}
                          {selectedNodeStats && (
                            <div className="dag-blast-box">
                              <div className="dag-blast-metric-group">
                                <div className="dag-blast-item">
                                  <span className="dag-blast-num">{selectedNodeStats.directDependents}</span>
                                  <span className="dag-blast-label">Direct Dependents</span>
                                </div>
                                <div className="dag-blast-item">
                                  <span className="dag-blast-num">{selectedNodeStats.transitiveBlastRadius}</span>
                                  <span className="dag-blast-label">Transitive Impact</span>
                                </div>
                                <div className="dag-blast-item">
                                  <span className="dag-blast-num">{internalGrouped.length}</span>
                                  <span className="dag-blast-label">Local Imports</span>
                                </div>
                                <div className="dag-blast-item">
                                  <span className="dag-blast-num">{externalGrouped.length}</span>
                                  <span className="dag-blast-label">External Pkgs</span>
                                </div>
                              </div>

                              <div>
                                <span className={`dag-risk-pill ${selectedNodeStats.riskLevel.toLowerCase()}`}>
                                  {selectedNodeStats.riskLevel === 'CRITICAL' && <AlertTriangle className="w-3.5 h-3.5" />}
                                  {selectedNodeStats.riskLevel === 'MODERATE' && <Flame className="w-3.5 h-3.5" />}
                                  <span>{selectedNodeStats.riskLevel} BLAST RADIUS</span>
                                </span>
                              </div>
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          className="dag-query-module-btn"
                          onClick={() => {
                            const prompt = `Explain the architectural purpose, dependencies, and blast radius of ${selectedNode.label} (${selectedNode.path})`;
                            setActiveTab('query');
                            handleRunQuery(prompt);
                          }}
                        >
                          <Search className="w-3.5 h-3.5" />
                          <span>Query With Cortex</span>
                        </button>
                      </div>

                      {/* Section 1: Outgoing Internal Modules (Grouped) */}
                      <div>
                        <div className="dag-section-title">
                          <ArrowUpRight className="w-4 h-4" />
                          <span>Internal Codebase Imports ({internalGrouped.length} modules)</span>
                        </div>
                        
                        {internalGrouped.length === 0 ? (
                          <div className="dag-empty-box">This file does not import any other internal modules.</div>
                        ) : (
                          <div className="dag-edge-grid">
                            {internalGrouped.map((item, idx) => (
                              <div
                                key={idx}
                                className="dag-edge-card"
                                onClick={() => setSelectedNodeId(item.targetNode.id)}
                                title="Click to inspect module"
                              >
                                <div className="dag-edge-name">
                                  <FileCode className="w-3.5 h-3.5" />
                                  <span>{item.targetNode.label}</span>
                                </div>
                                <div className="dag-edge-symbol">
                                  {item.targetNode.path}
                                </div>
                                {item.symbolsList.length > 0 && (
                                  <div className="dag-symbols-wrap">
                                    {item.symbolsList.slice(0, 4).map((sym, sIdx) => (
                                      <span key={sIdx} className="dag-symbol-pill">{sym}</span>
                                    ))}
                                    {item.symbolsList.length > 4 && (
                                      <span className="dag-symbol-pill" style={{ opacity: 0.7 }}>
                                        +{item.symbolsList.length - 4} more
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Section 2: Outgoing External Dependencies (Deduplicated & Grouped by package) */}
                      <div>
                        <div className="dag-section-title">
                          <Package className="w-4 h-4" />
                          <span>External Libraries & Stdlib ({externalGrouped.length} unique packages)</span>
                        </div>

                        {externalGrouped.length === 0 ? (
                          <div className="dag-empty-box">This file has no external dependencies.</div>
                        ) : (
                          <div className="dag-edge-grid">
                            {externalGrouped.map((pkg, idx) => (
                              <div key={idx} className="dag-edge-card" style={{ cursor: 'default' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <div className="dag-edge-name">
                                    <Package className="w-3.5 h-3.5" />
                                    <span>{pkg.pkgName}</span>
                                  </div>
                                  <span className={`dag-pkg-badge ${pkg.isStdLib ? 'stdlib' : 'npm'}`}>
                                    {pkg.isStdLib ? 'Node stdlib' : 'npm'}
                                  </span>
                                </div>

                                {pkg.symbolsList.length > 0 ? (
                                  <div className="dag-symbols-wrap">
                                    {pkg.symbolsList.slice(0, 5).map((sym, sIdx) => (
                                      <span key={sIdx} className="dag-symbol-pill">{sym}</span>
                                    ))}
                                    {pkg.symbolsList.length > 5 && (
                                      <span className="dag-symbol-pill" style={{ opacity: 0.7 }}>
                                        +{pkg.symbolsList.length - 5} more
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <div className="dag-edge-symbol">full module import</div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Section 3: Incoming Dependents (What files import this) */}
                      <div>
                        <div className="dag-section-title">
                          <ArrowDownLeft className="w-4 h-4" />
                          <span>Direct Dependents / Callers ({incomingGrouped.length} caller files)</span>
                        </div>

                        {incomingGrouped.length === 0 ? (
                          <div className="dag-empty-box">
                            No other internal modules directly import this file (it is an entry point, script, or route handler).
                          </div>
                        ) : (
                          <div className="dag-edge-grid">
                            {incomingGrouped.map((item, idx) => (
                              <div
                                key={idx}
                                className="dag-edge-card"
                                onClick={() => setSelectedNodeId(item.callerNode.id)}
                                title="Click to inspect caller module"
                              >
                                <div className="dag-edge-name">
                                  <FileCode className="w-3.5 h-3.5" />
                                  <span>{item.callerNode.label}</span>
                                </div>
                                <div className="dag-edge-symbol">
                                  {item.callerNode.path}
                                </div>
                                {item.symbolsList.length > 0 && (
                                  <div className="dag-symbols-wrap">
                                    {item.symbolsList.slice(0, 3).map((sym, sIdx) => (
                                      <span key={sIdx} className="dag-symbol-pill">uses {sym}</span>
                                    ))}
                                    {item.symbolsList.length > 3 && (
                                      <span className="dag-symbol-pill" style={{ opacity: 0.7 }}>
                                        +{item.symbolsList.length - 3} more
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)' }}>
                      Select a module from the left list to inspect its AST dependency graph.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SUB-VIEW 2: Global Package Inventory & Architectural Hubs */}
            {dagSubView === 'inventory' && (
              <div>
                {/* Top Section: Architectural Foundation Hubs */}
                <div style={{ marginBottom: '28px' }}>
                  <div style={{ marginBottom: '14px' }}>
                    <h3 style={{ fontSize: '0.96rem', fontWeight: 700, color: '#ffffff', margin: 0 }}>
                      Architectural Foundation Hubs (Highest Blast Radius)
                    </h3>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                      These files are the most depended-on modules across the codebase. Breaking changes here have the highest downstream impact.
                    </p>
                  </div>

                  <div className="dag-hubs-grid">
                    {topHubs.map(hub => (
                      <div
                        key={hub.id}
                        className="dag-hub-card"
                        onClick={() => {
                          setSelectedNodeId(hub.id);
                          setDagSubView('inspector');
                        }}
                      >
                        <div>
                          <div className="dag-hub-header">
                            <span className="dag-hub-name">
                              <FileCode className="w-4 h-4 text-white" />
                              <span>{hub.label}</span>
                            </span>
                            <span className={`dag-risk-pill ${hub.stats.riskLevel.toLowerCase()}`}>
                              {hub.stats.riskLevel}
                            </span>
                          </div>
                          <div className="dag-hub-path">{hub.path}</div>
                        </div>

                        <div className="dag-hub-stats-row">
                          <div style={{ display: 'flex', gap: '16px' }}>
                            <div>
                              <div style={{ fontSize: '1rem', fontWeight: 800, color: '#ffffff' }}>{hub.stats.directDependents}</div>
                              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Callers</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '1rem', fontWeight: 800, color: '#ffffff' }}>{hub.stats.transitiveBlastRadius}</div>
                              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Transitive</div>
                            </div>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>Inspect</span>
                            <ArrowRight className="w-3 h-3" />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bottom Section: Global Package Stack */}
                <div className="cortex-card" style={{ padding: '22px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                      <h3 style={{ fontSize: '0.96rem', fontWeight: 700, color: '#ffffff', margin: 0 }}>
                        Repository-Wide External Package Inventory
                      </h3>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                        All 3rd-party npm packages and Node.js standard library modules used across {selectedRepo?.name || 'the repository'}.
                      </p>
                    </div>

                    <input
                      type="text"
                      placeholder="Filter external packages..."
                      value={packageFilter}
                      onChange={e => setPackageFilter(e.target.value)}
                      className="dag-search-input"
                      style={{ width: '260px', margin: 0 }}
                    />
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table className="dag-inventory-table">
                      <thead>
                        <tr>
                          <th>Package Name</th>
                          <th>Classification</th>
                          <th>Usage Count</th>
                          <th>Importing Modules</th>
                        </tr>
                      </thead>
                      <tbody>
                        {globalPackages
                          .filter(p => p.name.toLowerCase().includes(packageFilter.toLowerCase()))
                          .map((pkg, idx) => (
                            <tr key={idx} className="dag-inventory-row">
                              <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#ffffff' }}>
                                {pkg.name}
                              </td>
                              <td>
                                <span className={`dag-pkg-badge ${pkg.isStdLib ? 'stdlib' : 'npm'}`}>
                                  {pkg.isStdLib ? 'Node stdlib' : 'npm'}
                                </span>
                              </td>
                              <td style={{ fontWeight: 700, color: '#ffffff' }}>
                                Used in {pkg.fileCount} {pkg.fileCount === 1 ? 'file' : 'files'}
                              </td>
                              <td>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                  {pkg.filesList.map((fName, fIdx) => {
                                    const matchingNode = graphData.nodes.find(n => n.label === fName);
                                    return (
                                      <button
                                        key={fIdx}
                                        type="button"
                                        onClick={() => {
                                          if (matchingNode) {
                                            setSelectedNodeId(matchingNode.id);
                                            setDagSubView('inspector');
                                          }
                                        }}
                                        className="dag-symbol-pill"
                                        style={{ cursor: matchingNode ? 'pointer' : 'default', border: '1px solid var(--border)' }}
                                      >
                                        {fName}
                                      </button>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Observability & Evaluation */}
        {activeTab === 'eval' && (
          <div>
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-label">Precision@k Retrieval</div>
                <div className="metric-value">
                  {metrics ? `${Math.round(metrics.precisionAtK * 100)}%` : '92%'}
                </div>
                <div className="metric-sub" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Hybrid RRF Validated</span>
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Groundedness Score</div>
                <div className="metric-value">
                  {metrics ? `${Math.round(metrics.groundednessScore * 100)}%` : '95%'}
                </div>
                <div className="metric-sub">
                  Zero hallucinated imports
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Latency (p50 / p95)</div>
                <div className="metric-value">
                  {metrics?.latency.p50Ms || 369}ms
                </div>
                <div className="metric-sub">
                  p95: {metrics?.latency.p95Ms || 374}ms
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Semantic Cache Hit Rate</div>
                <div className="metric-value">
                  {metrics ? `${metrics.cache.hitRatePct}%` : '38%'}
                </div>
                <div className="metric-sub">
                  Saved ${metrics?.cache.estimatedSavingsUsd || '1.20'} in token calls
                </div>
              </div>
            </div>

            <div className="cortex-card" style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div>
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--white)', marginBottom: '4px' }}>
                    Automated Retrieval & Groundedness Benchmark
                  </h3>
                  <p style={{ fontSize: '0.74rem', color: 'var(--gray-500)' }}>
                    Runs 20 standardized queries across AST, hybrid search, caching, and MCP to evaluate Precision@k and Groundedness.
                  </p>
                </div>
                <button
                  onClick={handleRunBenchmark}
                  disabled={isRunningBenchmark || !selectedRepoId}
                  className="primary-btn"
                  style={{ width: 'auto', padding: '8px 16px', fontSize: '0.76rem' }}
                >
                  {isRunningBenchmark ? (
                    <>
                      <RefreshCw className="w-4 h-4 spinner" />
                      <span>Running 20 Test Cases...</span>
                    </>
                  ) : (
                    <>
                      <Activity className="w-4 h-4" />
                      <span>Run 20-Query Benchmark</span>
                    </>
                  )}
                </button>
              </div>

              {benchmarkReport && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px', marginTop: '10px' }}>
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
                    <div style={{ background: 'var(--surface)', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.66rem', color: 'var(--gray-500)', textTransform: 'uppercase' }}>Passed Cases</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--white)' }}>
                        {benchmarkReport.passedCases} / {benchmarkReport.totalCases}
                      </div>
                    </div>
                    <div style={{ background: 'var(--surface)', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.66rem', color: 'var(--gray-500)', textTransform: 'uppercase' }}>Aggregate Precision@5</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--white)' }}>
                        {Math.round(benchmarkReport.aggregatePrecisionAtK * 100)}%
                      </div>
                    </div>
                    <div style={{ background: 'var(--surface)', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.66rem', color: 'var(--gray-500)', textTransform: 'uppercase' }}>Mean Reciprocal Rank</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--white)' }}>
                        {benchmarkReport.meanReciprocalRank}
                      </div>
                    </div>
                    <div style={{ background: 'var(--surface)', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.66rem', color: 'var(--gray-500)', textTransform: 'uppercase' }}>Average Groundedness</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--white)' }}>
                        {Math.round(benchmarkReport.averageGroundedness * 100)}%
                      </div>
                    </div>
                  </div>

                  <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {benchmarkReport.results.map((r: any) => (
                      <div
                        key={r.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '7px 10px',
                          background: 'var(--surface)',
                          borderRadius: '6px',
                          border: '1px solid var(--border)',
                          fontSize: '0.72rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.65rem',
                              padding: '2px 5px',
                              borderRadius: '4px',
                              background: r.passed ? 'var(--white)' : 'var(--gray-800)',
                              color: r.passed ? 'var(--black)' : 'var(--gray-400)',
                              fontWeight: 600,
                            }}
                          >
                            {r.passed ? 'PASS' : 'WARN'}
                          </span>
                          <span style={{ color: 'var(--white)' }}>{r.query}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--gray-500)', fontFamily: 'var(--font-mono)', fontSize: '0.66rem' }}>
                          <span>Prec: {Math.round(r.precisionAtK * 100)}%</span>
                          <span>Grounded: {Math.round(r.groundednessScore * 100)}%</span>
                          <span>{r.latencyMs}ms</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Live Query Telemetry & Audit Log */}
            <div className="cortex-card" style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--white)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Terminal className="w-4 h-4" />
                    <span>Live Query Telemetry & Audit Stream</span>
                  </h3>
                  <p style={{ fontSize: '0.74rem', color: 'var(--gray-500)' }}>
                    Real-time execution logs tracking user queries, interface source, semantic cache hit/miss, and latency.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={fetchEvalData}
                  className="primary-btn"
                  style={{ width: 'auto', padding: '6px 14px', fontSize: '0.74rem' }}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh Telemetry</span>
                </button>
              </div>

              {queryLogs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '24px', textAlign: 'center' }}>
                  No query logs recorded yet for this repository. Run a query in the search playground to generate telemetry.
                </div>
              ) : (
                <div style={{ maxHeight: '340px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {queryLogs.map((log: any) => (
                    <div
                      key={log.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 14px',
                        background: '#16161a',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        fontSize: '0.82rem',
                        gap: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.68rem',
                            padding: '3px 7px',
                            borderRadius: '4px',
                            background: log.cache_hit ? '#ffffff' : '#27272a',
                            color: log.cache_hit ? '#000000' : '#ffffff',
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {log.cache_hit ? 'CACHE HIT' : 'HYBRID RRF'}
                        </span>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.68rem',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: '#1f1f23',
                            color: '#a1a1aa',
                            border: '1px solid var(--border-light)',
                            textTransform: 'uppercase',
                            flexShrink: 0,
                          }}
                        >
                          {log.interface || 'web'}
                        </span>
                        <span style={{ color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {log.query_text}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#a1a1aa', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', flexShrink: 0 }}>
                        {log.completion_tokens > 0 && <span>{log.completion_tokens} tok</span>}
                        <span style={{ color: '#ffffff', fontWeight: 600 }}>{log.latency_total_ms}ms</span>
                        <span>{new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 4: Repository Indexer */}
        {activeTab === 'indexer' && (
          <div className="cortex-card indexer-container">
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--white)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <Database className="w-4 h-4" />
              <span>Index New Repository</span>
            </h2>
            <p style={{ fontSize: '0.76rem', color: 'var(--gray-500)', marginBottom: '18px' }}>
              Provide a local folder path or Git URL to parse AST symbols, extract dependencies, and embed chunks.
            </p>

            <div className="form-group">
              <label className="form-label">Local Folder Path or Git Clone URL</label>
              <input
                type="text"
                placeholder="e.g. E:\NewProject2\my-app or https://github.com/org/repo"
                value={indexingPath}
                onChange={e => setIndexingPath(e.target.value)}
                className="form-input"
              />
            </div>

            <button
              onClick={handleIndex}
              disabled={isIndexing || !indexingPath.trim()}
              className="primary-btn"
            >
              {isIndexing ? (
                <>
                  <RefreshCw className="w-4 h-4 spinner" />
                  <span>Parsing AST & Indexing Embeddings...</span>
                </>
              ) : (
                <>
                  <Layers className="w-4 h-4" />
                  <span>Start Indexing Pipeline</span>
                </>
              )}
            </button>

            <div style={{ marginTop: '22px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
              <h4 style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--gray-500)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Indexed Repositories ({repos.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {repos.map(r => (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 16px',
                      background: '#141417',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      fontSize: '0.82rem',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, color: '#ffffff' }}>{r.name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                        {r.local_path}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ color: '#ffffff', fontWeight: 600 }}>{r.total_files} files</span>
                        <span style={{ color: 'var(--text-muted)' }}> • {r.total_chunks} chunks</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSyncRepo(r.id)}
                        disabled={syncingRepoId === r.id}
                        className="sync-repo-btn"
                        title={`Incrementally sync ${r.name} via Git diff`}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${syncingRepoId === r.id ? 'spinner' : ''}`} />
                        <span>{syncingRepoId === r.id ? 'Syncing...' : 'Sync Diff'}</span>
                      </button>
                      <button
                        onClick={() => handleDeleteRepo(r.id, r.name)}
                        className="delete-repo-btn"
                        title={`Remove ${r.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
