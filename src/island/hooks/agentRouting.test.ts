import { describe, it, expect, beforeEach } from "vitest";
import { State } from "../../core/state";
import {
  CLAUDE_ID,
  HERMES_ID,
  validateAgent,
  agentColor,
  FALLBACK_COLORS,
  aliasProjectName,
  lastPathComponent,
  stepLabel,
  approvalTarget,
  resolveHookAgentRoute,
  upsertSession,
  clearSession,
  ensureAgentPill,
} from "./agentRouting";

describe("agentRouting", () => {
  beforeEach(() => {
    State.tasks = [
      {
        id: CLAUDE_ID,
        name: "VS Code",
        color: "#D97706",
        state: "idle",
        stepIndex: 0,
        steps: ["previous step"],
        pillBadge: "approval",
        source: "agent",
        isIntegration: true,
      },
      {
        id: HERMES_ID,
        name: "Hermes Agent",
        color: "#10B981",
        state: "idle",
        stepIndex: 0,
        steps: [],
        source: "hermes",
        isIntegration: true,
      },
    ];
  });

  describe("validateAgent", () => {
    it("accepts valid agent names", () => {
      expect(validateAgent("bot-1")).toBe("bot-1");
      expect(validateAgent("reviewer")).toBe("reviewer");
      expect(validateAgent("agent123")).toBe("agent123");
    });

    it("rejects reserved names 'claude' and 'hermes'", () => {
      expect(validateAgent("claude")).toBeNull();
      expect(validateAgent("hermes")).toBeNull();
    });

    it("rejects invalid characters, uppercase, and empty strings", () => {
      expect(validateAgent("")).toBeNull();
      expect(validateAgent(undefined)).toBeNull();
      expect(validateAgent("Agent")).toBeNull();
      expect(validateAgent("agent_one")).toBeNull();
      expect(validateAgent("agent space")).toBeNull();
      expect(validateAgent("agent!")).toBeNull();
    });

    it("rejects names longer than 24 characters", () => {
      expect(validateAgent("a".repeat(24))).toBe("a".repeat(24));
      expect(validateAgent("a".repeat(25))).toBeNull();
    });
  });

  describe("agentColor", () => {
    it("returns a deterministic fallback color from the palette", () => {
      const color1 = agentColor("worker");
      const color2 = agentColor("worker");
      expect(color1).toBe(color2);
      expect(FALLBACK_COLORS).toContain(color1);
    });
  });

  describe("aliasProjectName and lastPathComponent", () => {
    it("aliases known Notch Buddy variants", () => {
      expect(aliasProjectName("notch-buddy")).toBe("Notch Buddy");
      expect(aliasProjectName("notchbuddy")).toBe("Notch Buddy");
      expect(aliasProjectName("notch_buddy")).toBe("Notch Buddy");
      expect(aliasProjectName("NOTCH-BUDDY")).toBe("Notch Buddy");
      expect(aliasProjectName("custom-project")).toBe("custom-project");
    });

    it("extracts the last path component from Windows and POSIX paths", () => {
      expect(lastPathComponent("C:\\Users\\Alice\\Projects\\my-app")).toBe("my-app");
      expect(lastPathComponent("C:\\Users\\Alice\\Projects\\my-app\\")).toBe("my-app");
      expect(lastPathComponent("/home/user/workspace/repo")).toBe("repo");
      expect(lastPathComponent("/home/user/workspace/repo/")).toBe("repo");
      expect(lastPathComponent("single-name")).toBe("single-name");
    });
  });

  describe("stepLabel", () => {
    it("formats command tool inputs", () => {
      const label = stepLabel("bash", { command: "git status" });
      expect(label).toContain("git status");
    });

    it("formats file_path and path inputs with lastPathComponent", () => {
      expect(stepLabel("read_file", { file_path: "/etc/nginx/nginx.conf" })).toContain("nginx.conf");
      expect(stepLabel("list_directory", { path: "C:\\Projects\\MyApp" })).toContain("MyApp");
    });

    it("formats query input", () => {
      expect(stepLabel("search", { query: "vitest test runner" })).toContain("vitest test runner");
    });

    it("falls back to tool label if no matching input field is found", () => {
      const label = stepLabel("custom_tool", {});
      expect(label).toBeDefined();
    });
  });

  describe("approvalTarget", () => {
    it("extracts the highest-priority approval field", () => {
      expect(approvalTarget("bash", { command: "npm test", path: "/tmp" })).toBe("bash · npm test");
      expect(approvalTarget("write", { file_path: "/src/index.ts" })).toBe("write · /src/index.ts");
      expect(approvalTarget("read", { path: "/docs" })).toBe("read · /docs");
      expect(approvalTarget("fetch", { url: "https://example.com" })).toBe("fetch · https://example.com");
      expect(approvalTarget("search", { query: "react hooks" })).toBe("search · react hooks");
      expect(approvalTarget("grep", { pattern: "TODO" })).toBe("grep · TODO");
      expect(approvalTarget("task", { prompt: "run build" })).toBe("task · run build");
    });

    it("falls back to tool name if no approval field is present or non-empty", () => {
      expect(approvalTarget("unknown", {})).toBe("unknown");
      expect(approvalTarget("unknown", { command: "  " })).toBe("unknown");
    });
  });

  describe("resolveHookAgentRoute", () => {
    it("routes unassigned or empty coucou_agent to CLAUDE_ID", () => {
      const route = resolveHookAgentRoute({ cwd: "/home/dev/my-project" });
      expect(route.agentId).toBe(CLAUDE_ID);
      expect(route.isHermes).toBe(false);
      expect(route.isExternalAgent).toBe(false);
      expect(route.validAgent).toBeNull();
      expect(route.projectName).toBe("my-project");
      expect(route.cwd).toBe("/home/dev/my-project");
    });

    it("routes coucou_agent=hermes to HERMES_ID", () => {
      const route = resolveHookAgentRoute({ coucou_agent: "hermes", cwd: "/Users/dev/notchbuddy" });
      expect(route.agentId).toBe(HERMES_ID);
      expect(route.isHermes).toBe(true);
      expect(route.isExternalAgent).toBe(false);
      expect(route.validAgent).toBeNull();
      expect(route.projectName).toBe("Notch Buddy");
    });

    it("routes valid custom coucou_agent to dynamic external agent pill", () => {
      const route = resolveHookAgentRoute({ coucou_agent: "reviewer-bot", cwd: "" });
      expect(route.agentId).toBe("agent_reviewer-bot");
      expect(route.isHermes).toBe(false);
      expect(route.isExternalAgent).toBe(true);
      expect(route.validAgent).toBe("reviewer-bot");
      expect(route.projectName).toBe("Session");
    });

    it("falls back to CLAUDE_ID if coucou_agent is invalid", () => {
      const route = resolveHookAgentRoute({ coucou_agent: "INVALID_AGENT!" });
      expect(route.agentId).toBe(CLAUDE_ID);
      expect(route.isHermes).toBe(false);
      expect(route.isExternalAgent).toBe(false);
      expect(route.validAgent).toBeNull();
    });
  });

  describe("upsertSession and clearSession", () => {
    it("updates task name and cwd for Claude task", () => {
      upsertSession("MyProject", "/home/x/MyProject", CLAUDE_ID, State);
      const task = State.tasks.find((t) => t.id === CLAUDE_ID)!;
      expect(task.name).toBe("MyProject");
      expect(task.sessionCwd).toBe("/home/x/MyProject");
    });

    it("updates Hermes task name unless 'Session' is given", () => {
      upsertSession("CustomHermes", "/cwd", HERMES_ID, State);
      let task = State.tasks.find((t) => t.id === HERMES_ID)!;
      expect(task.name).toBe("CustomHermes");

      upsertSession("Session", "/cwd", HERMES_ID, State);
      task = State.tasks.find((t) => t.id === HERMES_ID)!;
      expect(task.name).toBe("Hermes Agent");
    });

    it("clears session steps and resets name and pillBadge", () => {
      clearSession(CLAUDE_ID, State);
      const claude = State.tasks.find((t) => t.id === CLAUDE_ID)!;
      expect(claude.steps).toEqual([]);
      expect(claude.stepIndex).toBe(0);
      expect(claude.name).toBe("VS Code");
      expect(claude.pillBadge).toBeNull();

      clearSession(HERMES_ID, State);
      const hermes = State.tasks.find((t) => t.id === HERMES_ID)!;
      expect(hermes.name).toBe("Hermes Agent");
    });
  });

  describe("ensureAgentPill", () => {
    it("upserts external agent when route is external", () => {
      const route = resolveHookAgentRoute({ coucou_agent: "worker" });
      ensureAgentPill(route, State);
      expect(State.tasks.some((t) => t.id === "agent_worker")).toBe(true);
    });

    it("updates existing internal agent session when route is internal", () => {
      const route = resolveHookAgentRoute({ cwd: "/home/user/awesome-app" });
      ensureAgentPill(route, State);
      const task = State.tasks.find((t) => t.id === CLAUDE_ID)!;
      expect(task.name).toBe("awesome-app");
    });
  });
});
