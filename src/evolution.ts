/**
 * Forge MCP — Agent Evolution & Genealogy Store
 *
 * Persists agent evolution state (traits, abilities, chat topics)
 * and fusion genealogy (lineage) in a local JSON file.
 * Zero external dependencies — no SQLite, no Redis.
 *
 * File: ~/.hermes/forge-evolution/evolution-store.json
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import logger from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface AgentTrait {
  id: string;
  name: string;
  description: string;
  category: "ability" | "personality" | "special";
  unlockedAt: string; // ISO timestamp
  unlockSource: "chat" | "evolution" | "fusion" | "manual";
}

export interface TopicTracker {
  topic: string;
  count: number;
  lastMentioned: string; // ISO timestamp
}

export interface EvolutionState {
  agentId: string;
  traits: AgentTrait[];
  topicCounters: TopicTracker[];
  totalChats: number;
  level: number; // synced from API
  evolutionStage: number; // 0 = base, 1 = evolved, 2+ = higher
  lastEvolvedAt: string | null;
}

export interface FusionRecord {
  id: string;
  baseAgentId: string;
  fodderAgentId: string;
  baseName: string;
  fodderName: string;
  success: boolean;
  timestamp: string;
}

export interface LineageNode {
  agentId: string;
  name: string;
  parents: {
    base: string | null;
    fodder: string | null;
  };
  children: string[];
  fusionRecords: FusionRecord[];
  createdAt: string;
}

export interface EvolutionStore {
  agents: Record<string, EvolutionState>;
  lineages: Record<string, LineageNode>;
}

// ─── Trait Definitions ───────────────────────────────────────────────

/** Topics that can trigger trait unlocks and their thresholds. */
export const EVOLVABLE_TOPICS: Record<
  string,
  { traitId: string; name: string; description: string; threshold: number }
> = {
  data_analysis: {
    traitId: "data_analysis",
    name: "Data Analysis",
    description: "Can analyze structured data, find patterns, and generate insights",
    threshold: 5,
  },
  creative_writing: {
    traitId: "creative_writing",
    name: "Creative Writing",
    description: "Generates stories, poetry, and creative content with flair",
    threshold: 5,
  },
  code_generation: {
    traitId: "code_generation",
    name: "Code Generation",
    description: "Writes and debugs code across multiple programming languages",
    threshold: 5,
  },
  strategy: {
    traitId: "strategy",
    name: "Strategic Thinking",
    description: "Analyzes complex situations and provides strategic recommendations",
    threshold: 5,
  },
  empathy: {
    traitId: "empathy",
    name: "Empathetic Response",
    description: "Responds with emotional intelligence and understanding",
    threshold: 5,
  },
  humor: {
    traitId: "humor",
    name: "Wit & Humor",
    description: "Uses humor, wordplay, and jokes in responses",
    threshold: 5,
  },
};

// ─── Implementation ───────────────────────────────────────────────────

const STORE_DIR = path.join(os.homedir(), ".hermes", "forge-evolution");
const STORE_FILE = path.join(STORE_DIR, "evolution-store.json");

function ensureDir(): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
}

function load(): EvolutionStore {
  ensureDir();
  if (!fs.existsSync(STORE_FILE)) {
    const empty: EvolutionStore = { agents: {}, lineages: {} };
    fs.writeFileSync(STORE_FILE, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf-8");
    return JSON.parse(raw) as EvolutionStore;
  } catch (err) {
    logger.error("Failed to read evolution store", { error: String(err) });
    return { agents: {}, lineages: {} };
  }
}

function save(store: EvolutionStore): void {
  ensureDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
}

// ─── Agent Evolution ─────────────────────────────────────────────────

export function getOrCreateEvolutionState(
  agentId: string,
  _agentName?: string,
): EvolutionState {
  const store = load();
  if (!store.agents[agentId]) {
    store.agents[agentId] = {
      agentId,
      traits: [],
      topicCounters: [],
      totalChats: 0,
      level: 1,
      evolutionStage: 0,
      lastEvolvedAt: null,
    };
    save(store);
  }
  return store.agents[agentId];
}

/**
 * Analyze chat message content and update topic counters.
 * Returns any newly unlocked traits.
 */
export function analyzeChat(
  agentId: string,
  message: string,
  _agentLevel: number,
): AgentTrait[] {
  const store = load();
  const state = store.agents[agentId];
  if (!state) return [];

  const messageLower = message.toLowerCase();
  const newTraits: AgentTrait[] = [];

  // Update topic counters based on keyword matching
  for (const [_, def] of Object.entries(EVOLVABLE_TOPICS)) {
    const keywords = getKeywordsForTopic(def.traitId);
    const matches = keywords.filter((kw) => messageLower.includes(kw));
    if (matches.length === 0) continue;

    const existing = state.topicCounters.find((t) => t.topic === def.traitId);
    if (existing) {
      existing.count += matches.length;
      existing.lastMentioned = new Date().toISOString();
    } else {
      state.topicCounters.push({
        topic: def.traitId,
        count: matches.length,
        lastMentioned: new Date().toISOString(),
      });
    }

    // Check if threshold is met and trait not already unlocked
    const currentCount =
      state.topicCounters.find((t) => t.topic === def.traitId)?.count ?? 0;
    const alreadyHas = state.traits.some((t) => t.id === def.traitId);

    if (currentCount >= def.threshold && !alreadyHas) {
      const trait: AgentTrait = {
        id: def.traitId,
        name: def.name,
        description: def.description,
        category: "ability",
        unlockedAt: new Date().toISOString(),
        unlockSource: "chat",
      };
      state.traits.push(trait);
      newTraits.push(trait);
    }
  }

  state.totalChats++;

  // Check for evolution stage advancement
  const traitCount = state.traits.length;
  const newStage = Math.min(
    Math.floor(traitCount / 2),
    5, // max stage
  );

  if (newStage > state.evolutionStage) {
    state.evolutionStage = newStage;
    state.lastEvolvedAt = new Date().toISOString();
  }

  save(store);
  return newTraits;
}

/** Get evolution state for display (without modifying) */
export function getEvolutionState(agentId: string): EvolutionState | null {
  const store = load();
  return store.agents[agentId] ?? null;
}

/** Get all known evolution states */
export function getAllEvolutionStates(): EvolutionState[] {
  const store = load();
  return Object.values(store.agents);
}

// ─── Genealogy ───────────────────────────────────────────────────────

/** Record a fusion event in the lineage */
export function recordFusion(event: {
  baseAgentId: string;
  fodderAgentId: string;
  baseName: string;
  fodderName: string;
  success: boolean;
}): void {
  const store = load();
  const fusionId = `${event.baseAgentId}--${event.fodderAgentId}--${Date.now()}`;
  const now = new Date().toISOString();

  // Ensure lineage nodes exist
  for (const id of [event.baseAgentId, event.fodderAgentId]) {
    if (!store.lineages[id]) {
      store.lineages[id] = {
        agentId: id,
        name:
          id === event.baseAgentId ? event.baseName : event.fodderName,
        parents: { base: null, fodder: null },
        children: [],
        fusionRecords: [],
        createdAt: now,
      };
    }
  }

  const record: FusionRecord = {
    id: fusionId,
    baseAgentId: event.baseAgentId,
    fodderAgentId: event.fodderAgentId,
    baseName: event.baseName,
    fodderName: event.fodderName,
    success: event.success,
    timestamp: now,
  };

  store.lineages[event.baseAgentId].fusionRecords.push(record);
  if (!store.lineages[event.baseAgentId].children.includes(event.fodderAgentId)) {
    store.lineages[event.baseAgentId].children.push(event.fodderAgentId);
  }

  save(store);
}

/** Get lineage for an agent */
export function getLineage(agentId: string): LineageNode | null {
  const store = load();
  return store.lineages[agentId] ?? null;
}

/** Get full family tree (up to N generations) */
export function getFamilyTree(
  agentId: string,
  generations = 3,
): LineageNode & { ancestors: LineageNode[]; descendants: LineageNode[] } {
  const store = load();
  const node = store.lineages[agentId];
  if (!node) {
    return {
      agentId: "unknown",
      name: "Unknown",
      parents: { base: null, fodder: null },
      children: [],
      fusionRecords: [],
      createdAt: new Date().toISOString(),
      ancestors: [],
      descendants: [],
    };
  }

  // Walk ancestors
  const ancestors: LineageNode[] = [];
  let currentId: string | null = agentId;
  for (let i = 0; i < generations && currentId; i++) {
    const current: LineageNode | undefined = store.lineages[currentId];
    if (!current) break;
    ancestors.push(current);
    currentId = current.parents.base || current.parents.fodder || null;
  }

  // Walk descendants
  const descendants: LineageNode[] = [];
  const queue: string[] = [...node.children];
  let depth = 0;
  while (queue.length > 0 && depth < generations) {
    const id = queue.shift()!;
    const child = store.lineages[id];
    if (child) {
      descendants.push(child);
      queue.push(...child.children);
    }
    depth++;
  }

  return { ...node, ancestors, descendants };
}

// ─── Keyword Mapping ────────────────────────────────────────────────

const TOPIC_KEYWORDS: Record<string, string[]> = {
  data_analysis: [
    "data", "analyse", "analyze", "analysis", "statistics", "chart", "graph",
    "pattern", "insight", "trend", "metric", "dashboard", "report",
    "numbers", "spreadsheet", "csv", "json data", "dataset",
  ],
  creative_writing: [
    "story", "poem", "poetry", "write", "creative", "fiction", "narrative",
    "character", "plot", "dialogue", "scene", "describe", "imagine",
    "fantasy", "tale", "novel", "chapter", "verse",
  ],
  code_generation: [
    "code", "function", "program", "script", "bug", "debug", "compile",
    "api", "endpoint", "route", "handler", "type", "interface",
    "class", "method", "variable", "loop", "array", "object",
    "python", "javascript", "typescript", "react", "node",
    "npm", "import", "export", "async", "await", "promise",
  ],
  strategy: [
    "strategy", "plan", "roadmap", "goal", "objective", "approach",
    "framework", "methodology", "optimize", "improve", "solution",
    "analyze", "trade-off", "priority", "decision", "scenario",
    "risk", "opportunity", "threat", "swot", "timeline", "milestone",
  ],
  empathy: [
    "feel", "feeling", "emotion", "understand", "support", "help",
    "sorry", "worried", "anxious", "happy", "sad", "frustrated",
    "grateful", "appreciate", "thank", "please", "concern",
    "relationship", "trust", "care", "kind", "compassion",
  ],
  humor: [
    "funny", "joke", "laugh", "humor", "humour", "comedy", "witty",
    "pun", "meme", "hilarious", "amusing", "roast", "sarcasm",
    "satire", "parody", "😂", "🤣", "😄", "lol", "lmao",
  ],
};

function getKeywordsForTopic(traitId: string): string[] {
  return TOPIC_KEYWORDS[traitId] ?? [];
}
