import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import {
  Box,
  Button,
  Dialog,
  Flex,
  IconButton,
  Input,
  Spinner,
  Tabs,
  Text,
} from '@chakra-ui/react';
import {
  Boxes,
  DownloadIcon,
  Maximize2,
  Network,
  RefreshCwIcon,
  Search,
  Share2,
  Tag,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { exportKgTtl, getKgGraph, getKgSchema } from '../api/client';
import { useColorMode } from './ui/color-mode';

const KG_EX = 'http://chatbot.kg/data#';

// Per-type node appearance. `value` (hub) nodes are recolored by their group-by column.
const NODE_STYLE = {
  dataset: { color: '#554971', r: 9, val: 6, maxChars: 22 },
  class: { color: '#8AC6D0', r: 8, val: 5, maxChars: 20 },
  predicate: { color: '#63768D', r: 5, val: 1.5, maxChars: 16 },
  instance: { color: '#9A8FB8', r: 3.2, val: 0.6, maxChars: 14 },
  value: { color: '#63768D', r: 7, val: 3, maxChars: 18 },
  default: { color: '#94a3b8', r: 5, val: 1, maxChars: 14 },
};

// Distinct hues for each active group-by column (records connect to hubs of these colors).
const HUB_PALETTE = [
  '#8AC6D0', '#E5989B', '#83C5BE', '#F4A261',
  '#BC96E6', '#A3B18A', '#6D9DC5', '#E0A458',
];

const SUBCLASS_COLOR = '#E0A458';
const RELATION_COLOR = 'rgba(138,198,208,0.95)';

function stripEx(uri) {
  return uri.startsWith(KG_EX) ? uri.slice(KG_EX.length) : uri;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const int = parseInt(full, 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${a})`;
}

export function KnowledgeGraph({ trigger }) {
  const { isDark } = useColorMode();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('graph');

  // ── Graph data / mode ──
  const [graphMode, setGraphMode] = useState('schema'); // 'schema' | 'instances'
  const [rawGraphData, setRawGraphData] = useState({ nodes: [], links: [] });
  const [graphMeta, setGraphMeta] = useState({ truncated: false, total: 0 });
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState(null);
  const [loadTrigger, setLoadTrigger] = useState(0);

  // Instance-mode controls
  const [selectedDataset, setSelectedDataset] = useState(null);
  const [availableColumns, setAvailableColumns] = useState([]); // [{name, distinct}]
  const [groupByCols, setGroupByCols] = useState([]); // explicit user selection ([] = auto)
  const [serverGroupBy, setServerGroupBy] = useState([]); // what the server actually grouped by

  // Datasets (shared by the instance picker and the export tab)
  const [datasets, setDatasets] = useState([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);

  // Interaction state
  const fgRef = useRef(null);
  const fittedRef = useRef(false);
  const [hoverNode, setHoverNode] = useState(null);
  const [highlightNodes, setHighlightNodes] = useState(new Set());
  const [highlightLinks, setHighlightLinks] = useState(new Set());
  const [showLabels, setShowLabels] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Click-to-inspect: the record whose detail popup is shown, tracked to its node on screen.
  const [selectedRecord, setSelectedRecord] = useState(null); // { node, name, props } | null
  const selectedRecordRef = useRef(null);
  const popupRef = useRef(null);

  // The columns actually driving hubs: explicit selection if any, else the server's auto-pick.
  const activeGroupBy = groupByCols.length ? groupByCols : serverGroupBy;
  const columnColor = useMemo(() => {
    const m = {};
    activeGroupBy.forEach((c, i) => {
      m[c] = HUB_PALETTE[i % HUB_PALETTE.length];
    });
    return m;
  }, [activeGroupBy]);

  // ── Export tab ──
  const [exporting, setExporting] = useState(null); // null | 'all' | dataset_name
  const [exportResults, setExportResults] = useState([]);
  const [exportError, setExportError] = useState(null);

  // In schema mode a dataset's columns stay hidden until the dataset is clicked; everything
  // else (classes, hierarchy, relations) is always shown. Instance mode shows all it returns.
  const visibleGraph = useMemo(() => {
    if (graphMode === 'instances') {
      return {
        nodes: rawGraphData.nodes,
        links: rawGraphData.links.map((l) => ({ ...l })),
      };
    }
    const visible = new Set(
      rawGraphData.nodes.filter((n) => n.type !== 'predicate').map((n) => n.id)
    );
    rawGraphData.links.forEach((l) => {
      const src = l.source?.id ?? l.source;
      const tgt = l.target?.id ?? l.target;
      if (l.label === 'hasColumn' && expandedNodes.has(src)) visible.add(tgt);
    });
    return {
      nodes: rawGraphData.nodes.filter((n) => visible.has(n.id)),
      links: rawGraphData.links
        .filter((l) => {
          const s = l.source?.id ?? l.source;
          const t = l.target?.id ?? l.target;
          return visible.has(s) && visible.has(t);
        })
        .map((l) => ({ ...l })),
    };
  }, [rawGraphData, expandedNodes, graphMode]);

  const instanceShown = useMemo(
    () => rawGraphData.nodes.filter((n) => n.type === 'instance').length,
    [rawGraphData]
  );

  // ── Data loading ──

  // Dataset list — loaded once when the dialog opens (feeds instance picker + export tab).
  useEffect(() => {
    if (!open) return;
    setDatasetsLoading(true);
    getKgSchema()
      .then((schema) => {
        const names = (schema.datasets ?? []).map(stripEx);
        setDatasets(names);
        setSelectedDataset((cur) => cur ?? names[0] ?? null);
      })
      .catch(() => setDatasets([]))
      .finally(() => setDatasetsLoading(false));
  }, [open]);

  // Graph data — reloads on open / tab / mode / dataset / group-by / manual reload.
  useEffect(() => {
    if (!open || tab !== 'graph') return;
    if (graphMode === 'instances' && !selectedDataset) return;
    fittedRef.current = false;
    setGraphLoading(true);
    setGraphError(null);
    setHoverNode(null);
    setHighlightNodes(new Set());
    setHighlightLinks(new Set());
    setSelectedRecord(null);
    getKgGraph({ mode: graphMode, dataset: selectedDataset, groupBy: groupByCols })
      .then((data) => {
        setRawGraphData({ nodes: data.nodes ?? [], links: data.links ?? [] });
        setExpandedNodes(new Set());
        setGraphMeta({ truncated: !!data.truncated, total: data.total ?? 0 });
        if (graphMode === 'instances') {
          setAvailableColumns(data.columns ?? []);
          setServerGroupBy(data.groupBy ?? []);
        }
      })
      .catch((e) => setGraphError(e.message))
      .finally(() => setGraphLoading(false));
  }, [open, tab, graphMode, selectedDataset, groupByCols, loadTrigger]);

  // ── Canvas sizing (responsive to the near-fullscreen modal) ──
  // Attach the ResizeObserver via a callback ref so it binds the moment the container mounts.
  // The dialog content mounts in a portal a tick after `open` flips, so an effect keyed on
  // `open` can run while the ref is still null, bail, and never observe — leaving the canvas
  // stuck at its default width while the modal is far wider.
  const resizeObsRef = useRef(null);
  const [dims, setDims] = useState({ width: 800, height: 500 });
  const setGraphContainer = useCallback((el) => {
    if (resizeObsRef.current) {
      resizeObsRef.current.disconnect();
      resizeObsRef.current = null;
    }
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) {
        setDims((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    resizeObsRef.current = ro;
  }, []);

  // Re-fit the graph whenever the canvas size (or mode/data) changes, so a small graph stays
  // centered and a resize never strands nodes outside the viewport.
  useEffect(() => {
    if (!fgRef.current || rawGraphData.nodes.length === 0) return;
    const t = setTimeout(() => fgRef.current?.zoomToFit(400, 60), 120);
    return () => clearTimeout(t);
  }, [dims, rawGraphData, graphMode]);

  // ── Interactions ──
  const switchMode = useCallback(
    (mode) => {
      setGraphMode(mode);
      if (mode === 'instances') {
        setGroupByCols([]);
        setSelectedDataset((cur) => cur ?? datasets[0] ?? null);
      }
    },
    [datasets]
  );

  const changeDataset = useCallback((name) => {
    setSelectedDataset(name);
    setGroupByCols([]); // let the server auto-pick hubs for the new dataset
  }, []);

  const toggleGroupBy = useCallback(
    (name) => {
      setGroupByCols((prev) => {
        const base = prev.length ? prev : serverGroupBy;
        return base.includes(name) ? base.filter((n) => n !== name) : [...base, name];
      });
    },
    [serverGroupBy]
  );

  const applyHighlight = useCallback(
    (node) => {
      const hNodes = new Set();
      const hLinks = new Set();
      if (node) {
        hNodes.add(node.id);
        visibleGraph.links.forEach((l) => {
          const s = l.source?.id ?? l.source;
          const t = l.target?.id ?? l.target;
          if (s === node.id || t === node.id) {
            hLinks.add(l);
            hNodes.add(s);
            hNodes.add(t);
          }
        });
      }
      setHoverNode(node || null);
      setHighlightNodes(hNodes);
      setHighlightLinks(hLinks);
    },
    [visibleGraph]
  );

  const handleNodeHover = useCallback(
    (node) => {
      document.body.style.cursor = node ? 'pointer' : 'default';
      applyHighlight(node);
    },
    [applyHighlight]
  );

  const handleNodeClick = useCallback(
    (node) => {
      const fg = fgRef.current;
      // Schema mode: dataset nodes expand/collapse their columns; no record popup here.
      if (graphMode === 'schema') {
        if (node.type === 'dataset') {
          setExpandedNodes((prev) => {
            const next = new Set(prev);
            next.has(node.id) ? next.delete(node.id) : next.add(node.id);
            return next;
          });
          if (fg) fg.centerAt(node.x, node.y, 400);
          return;
        }
        if (fg) {
          fg.centerAt(node.x, node.y, 500);
          fg.zoom(Math.max(fg.zoom(), 3), 500);
        }
        return;
      }
      // Instance mode: clicking a record pops up its fields, anchored above the node.
      if (node.type === 'instance') {
        setSelectedRecord({ node, name: node.name, props: node.props || [] });
        if (fg) {
          fg.centerAt(node.x, node.y, 500);
          fg.zoom(Math.max(fg.zoom(), 2.5), 500);
        }
        return;
      }
      // A value hub (or anything else): just focus and close any open popup.
      setSelectedRecord(null);
      if (fg) fg.centerAt(node.x, node.y, 500);
    },
    [graphMode]
  );

  // Keep the detail popup pinned above its node through zoom / pan / drag / simulation. Positioned
  // imperatively (no React re-render per frame) via the graph's screen-coordinate projection.
  const positionPopup = useCallback(() => {
    const rec = selectedRecordRef.current;
    const fg = fgRef.current;
    const el = popupRef.current;
    if (!rec || !fg || !el || rec.node.x == null) return;
    const { x, y } = fg.graph2ScreenCoords(rec.node.x, rec.node.y);
    el.style.left = `${x}px`;
    el.style.top = `${y - 14}px`;
  }, []);

  useLayoutEffect(() => {
    selectedRecordRef.current = selectedRecord;
    if (selectedRecord) positionPopup();
  }, [selectedRecord, positionPopup]);

  const zoomBy = useCallback((factor) => {
    const fg = fgRef.current;
    if (fg) fg.zoom(fg.zoom() * factor, 250);
  }, []);

  const fitView = useCallback(() => {
    fgRef.current?.zoomToFit(400, 40);
  }, []);

  const runSearch = useCallback(
    (e) => {
      e?.preventDefault();
      const q = searchQuery.trim().toLowerCase();
      if (!q) return;
      const match = visibleGraph.nodes.find((n) => (n.name || '').toLowerCase().includes(q));
      const fg = fgRef.current;
      if (match && fg && match.x != null) {
        fg.centerAt(match.x, match.y, 600);
        fg.zoom(4, 600);
        applyHighlight(match);
      }
    },
    [searchQuery, visibleGraph, applyHighlight]
  );

  // ── Rendering callbacks ──
  const nodeColor = useCallback(
    (node) =>
      node.type === 'value'
        ? columnColor[node.column] || NODE_STYLE.value.color
        : (NODE_STYLE[node.type] || NODE_STYLE.default).color,
    [columnColor]
  );

  const nodeCanvasObject = useCallback(
    (node, ctx, globalScale) => {
      const style = NODE_STYLE[node.type] || NODE_STYLE.default;
      const r = style.r;
      const dim = hoverNode && !highlightNodes.has(node.id);
      ctx.globalAlpha = dim ? 0.12 : 1;

      // Emphasis ring on the hovered node
      if (hoverNode && node.id === hoverNode.id) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = hexToRgba('#8AC6D0', 0.35);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = nodeColor(node);
      ctx.fill();
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';
      ctx.stroke();

      const alwaysLabel = node.type === 'dataset' || node.type === 'class' || node.type === 'value';
      const drawLabel =
        showLabels || highlightNodes.has(node.id) || alwaysLabel || globalScale > 2.2;
      if (drawLabel && node.name) {
        const label = truncate(node.name, style.maxChars);
        const fontSize = 12 / globalScale;
        ctx.font = `${fontSize}px Inter, Sans-Serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(label).width;
        const padX = 3 / globalScale;
        const padY = 2 / globalScale;
        const ly = node.y + r + fontSize * 0.9 + 1 / globalScale;
        ctx.fillStyle = isDark ? 'rgba(18,18,26,0.72)' : 'rgba(255,255,255,0.78)';
        ctx.fillRect(node.x - tw / 2 - padX, ly - fontSize / 2 - padY, tw + padX * 2, fontSize + padY * 2);
        ctx.fillStyle = isDark ? '#e8e8ef' : '#2a2a35';
        ctx.fillText(label, node.x, ly);
      }
      ctx.globalAlpha = 1;
    },
    [hoverNode, highlightNodes, showLabels, isDark, nodeColor]
  );

  const nodePointerAreaPaint = useCallback((node, color, ctx) => {
    const r = (NODE_STYLE[node.type] || NODE_STYLE.default).r;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 2, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  const linkColor = useCallback(
    (link) => {
      if (hoverNode && !highlightLinks.has(link)) return 'rgba(130,130,150,0.05)';
      if (link.type === 'subClassOf') return SUBCLASS_COLOR;
      if (link.relation) return RELATION_COLOR;
      if (link.type === 'materializes') {
        return isDark ? 'rgba(154,143,184,0.6)' : 'rgba(85,73,113,0.55)';
      }
      if (link.type === 'hasValue') {
        return hexToRgba(columnColor[link.label] || '#63768D', 0.4);
      }
      return isDark ? 'rgba(150,160,180,0.22)' : 'rgba(85,73,113,0.25)';
    },
    [hoverNode, highlightLinks, isDark, columnColor]
  );

  const linkWidth = useCallback(
    (link) => {
      if (highlightLinks.has(link)) return 3;
      if (link.type === 'subClassOf' || link.relation) return 1.6;
      if (link.type === 'materializes') return 1.2;
      return 0.6;
    },
    [highlightLinks]
  );

  // ── Export ──
  async function handleExport(datasetName) {
    setExporting(datasetName ?? 'all');
    setExportError(null);
    try {
      const { filename } = await exportKgTtl(datasetName);
      setExportResults((prev) =>
        [{ filename, key: `${filename}-${Date.now()}` }, ...prev].slice(0, 6)
      );
    } catch (e) {
      setExportError(e.message);
    } finally {
      setExporting(null);
    }
  }

  const hasData = rawGraphData.nodes.length > 0;
  const legendItems =
    graphMode === 'instances'
      ? [
          { color: NODE_STYLE.instance.color, label: 'Record' },
          ...activeGroupBy.map((c) => ({ color: columnColor[c], label: c })),
        ]
      : [
          { color: NODE_STYLE.dataset.color, label: 'Dataset' },
          { color: NODE_STYLE.class.color, label: 'Class' },
          { color: NODE_STYLE.predicate.color, label: 'Column' },
          { color: RELATION_COLOR, label: 'relation', line: true },
          { color: SUBCLASS_COLOR, label: 'subclass', line: true },
        ];

  return (
    <Dialog.Root open={open} onOpenChange={({ open: o }) => setOpen(o)} placement="center">
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Backdrop />
      <Dialog.Positioner>
        <Dialog.Content
          maxW="95vw"
          w="95vw"
          h="90vh"
          borderRadius="2xl"
          p={0}
          overflow="hidden"
          display="flex"
          flexDirection="column"
        >
          {/* Header */}
          <Flex
            align="center"
            gap={2}
            px={5}
            py={4}
            borderBottom="1px solid"
            borderColor="border.muted"
            flexShrink={0}
          >
            <Network size={14} />
            <Text fontWeight="semibold" fontSize="sm" color="fg">
              Knowledge Graph
            </Text>
          </Flex>

          {/* Tabs */}
          <Tabs.Root
            value={tab}
            onValueChange={({ value }) => setTab(value)}
            display="flex"
            flexDirection="column"
            flex="1"
            minH={0}
          >
            <Tabs.List px={4} borderBottom="1px solid" borderColor="border.muted" flexShrink={0}>
              <Tabs.Trigger value="graph" fontSize="xs">Graph</Tabs.Trigger>
              <Tabs.Trigger value="export" fontSize="xs">Export TTL</Tabs.Trigger>
            </Tabs.List>

            {/* ── Graph tab ── */}
            <Tabs.Content value="graph" p={0} display="flex" flexDirection="column" flex="1" minH={0}>
              {/* Toolbar */}
              <Flex
                px={4}
                py={2}
                gap={3}
                align="center"
                wrap="wrap"
                borderBottom="1px solid"
                borderColor="border.muted"
                flexShrink={0}
              >
                {/* Mode toggle */}
                <Flex borderWidth="1px" borderColor="border.muted" borderRadius="md" overflow="hidden">
                  <Button
                    size="xs"
                    variant="ghost"
                    borderRadius="0"
                    bg={graphMode === 'schema' ? 'bg.muted' : 'transparent'}
                    color={graphMode === 'schema' ? 'fg' : 'fg.muted'}
                    onClick={() => switchMode('schema')}
                  >
                    <Share2 size={12} /> Ontology
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    borderRadius="0"
                    bg={graphMode === 'instances' ? 'bg.muted' : 'transparent'}
                    color={graphMode === 'instances' ? 'fg' : 'fg.muted'}
                    onClick={() => switchMode('instances')}
                  >
                    <Boxes size={12} /> Instances
                  </Button>
                </Flex>

                {/* Instance-mode pickers */}
                {graphMode === 'instances' && (
                  <>
                    {datasets.length > 1 && (
                      <select
                        value={selectedDataset || ''}
                        onChange={(e) => changeDataset(e.target.value)}
                        style={{
                          fontSize: '12px',
                          padding: '3px 6px',
                          borderRadius: '6px',
                          background: isDark ? '#1e1e28' : '#fff',
                          color: isDark ? '#e8e8ef' : '#2a2a35',
                          border: `1px solid ${isDark ? '#3a3a48' : '#d9d9e0'}`,
                          maxWidth: '220px',
                        }}
                      >
                        {datasets.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    )}
                    <Flex align="center" gap={1.5} wrap="wrap">
                      <Text fontSize="xs" color="fg.subtle">group by</Text>
                      {availableColumns.slice(0, 12).map((c) => {
                        const on = activeGroupBy.includes(c.name);
                        return (
                          <Button
                            key={c.name}
                            size="xs"
                            variant={on ? 'solid' : 'outline'}
                            onClick={() => toggleGroupBy(c.name)}
                            style={
                              on
                                ? {
                                    background: columnColor[c.name] || '#63768D',
                                    color: '#fff',
                                    borderColor: 'transparent',
                                  }
                                : undefined
                            }
                          >
                            {truncate(c.name, 16)}
                            <Text as="span" opacity={0.6} ml={1}>{c.distinct}</Text>
                          </Button>
                        );
                      })}
                    </Flex>
                  </>
                )}

                <Box flex={1} minW={2} />

                {/* Search */}
                <form onSubmit={runSearch}>
                  <Flex align="center" gap={1}>
                    <Input
                      size="xs"
                      width="150px"
                      placeholder="Find node…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <IconButton size="xs" variant="ghost" aria-label="Search" type="submit">
                      <Search size={13} />
                    </IconButton>
                  </Flex>
                </form>

                {/* Zoom controls */}
                <Flex align="center" gap={0.5}>
                  <IconButton size="xs" variant="ghost" aria-label="Zoom out" onClick={() => zoomBy(0.7)}>
                    <ZoomOut size={14} />
                  </IconButton>
                  <IconButton size="xs" variant="ghost" aria-label="Zoom in" onClick={() => zoomBy(1.4)}>
                    <ZoomIn size={14} />
                  </IconButton>
                  <IconButton size="xs" variant="ghost" aria-label="Fit to view" onClick={fitView}>
                    <Maximize2 size={14} />
                  </IconButton>
                </Flex>

                <IconButton
                  size="xs"
                  variant={showLabels ? 'solid' : 'ghost'}
                  aria-label="Toggle labels"
                  aria-pressed={showLabels}
                  onClick={() => setShowLabels((v) => !v)}
                >
                  <Tag size={14} />
                </IconButton>
                <IconButton
                  size="xs"
                  variant="ghost"
                  aria-label="Reload graph"
                  onClick={() => setLoadTrigger((n) => n + 1)}
                >
                  <RefreshCwIcon size={13} />
                </IconButton>
              </Flex>

              {/* Graph canvas */}
              <Box ref={setGraphContainer} flex="1" w="full" minW={0} minH={0} position="relative" overflow="hidden">
                {hasData && dims.width > 0 && (
                  <ForceGraph2D
                    ref={fgRef}
                    graphData={visibleGraph}
                    width={dims.width}
                    height={dims.height}
                    backgroundColor="rgba(0,0,0,0)"
                    nodeLabel="name"
                    nodeVal={(n) => (NODE_STYLE[n.type] || NODE_STYLE.default).val}
                    nodeRelSize={4}
                    nodeCanvasObject={nodeCanvasObject}
                    nodeCanvasObjectMode={() => 'replace'}
                    nodePointerAreaPaint={nodePointerAreaPaint}
                    onNodeClick={handleNodeClick}
                    onNodeHover={handleNodeHover}
                    onBackgroundClick={() => setSelectedRecord(null)}
                    onRenderFramePost={positionPopup}
                    onEngineStop={() => {
                      if (!fittedRef.current) {
                        fgRef.current?.zoomToFit(400, 50);
                        fittedRef.current = true;
                      }
                    }}
                    linkLabel="label"
                    linkColor={linkColor}
                    linkWidth={linkWidth}
                    linkDirectionalArrowLength={(l) =>
                      l.relation || l.type === 'subClassOf' || l.type === 'materializes' ? 3.2 : 0
                    }
                    linkDirectionalArrowRelPos={1}
                    linkDirectionalParticles={(l) => (highlightLinks.has(l) ? 3 : 0)}
                    linkDirectionalParticleWidth={2}
                  />
                )}

                {graphLoading && (
                  <Flex position="absolute" inset={0} align="center" justify="center" pointerEvents="none">
                    <Spinner size="md" color="#8AC6D0" />
                  </Flex>
                )}
                {!graphLoading && graphError && (
                  <Flex position="absolute" inset={0} align="center" justify="center">
                    <Text fontSize="xs" color="red.500">{graphError}</Text>
                  </Flex>
                )}
                {!graphLoading && !graphError && !hasData && (
                  <Flex position="absolute" inset={0} align="center" justify="center">
                    <Text fontSize="xs" color="fg.subtle">
                      {graphMode === 'instances'
                        ? 'No records for this dataset.'
                        : 'No graph data. Upload a file to get started.'}
                    </Text>
                  </Flex>
                )}

                {/* Truncation note */}
                {graphMode === 'instances' && graphMeta.truncated && (
                  <Box
                    position="absolute"
                    top={2}
                    right={3}
                    px={2}
                    py={1}
                    borderRadius="md"
                    bg="bg.panel"
                    borderWidth="1px"
                    borderColor="border.muted"
                    opacity={0.92}
                  >
                    <Text fontSize="xs" color="fg.muted">
                      showing {instanceShown} of {graphMeta.total} records
                    </Text>
                  </Box>
                )}

                {/* Legend */}
                {hasData && (
                  <Flex
                    position="absolute"
                    left={3}
                    bottom={3}
                    gap={3}
                    px={3}
                    py={2}
                    borderRadius="md"
                    bg="bg.panel"
                    borderWidth="1px"
                    borderColor="border.muted"
                    opacity={0.92}
                    wrap="wrap"
                    maxW="70%"
                  >
                    {legendItems.map((item) => (
                      <Flex key={item.label} align="center" gap={1.5}>
                        <Box
                          w={item.line ? '14px' : '10px'}
                          h={item.line ? '2px' : '10px'}
                          borderRadius={item.line ? '0' : 'full'}
                          bg={item.color}
                        />
                        <Text fontSize="xs" color="fg.muted">{truncate(item.label, 18)}</Text>
                      </Flex>
                    ))}
                  </Flex>
                )}

                {/* Record detail popup — anchored above the clicked record node */}
                {selectedRecord && (
                  <Box
                    ref={popupRef}
                    position="absolute"
                    top={0}
                    left={0}
                    transform="translate(-50%, -100%)"
                    zIndex={20}
                    w="300px"
                    maxW="90%"
                    bg="bg.panel"
                    borderWidth="1px"
                    borderColor="border.muted"
                    borderRadius="lg"
                    boxShadow="lg"
                    p={3}
                  >
                    <Flex align="center" justify="space-between" gap={2} mb={2}>
                      <Text
                        fontSize="xs"
                        fontWeight="semibold"
                        color="fg"
                        lineClamp={1}
                        title={selectedRecord.name}
                      >
                        {selectedRecord.name || 'Record'}
                      </Text>
                      <IconButton
                        size="xs"
                        variant="ghost"
                        color="fg.muted"
                        aria-label="Close details"
                        onClick={() => setSelectedRecord(null)}
                      >
                        <X size={12} />
                      </IconButton>
                    </Flex>
                    {selectedRecord.props.length === 0 ? (
                      <Text fontSize="xs" color="fg.subtle">
                        No fields — re-upload the file to include record details.
                      </Text>
                    ) : (
                      <Flex direction="column" gap={1.5} maxH="280px" overflowY="auto">
                        {selectedRecord.props.map(([k, v], i) => (
                          <Box key={`${k}-${i}`}>
                            <Text fontSize="10px" color="fg.subtle" lineClamp={1} title={k}>
                              {k}
                            </Text>
                            <Text fontSize="xs" color="fg" wordBreak="break-word">
                              {v}
                            </Text>
                          </Box>
                        ))}
                      </Flex>
                    )}
                    {/* downward pointer toward the node */}
                    <Box
                      position="absolute"
                      bottom="-5px"
                      left="50%"
                      w="9px"
                      h="9px"
                      bg="bg.panel"
                      borderRight="1px solid"
                      borderBottom="1px solid"
                      borderColor="border.muted"
                      transform="translateX(-50%) rotate(45deg)"
                    />
                  </Box>
                )}
              </Box>
            </Tabs.Content>

            {/* ── Export TTL tab ── */}
            <Tabs.Content value="export" p={0} flex="1" minH={0} overflowY="auto">
              <Box px={5} py={4}>
                {datasetsLoading ? (
                  <Flex justify="center" py={8}>
                    <Spinner size="sm" />
                  </Flex>
                ) : (
                  <>
                    <Flex justify="space-between" align="center" mb={1}>
                      <Text fontSize="xs" color="fg.muted">
                        {datasets.length} dataset{datasets.length !== 1 ? 's' : ''} in store
                      </Text>
                      <Button
                        size="xs"
                        loading={exporting === 'all'}
                        disabled={datasets.length === 0 || exporting !== null}
                        onClick={() => handleExport(null)}
                        style={{
                          background: 'linear-gradient(135deg, #554971 0%, #8AC6D0 100%)',
                          color: 'white',
                        }}
                      >
                        Export All
                      </Button>
                    </Flex>

                    <Text fontSize="xs" color="fg.subtle" mb={3}>
                      Files download to your browser’s Downloads folder — one{' '}
                      <Text as="span" fontFamily="mono">.ttl</Text> per dataset, or all
                      bundled as <Text as="span" fontFamily="mono">ttl_exports.zip</Text>.
                    </Text>

                    {exportError && (
                      <Text fontSize="xs" color="red.500" mb={2}>
                        {exportError}
                      </Text>
                    )}

                    {exportResults.length > 0 && (
                      <Box
                        mb={3}
                        p={3}
                        borderRadius="md"
                        bg="green.subtle"
                        _dark={{ bg: 'rgba(16,185,129,0.1)' }}
                      >
                        {exportResults.map((r) => (
                          <Text
                            key={r.key}
                            fontSize="xs"
                            color="green.700"
                            _dark={{ color: 'green.300' }}
                            fontFamily="mono"
                            lineClamp={2}
                            title={r.filename}
                          >
                            ✓ Downloaded {r.filename}
                          </Text>
                        ))}
                      </Box>
                    )}

                    {datasets.length === 0 ? (
                      <Text fontSize="xs" color="fg.subtle" textAlign="center" mt={6}>
                        No datasets. Upload a file first.
                      </Text>
                    ) : (
                      <Flex direction="column" gap={1}>
                        {datasets.map((name) => (
                          <Flex
                            key={name}
                            align="center"
                            gap={2}
                            px={3}
                            py={2}
                            borderRadius="md"
                            bg="bg.muted"
                          >
                            <Text fontSize="xs" color="fg" flex={1} truncate title={name}>
                              {name}
                            </Text>
                            <Button
                              size="xs"
                              variant="ghost"
                              color="fg.muted"
                              loading={exporting === name}
                              disabled={exporting !== null}
                              onClick={() => handleExport(name)}
                              _hover={{ color: 'fg', bg: 'bg.subtle' }}
                            >
                              <DownloadIcon size={12} />
                              Export
                            </Button>
                          </Flex>
                        ))}
                      </Flex>
                    )}
                  </>
                )}
              </Box>
            </Tabs.Content>
          </Tabs.Root>

          {/* Footer */}
          <Flex
            justify="flex-end"
            px={5}
            py={3}
            borderTop="1px solid"
            borderColor="border.muted"
            flexShrink={0}
          >
            <Dialog.CloseTrigger asChild>
              <Button variant="ghost" size="sm" color="fg.muted">
                Close
              </Button>
            </Dialog.CloseTrigger>
          </Flex>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  );
}
