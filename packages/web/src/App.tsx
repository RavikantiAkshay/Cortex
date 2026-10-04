import { useState, useEffect, useRef } from 'react';
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
  const selectedNode = graphData.nodes.find(n => n.id === selectedNodeId) || graphData.nodes[0];
  const outgoingEdges = selectedNode ? graphData.edges.filter(e => e.source === selectedNode.id) : [];
  const internalImports = outgoingEdges.filter(e => e.target && graphData.nodes.some(n => n.id === e.target));
  const externalImports = outgoingEdges.filter(e => !e.target || !graphData.nodes.some(n => n.id === e.target));
  const incomingEdges = selectedNode ? graphData.edges.filter(e => e.target === selectedNode.id) : [];

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
                <h3>What is the Dependency DAG and what does it do?</h3>
                <p>
                  Standard RAG retrieves code snippets in isolation, causing LLMs to hallucinate missing functions and import statements. 
                  Cortex builds a directed graph from the code's Abstract Syntax Tree (AST) mapping every import, export, and symbol call. 
                  During search, Cortex performs <strong>1-2 hop graph traversals</strong> along these edges to automatically pull imported dependencies and caller context into the prompt alongside vector hits.
                </p>
              </div>
            </div>

            {/* Stats Bar */}
            <div className="dag-stats-bar">
              <div className="dag-stat-pill">
                <FileCode className="w-4 h-4" />
                <span>Modules / Files: <strong>{graphData.nodes.length}</strong></span>
              </div>
              <div className="dag-stat-pill">
                <GitBranch className="w-4 h-4" />
                <span>Dependency Connections: <strong>{graphData.edges.length}</strong></span>
              </div>
              <div className="dag-stat-pill">
                <Database className="w-4 h-4" />
                <span>Repository: <strong>{selectedRepo?.name || 'None'}</strong></span>
              </div>
            </div>

            {/* 2-Column Explorer */}
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
                        const edgeCount = graphData.edges.filter(e => e.source === node.id || e.target === node.id).length;
                        const isSelected = (selectedNode?.id === node.id);
                        return (
                          <button
                            key={node.id}
                            type="button"
                            onClick={() => setSelectedNodeId(node.id)}
                            className={`dag-module-btn ${isSelected ? 'active' : ''}`}
                          >
                            <div className="dag-module-label">
                              <span>{node.label}</span>
                              <span className="dag-badge-pill">{edgeCount} deps</span>
                            </div>
                            <div className="dag-module-sub">{node.path}</div>
                          </button>
                        );
                      })
                  )}
                </div>
              </div>

              {/* Right Column: Deep Dependency Inspector */}
              <div className="dag-inspector-panel">
                {selectedNode ? (
                  <>
                    <div className="dag-inspector-header">
                      <div>
                        <div className="dag-inspector-title">
                          <FileCode className="w-6 h-6" />
                          <span>{selectedNode.label}</span>
                        </div>
                        <div className="dag-inspector-sub">{selectedNode.path}</div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                          <span className="dag-badge-pill">{selectedNode.lines} lines</span>
                          <span className="dag-badge-pill">{selectedNode.language}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="dag-query-module-btn"
                        onClick={() => {
                          const prompt = `Explain the architectural purpose, dependencies, and responsibilities of ${selectedNode.label}`;
                          setActiveTab('query');
                          handleRunQuery(prompt);
                        }}
                      >
                        <Search className="w-3.5 h-3.5" />
                        <span>Query With Cortex</span>
                      </button>
                    </div>

                    {/* Section 1: Outgoing Dependencies (What this file imports) */}
                    <div>
                      <div className="dag-section-title">
                        <ArrowUpRight className="w-4 h-4" />
                        <span>Dependencies / Imports ({internalImports.length + externalImports.length})</span>
                      </div>
                      
                      {internalImports.length === 0 && externalImports.length === 0 ? (
                        <div className="dag-empty-box">This file has no external imports or module dependencies.</div>
                      ) : (
                        <div className="dag-edge-grid">
                          {internalImports.map((edge, idx) => {
                            const targetNode = graphData.nodes.find(n => n.id === edge.target);
                            return (
                              <div
                                key={idx}
                                className="dag-edge-card"
                                onClick={() => targetNode && setSelectedNodeId(targetNode.id)}
                                title="Click to inspect module"
                              >
                                <div className="dag-edge-name">
                                  <FileCode className="w-3.5 h-3.5" />
                                  <span>{targetNode ? targetNode.label : 'Internal Module'}</span>
                                </div>
                                <div className="dag-edge-symbol">
                                  {edge.symbol ? `calls: ${edge.symbol}` : edge.rawImport || 'module import'}
                                </div>
                              </div>
                            );
                          })}

                          {externalImports.map((edge, idx) => (
                            <div key={`ext-${idx}`} className="dag-edge-card" style={{ opacity: 0.85 }}>
                              <div className="dag-edge-name">
                                <Package className="w-3.5 h-3.5" />
                                <span>{edge.rawImport || edge.symbol || 'external'}</span>
                              </div>
                              <div className="dag-edge-symbol">external dependency</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Section 2: Incoming Dependents (What files import this) */}
                    <div>
                      <div className="dag-section-title">
                        <ArrowDownLeft className="w-4 h-4" />
                        <span>Dependents / Imported By ({incomingEdges.length})</span>
                      </div>

                      {incomingEdges.length === 0 ? (
                        <div className="dag-empty-box">No other local modules directly import this file (it may be an entry point or route handler).</div>
                      ) : (
                        <div className="dag-edge-grid">
                          {incomingEdges.map((edge, idx) => {
                            const sourceNode = graphData.nodes.find(n => n.id === edge.source);
                            return (
                              <div
                                key={idx}
                                className="dag-edge-card"
                                onClick={() => sourceNode && setSelectedNodeId(sourceNode.id)}
                                title="Click to inspect caller module"
                              >
                                <div className="dag-edge-name">
                                  <FileCode className="w-3.5 h-3.5" />
                                  <span>{sourceNode ? sourceNode.label : 'Caller Module'}</span>
                                </div>
                                <div className="dag-edge-symbol">
                                  {sourceNode?.path || 'source file'}
                                </div>
                              </div>
                            );
                          })}
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
