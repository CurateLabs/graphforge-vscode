import { registerImportCommands } from "../../commands/importData";
import { registerFigures } from "../../commands/figures";
import { registerRunQuery } from "../../commands/runQuery";
import { registerVisualizationCommands } from "../../commands/visualize";
import type { ModuleRegistration } from "../moduleManager";
import importManifest from "./import/graphforge-module.json";
import queryManifest from "./query/graphforge-module.json";
import visualizeManifest from "./visualize/graphforge-module.json";

export const firstPartyModules: ModuleRegistration[] = [
  {
    manifest: queryManifest,
    activate: (context, host) => registerRunQuery(context, host.session, host.results),
  },
  {
    manifest: visualizeManifest,
    activate: (context, host) => {
      registerVisualizationCommands(context, host.session);
      registerFigures(context, host.session);
    },
  },
  {
    manifest: importManifest,
    activate: (context, host) => registerImportCommands(context, host.session),
  },
];
