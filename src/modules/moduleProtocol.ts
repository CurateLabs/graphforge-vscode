import type { ModuleCapability, ModuleSource } from "./moduleManifest";

export interface ModuleViewModel {
  id: string;
  name: string;
  version: string;
  publisher: string;
  description: string;
  capabilities: ModuleCapability[];
  source: ModuleSource["kind"];
  installed: boolean;
  enabled: boolean;
  available: boolean;
  removable: boolean;
  status: "available" | "disabled" | "active" | "unavailable" | "error";
  error?: string;
  actions: Array<{ title: string; command: string }>;
  homepage?: string;
}

export type ModulesHostToWebview = {
  type: "graphforge/modulesState";
  modules: ModuleViewModel[];
};

export type ModulesWebviewToHost =
  | { type: "graphforge/ready" }
  | { type: "graphforge/installFromFile" }
  | { type: "graphforge/install"; id: string }
  | { type: "graphforge/toggleModule"; id: string; enabled: boolean }
  | { type: "graphforge/removeModule"; id: string }
  | { type: "graphforge/runModuleAction"; id: string; command: string }
  | { type: "graphforge/openHomepage"; id: string };
